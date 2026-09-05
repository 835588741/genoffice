import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage, shell } from 'electron'

const API_BASE_URL = 'https://5555api.com'
const CLIENT_ID = 'genoffice-desktop'
const AUTH_FILE_NAME = 'lightyu-auth.json'
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000
const FLOW_TTL = 10 * 60 * 1000
const CALLBACK_PATH = '/desktop/callback'

export interface LightyuAccountStatus {
  loggedIn: boolean
  nickname?: string
  avatar?: string
  email?: string
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

interface AuthFlow {
  server: Server
  state: string
  verifier: string
  redirectUri: string
  emit: (progress: LightyuLoginProgress) => void
  timer: NodeJS.Timeout
  done: boolean
  processing: boolean
}

let cachedAuth: StoredAuth | null | undefined
let activeFlow: AuthFlow | undefined
let lastAuthUrl = ''

export function lightyuAuthPath(): string {
  return join(app.getPath('userData'), AUTH_FILE_NAME)
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
  if (typeof raw.avatar === 'string' && raw.avatar.trim()) {
    try {
      const avatar = new URL(raw.avatar.trim())
      if (avatar.protocol === 'https:' || avatar.protocol === 'http:')
        result.avatar = avatar.toString()
    } catch {
      // Ignore malformed avatar URLs returned by the remote service.
    }
  }
  return result
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

function readAuth(): StoredAuth | null {
  try {
    const raw = JSON.parse(readFileSync(lightyuAuthPath(), 'utf8')) as Partial<DiskAuth>
    if (typeof raw.expiresAt !== 'number' || raw.expiresAt <= Date.now()) return null
    const token = decryptStoredToken(raw as DiskAuth)
    return token
      ? { token, expiresAt: raw.expiresAt, profile: normalizeProfile(raw.profile) }
      : null
  } catch {
    return null
  }
}

function loadAuth(): StoredAuth | null {
  if (cachedAuth === undefined) cachedAuth = readAuth()
  return cachedAuth
}

function saveAuth(auth: StoredAuth): void {
  mkdirSync(dirname(lightyuAuthPath()), { recursive: true })

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
    lightyuAuthPath(),
    `${JSON.stringify({ token, tokenEncoding, expiresAt: auth.expiresAt, profile: auth.profile }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  try {
    chmodSync(lightyuAuthPath(), 0o600)
  } catch {
    // Best effort: the file was created with mode 0600 above.
  }
  cachedAuth = auth
}

function clearAuth(): void {
  try {
    if (existsSync(lightyuAuthPath())) unlinkSync(lightyuAuthPath())
  } catch {
    // Local logout remains usable if cleanup is interrupted.
  }
  cachedAuth = null
}

function finishFlow(flow: AuthFlow, progress: LightyuLoginProgress): void {
  if (flow.done) return
  flow.done = true
  clearTimeout(flow.timer)
  if (activeFlow === flow) {
    activeFlow = undefined
    lastAuthUrl = ''
  }
  flow.server.close()
  flow.emit(progress)
}

function cancelFlow(flow: AuthFlow): void {
  if (flow.done) return
  flow.done = true
  clearTimeout(flow.timer)
  if (activeFlow === flow) {
    activeFlow = undefined
    lastAuthUrl = ''
  }
  flow.server.close()
}

async function exchangeDesktopCode(flow: AuthFlow, code: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/data/user/desktop/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        clientId: CLIENT_ID,
        redirectUri: flow.redirectUri,
        codeVerifier: flow.verifier,
      }),
    })
    const result = (await response.json()) as {
      code?: number
      msg?: string
      data?: { token?: string; expire?: number; profile?: Profile }
    }
    const token = result.data?.token
    if (!response.ok || result.code !== 200 || typeof token !== 'string' || !token) {
      finishFlow(flow, { phase: 'error', error: result.msg || '授权兑换失败，请重试' })
      return
    }

    saveAuth({
      token,
      expiresAt:
        typeof result.data?.expire === 'number' && result.data.expire > Date.now()
          ? result.data.expire
          : Date.now() + SESSION_TTL,
      profile: normalizeProfile(result.data?.profile),
    })
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
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><meta charset="utf-8"><title>轻语 API</title><p>授权成功，请返回 GenOffice。</p>',
    )
    void exchangeDesktopCode(flow, code)
  })
}

export function startLightyuLogin(emit: (progress: LightyuLoginProgress) => void): boolean {
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
  })
  activeFlow = flow

  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      finishFlow(flow, { phase: 'error', error: '无法启动本地授权服务' })
      return
    }
    flow.redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
    lastAuthUrl = `${API_BASE_URL}/login.html?${new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: flow.redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()}`
    emit({ phase: 'launched' })
    void shell.openExternal(lastAuthUrl).catch(() => {
      // The renderer still exposes the manual-open action when this fails.
    })
  })
  server.on('error', () => finishFlow(flow, { phase: 'error', error: '无法启动本地授权服务' }))
  return true
}

export function openLightyuLoginWindow(): void {
  if (lastAuthUrl) void shell.openExternal(lastAuthUrl)
}

export function lightyuAccountStatus(): LightyuAccountStatus {
  const auth = loadAuth()
  if (!auth) {
    clearAuth()
    return { loggedIn: false }
  }
  return { loggedIn: true, ...auth.profile, expiresAt: auth.expiresAt }
}

export function lightyuLogout(): void {
  const auth = loadAuth()
  if (auth) {
    void fetch(`${API_BASE_URL}/data/user/desktop/logout`, {
      method: 'POST',
      headers: { Authorization: auth.token },
    }).catch(() => {
      // The local credential is cleared even if the server is temporarily offline.
    })
  }
  if (activeFlow) cancelFlow(activeFlow)
  clearAuth()
}
