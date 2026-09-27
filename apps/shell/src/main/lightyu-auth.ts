import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { startAuthSession, type AuthSessionHandle } from './auth-session'

const API_BASE_URL = 'https://5555api.com'
const CLIENT_ID = 'genoffice-desktop'
const AUTH_FILE_NAME = 'lightyu-auth.json'
const GUEST_AUTH_FILE_NAME = 'lightyu-guest.json'
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000
const FLOW_TTL = 10 * 60 * 1000
const CALLBACK_PATH = '/desktop/callback'
const MAX_AVATAR_BYTES = 512 * 1024

export interface LightyuAccountStatus {
  loggedIn: boolean
  nickname?: string
  avatar?: string
  email?: string
  jindou?: number
  expiresAt?: number
}

export interface LightyuLoginProgress {
  phase: 'launched' | 'success' | 'error'
  error?: string
}

interface Profile {
  id?: number
  nickname?: string
  avatar?: string
  email?: string
  jindou?: number
}

interface StoredAuth {
  token: string
  expiresAt: number
  profile: Profile
}

interface DiskAuth {
  token: string
  tokenEncoding?: 'plain' | 'safeStorage'
  expiresAt: number
  profile?: Profile
}

interface DesktopLoginData {
  token?: string
  expire?: number
  guestMerged?: boolean
  profile?: Profile
}

interface AuthFlow {
  server: Server
  state: string
  verifier: string
  redirectUri: string
  emit: (progress: LightyuLoginProgress) => void
  timer: NodeJS.Timeout
  done: boolean
  processing: boolean
  controller: AbortController
  response?: ServerResponse
  authSession?: AuthSessionHandle
}

let cachedAuth: StoredAuth | null | undefined
let cachedGuestAuth: StoredAuth | null | undefined
let activeFlow: AuthFlow | undefined
let lastAuthUrl = ''

export function lightyuAuthPath(): string {
  return join(app.getPath('userData'), AUTH_FILE_NAME)
}

export function lightyuGuestAuthPath(): string {
  return join(app.getPath('userData'), GUEST_AUTH_FILE_NAME)
}

function encodeBase64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function normalizeProfile(value: unknown): Profile {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const result: Profile = {}
  if (typeof raw.id === 'number' && Number.isSafeInteger(raw.id)) result.id = raw.id
  if (typeof raw.nickname === 'string' && raw.nickname.trim()) result.nickname = raw.nickname.trim()
  if (typeof raw.email === 'string' && raw.email.trim()) result.email = raw.email.trim()
  if (typeof raw.jindou === 'number' && Number.isSafeInteger(raw.jindou) && raw.jindou >= 0)
    result.jindou = raw.jindou
  if (typeof raw.avatar === 'string' && raw.avatar.trim()) {
    const value = raw.avatar.trim()
    if (
      /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value) &&
      value.length <= MAX_AVATAR_BYTES * 2
    ) {
      result.avatar = value
      return result
    }
    try {
      const avatar = new URL(value)
      if (avatar.protocol === 'https:' || avatar.protocol === 'http:')
        result.avatar = avatar.toString()
    } catch {
      // Ignore malformed avatar URLs returned by the remote service.
    }
  }
  return result
}

async function downloadAvatar(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  if (url.startsWith('data:image/')) return url.length <= MAX_AVATAR_BYTES * 2 ? url : undefined

  try {
    const parsed = new URL(url)
    // WeChat hosts the profile images on qlogo.cn. Keep the download allowlist
    // narrow because this runs in the privileged Electron main process.
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.qlogo.cn')) return undefined
    const response = await fetch(parsed, {
      headers: {
        'User-Agent': 'Mozilla/5.0 GenOffice Desktop',
        Referer: `${API_BASE_URL}/`,
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return undefined
    const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase()
    if (!contentType.startsWith('image/')) return undefined
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) return undefined
    return `data:${contentType};base64,${bytes.toString('base64')}`
  } catch {
    return undefined
  }
}

async function hydrateAvatar(profile: Profile, previous?: Profile): Promise<Profile> {
  const downloaded = await downloadAvatar(profile.avatar)
  if (downloaded) profile.avatar = downloaded
  else if (previous?.avatar?.startsWith('data:image/')) profile.avatar = previous.avatar
  return profile
}

function decryptStoredToken(raw: DiskAuth): string {
  if (typeof raw.token !== 'string') return ''
  if (raw.tokenEncoding !== 'safeStorage') return raw.token
  try {
    if (!safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(Buffer.from(raw.token, 'base64'))
  } catch {
    return ''
  }
}

function readAuthFile(path: string): StoredAuth | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<DiskAuth>
    if (
      typeof raw.expiresAt !== 'number' ||
      !Number.isFinite(raw.expiresAt) ||
      raw.expiresAt <= Date.now()
    )
      return null
    const token = decryptStoredToken(raw as DiskAuth)
    return token
      ? { token, expiresAt: raw.expiresAt, profile: normalizeProfile(raw.profile) }
      : null
  } catch {
    return null
  }
}

function loadAuth(): StoredAuth | null {
  if (cachedAuth === undefined) {
    cachedAuth = readAuthFile(lightyuAuthPath())
    if (!cachedAuth && existsSync(lightyuAuthPath())) clearAuth()
  }
  if (cachedAuth && cachedAuth.expiresAt <= Date.now()) clearAuth()
  return cachedAuth
}

function loadGuestAuth(): StoredAuth | null {
  if (cachedGuestAuth === undefined) {
    cachedGuestAuth = readAuthFile(lightyuGuestAuthPath())
    if (!cachedGuestAuth && existsSync(lightyuGuestAuthPath())) clearLightyuGuest()
  }
  if (cachedGuestAuth && cachedGuestAuth.expiresAt <= Date.now()) clearLightyuGuest()
  return cachedGuestAuth
}

function writeAuthFile(path: string, auth: StoredAuth): void {
  mkdirSync(dirname(path), { recursive: true })

  let token = auth.token
  let tokenEncoding: DiskAuth['tokenEncoding'] = 'plain'
  try {
    if (safeStorage.isEncryptionAvailable()) {
      token = safeStorage.encryptString(token).toString('base64')
      tokenEncoding = 'safeStorage'
    }
  } catch {
    // A 0600 file is the fallback on systems without a usable keychain.
  }

  writeFileSync(
    path,
    `${JSON.stringify({ token, tokenEncoding, expiresAt: auth.expiresAt, profile: auth.profile }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort: the file was created with mode 0600 above.
  }
}

function saveAuth(auth: StoredAuth): void {
  writeAuthFile(lightyuAuthPath(), auth)
  cachedAuth = auth
}

async function refreshProfile(auth: StoredAuth): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/data/user/fetchUser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth.token },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return
    const result = (await response.json()) as { code?: number; data?: unknown }
    if (result.code !== 200 || !result.data) return
    const profile = await hydrateAvatar(normalizeProfile(result.data), auth.profile)
    saveAuth({ ...auth, profile })
  } catch {
    // Cached account details remain usable while the API is unavailable.
  }
}

function clearAuth(): void {
  try {
    if (existsSync(lightyuAuthPath())) unlinkSync(lightyuAuthPath())
  } catch {
    // Local logout remains usable if cleanup is interrupted.
  }
  cachedAuth = null
}

export function saveLightyuGuest(token: string, expiresAt: number): void {
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('访客凭据无效')
  }
  const auth: StoredAuth = { token, expiresAt, profile: {} }
  writeAuthFile(lightyuGuestAuthPath(), auth)
  cachedGuestAuth = auth
}

export function clearLightyuGuest(): void {
  try {
    if (existsSync(lightyuGuestAuthPath())) unlinkSync(lightyuGuestAuthPath())
  } catch {
    // Keep the in-memory state cleared even if disk cleanup is interrupted.
  }
  cachedGuestAuth = null
}

function finishFlow(flow: AuthFlow, progress: LightyuLoginProgress, notify = true): void {
  if (flow.done) return
  flow.done = true
  clearTimeout(flow.timer)
  flow.controller.abort()
  flow.authSession?.cancel()
  if (flow.response && !flow.response.destroyed && !flow.response.writableEnded) {
    const success = progress.phase === 'success'
    flow.response.writeHead(success ? 200 : 400, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    })
    flow.response.end(
      '<!doctype html><meta charset="utf-8"><title>轻语 API</title><p>' +
        (success
          ? '授权成功，请返回 AiOffice。'
          : '授权未完成或已取消，请返回 AiOffice 重新登录。') +
        '</p>',
    )
  }
  if (activeFlow === flow) {
    activeFlow = undefined
    lastAuthUrl = ''
  }
  flow.server.close()
  if (notify) flow.emit(progress)
}

function cancelFlow(flow: AuthFlow): void {
  finishFlow(flow, { phase: 'error', error: '登录授权已取消' }, false)
}

function revokeToken(token: string): void {
  void fetch(`${API_BASE_URL}/data/user/desktop/logout`, {
    method: 'POST',
    headers: { Authorization: token },
    signal: AbortSignal.timeout(10000),
  }).catch(() => {})
}

function normalizeEmailAccount(value: string): string {
  const account = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) && account.length <= 254 ? account : ''
}

async function parseApiResult(response: Response): Promise<{ code?: number; msg?: string; data?: unknown }> {
  try {
    return (await response.json()) as { code?: number; msg?: string; data?: unknown }
  } catch {
    return { code: response.status, msg: '服务器返回了无效响应' }
  }
}

async function saveDesktopLogin(data: DesktopLoginData): Promise<string> {
  const token = data.token
  if (typeof token !== 'string' || !token) throw new Error('登录凭据无效，请重试')
  const expiresAt = data.expire
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    revokeToken(token)
    throw new Error('登录凭据已失效，请重新登录')
  }
  const profile = await hydrateAvatar(normalizeProfile(data.profile))
  saveAuth({
    token,
    expiresAt: Math.min(expiresAt, Date.now() + SESSION_TTL),
    profile,
  })
  if (data.guestMerged === true) clearLightyuGuest()
  return token
}

export async function sendLightyuEmailCode(account: string): Promise<void> {
  const normalized = normalizeEmailAccount(account)
  if (!normalized) throw new Error('请输入有效的邮箱地址')
  const response = await fetch(`${API_BASE_URL}/data/user/sendEmailCode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ account: normalized }),
  })
  const result = await parseApiResult(response)
  if (!response.ok || result.code !== 200) throw new Error(result.msg || '验证码发送失败，请稍后重试')
}

export async function loginLightyuWithEmailCode(account: string, code: string): Promise<void> {
  const normalized = normalizeEmailAccount(account)
  const verificationCode = code.trim()
  if (!normalized) throw new Error('请输入有效的邮箱地址')
  if (!/^\d{5}$/.test(verificationCode)) throw new Error('请输入正确的验证码')
  const response = await fetch(`${API_BASE_URL}/data/user/desktop/email-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      account: normalized,
      code: verificationCode,
      clientId: CLIENT_ID,
      guestToken: lightyuGuestToken() ?? undefined,
    }),
  })
  const result = await parseApiResult(response)
  if (!response.ok || result.code !== 200) throw new Error(result.msg || '登录失败，请重试')
  await saveDesktopLogin((result.data ?? {}) as DesktopLoginData)
}

export async function deleteLightyuAccount(): Promise<void> {
  const auth = loadAuth()
  if (!auth) throw new Error('请先登录')
  const response = await fetch(`${API_BASE_URL}/data/user/deleteAccount`, {
    method: 'POST',
    headers: { Authorization: auth.token },
    signal: AbortSignal.timeout(15000),
  })
  const result = await parseApiResult(response)
  if (!response.ok || result.code !== 200) throw new Error(result.msg || '账号删除失败，请稍后重试')
  if (activeFlow) cancelFlow(activeFlow)
  clearAuth()
  clearLightyuGuest()
}

async function exchangeDesktopCode(flow: AuthFlow, code: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/data/user/desktop/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.any([flow.controller.signal, AbortSignal.timeout(30000)]),
      body: JSON.stringify({
        code,
        clientId: CLIENT_ID,
        redirectUri: flow.redirectUri,
        codeVerifier: flow.verifier,
        guestToken: lightyuGuestToken() ?? undefined,
      }),
    })
    const result = await parseApiResult(response)
    const data = (result.data ?? {}) as DesktopLoginData
    const token = data.token
    if (flow.done || activeFlow !== flow) {
      // A response may already be buffered when cancellation aborts the request.
      if (response.ok && result.code === 200 && typeof token === 'string' && token)
        revokeToken(token)
      return
    }
    if (!response.ok || result.code !== 200 || typeof token !== 'string' || !token) {
      finishFlow(flow, { phase: 'error', error: result.msg || '授权兑换失败，请重试' })
      return
    }

    const expiresAt = data.expire
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      revokeToken(token)
      finishFlow(flow, { phase: 'error', error: '授权凭据已失效，请重新登录' })
      return
    }
    await saveDesktopLogin(data)
    finishFlow(flow, { phase: 'success' })
  } catch {
    finishFlow(flow, { phase: 'error', error: '授权兑换失败，请检查网络后重试' })
  }
}

function createCallbackServer(flow: AuthFlow): Server {
  return createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405)
      response.end()
      return
    }

    let callbackUrl: URL
    try {
      callbackUrl = new URL(request.url || '/', 'http://127.0.0.1')
    } catch {
      response.writeHead(400)
      response.end('回调地址无效')
      return
    }

    if (callbackUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404)
      response.end()
      return
    }
    if (flow.done || flow.processing) {
      response.writeHead(409)
      response.end('授权流程已完成')
      return
    }

    const returnedState = callbackUrl.searchParams.get('state') || ''
    const code = callbackUrl.searchParams.get('code') || ''
    const error = callbackUrl.searchParams.get('error') || ''
    if (returnedState !== flow.state) {
      response.writeHead(400)
      response.end('授权状态无效')
      finishFlow(flow, { phase: 'error', error: '授权状态无效，请重试' })
      return
    }
    if (error || !code) {
      response.writeHead(400)
      response.end('授权失败')
      finishFlow(flow, { phase: 'error', error: '网页端未完成登录授权' })
      return
    }

    flow.processing = true
    flow.response = response
    void exchangeDesktopCode(flow, code)
  })
}

function startDesktopLogin(
  emit: (progress: LightyuLoginProgress) => void,
  provider: 'lightyu' | 'apple',
): boolean {
  if (activeFlow) cancelFlow(activeFlow)

  const state = encodeBase64Url(randomBytes(24))
  const verifier = encodeBase64Url(randomBytes(32))
  const challenge = encodeBase64Url(createHash('sha256').update(verifier).digest())
  const flow = {} as AuthFlow
  const server = createCallbackServer(flow)
  Object.assign(flow, {
    server,
    state,
    verifier,
    redirectUri: '',
    emit,
    timer: setTimeout(
      () => finishFlow(flow, { phase: 'error', error: '登录授权已超时，请重试' }),
      FLOW_TTL,
    ),
    done: false,
    processing: false,
    controller: new AbortController(),
  })
  activeFlow = flow

  server.listen(0, '127.0.0.1', () => {
    if (flow.done || activeFlow !== flow) return
    const address = server.address()
    if (!address || typeof address === 'string') {
      finishFlow(flow, { phase: 'error', error: '无法启动本地授权服务' })
      return
    }
    flow.redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
    // Both providers start at the hosted login page. Apple authorization is
    // a two-step browser flow there: the page exchanges Apple's ticket and
    // then calls /data/user/desktop/authorize with the PKCE request. Opening
    // /data/user/apple/authorize directly skips that desktop hand-off and
    // leaves the local callback without a code.
    lastAuthUrl = `${API_BASE_URL}/login.html?${new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: flow.redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()}`
    emit({ phase: 'launched' })
    const authSession = startAuthSession(lastAuthUrl, 'http')
    flow.authSession = authSession
    void authSession.promise
      .then((callbackUrl) => {
        if (flow.done || activeFlow !== flow) return
        if (!isExpectedCallback(flow.redirectUri, callbackUrl)) {
          finishFlow(flow, { phase: 'error', error: '登录回调地址无效，请重试' })
          return
        }
        return fetch(callbackUrl, { redirect: 'manual' }).then((response) => {
          // The browser and ASWebAuthenticationSession can both touch the
          // loopback URL. The second request is expected while the first one
          // is exchanging the code, so do not turn its 409 into a failure.
          if (!response.ok && response.status !== 409 && !flow.done) {
            finishFlow(flow, { phase: 'error', error: '登录回调未完成，请重试' })
          }
        })
      })
      .catch((error) => {
        // ASWebAuthenticationSession may report the HTTP callback as a
        // cancellation after the loopback server has already accepted it.
        // The server owns the exchange once processing has started.
        if (!flow.done && !flow.processing) {
          finishFlow(flow, {
            phase: 'error',
            error: error instanceof Error ? error.message : '登录授权失败，请重试',
          })
        }
      })
  })
  server.on('error', () => finishFlow(flow, { phase: 'error', error: '无法启动本地授权服务' }))
  return true
}

export function startLightyuLogin(emit: (progress: LightyuLoginProgress) => void): boolean {
  return startDesktopLogin(emit, 'lightyu')
}

export function startAppleLogin(emit: (progress: LightyuLoginProgress) => void): boolean {
  return startDesktopLogin(emit, 'apple')
}

function isExpectedCallback(expectedUri: string, callbackUri: string): boolean {
  try {
    const expected = new URL(expectedUri)
    const actual = new URL(callbackUri)
    return (
      actual.protocol === expected.protocol &&
      actual.hostname === expected.hostname &&
      actual.port === expected.port &&
      actual.pathname === expected.pathname &&
      actual.username === '' &&
      actual.password === '' &&
      actual.hash === ''
    )
  } catch {
    return false
  }
}

export function lightyuAccountStatus(): LightyuAccountStatus {
  const auth = loadAuth()
  if (!auth) {
    clearAuth()
    return { loggedIn: false }
  }
  return { loggedIn: true, ...auth.profile, expiresAt: auth.expiresAt }
}

/** Main-process-only credential accessor for the AiOffice AI gateway. */
export function lightyuAccessToken(): string | null {
  return loadAuth()?.token ?? null
}

export function lightyuGuestToken(): string | null {
  return loadGuestAuth()?.token ?? null
}

/** Credential used for paid AI services; a signed-in account takes priority. */
export function lightyuServiceToken(): string | null {
  return lightyuAccessToken() ?? lightyuGuestToken()
}

export async function refreshLightyuAccountStatus(): Promise<LightyuAccountStatus> {
  const auth = loadAuth()
  if (!auth) return { loggedIn: false }
  await refreshProfile(auth)
  return lightyuAccountStatus()
}

export function lightyuLogout(): void {
  const auth = loadAuth()
  if (auth) {
    revokeToken(auth.token)
  }
  if (activeFlow) cancelFlow(activeFlow)
  clearAuth()
}
