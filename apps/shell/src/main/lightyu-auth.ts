import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BrowserWindow, app, safeStorage } from 'electron'

const API_BASE_URL = 'https://5555api.com'
const WECHAT_APP_ID = 'wxc6b5178fff4442e7'
const WECHAT_REDIRECT_URI = `${API_BASE_URL}/login.html`
const LOGIN_TTL_SEC = 180
const AUTH_FILE_NAME = 'lightyu-auth.json'

export interface LightyuAccountStatus {
  loggedIn: boolean
  nickname?: string
  avatar?: string
  email?: string
  expiresAt?: number
}

export interface LightyuLoginProgress {
  phase: 'qr' | 'scanned' | 'success' | 'error'
  qrDataUrl?: string
  url?: string
  expiresInSec?: number
  error?: string
}

interface AccountProfile {
  nickname?: string
  avatar?: string
  email?: string
}

interface StoredAuth {
  token: string
  expiresAt: number
  profile: AccountProfile
}

interface AuthFile {
  token: string
  tokenEncoding?: 'plain' | 'safeStorage'
  expiresAt: number
  profile?: AccountProfile
}

let cachedAuth: StoredAuth | null | undefined
let activeLogin:
  | {
      state: string
      oauthUrl: string
      window: BrowserWindow
      timer: NodeJS.Timeout
      emit: (progress: LightyuLoginProgress) => void
      done: boolean
      qrPublished: boolean
    }
  | undefined

export function lightyuAuthPath(): string {
  return join(app.getPath('userData'), AUTH_FILE_NAME)
}

export function buildLightyuOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    appid: WECHAT_APP_ID,
    redirect_uri: WECHAT_REDIRECT_URI,
    response_type: 'code',
    scope: 'snsapi_login',
    state,
  })
  return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`
}

export function randomLoginState(): string {
  return randomBytes(16).toString('hex')
}

function asProfile(value: unknown): AccountProfile {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const avatar = typeof raw.avatar === 'string' ? raw.avatar.trim() : ''
  let safeAvatar = ''
  try {
    const parsed = new URL(avatar)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') safeAvatar = parsed.toString()
  } catch {
    // Ignore malformed avatar URLs returned by the remote service.
  }
  return {
    ...(typeof raw.nickname === 'string' && raw.nickname ? { nickname: raw.nickname } : {}),
    ...(safeAvatar ? { avatar: safeAvatar } : {}),
    ...(typeof raw.email === 'string' && raw.email ? { email: raw.email } : {}),
  }
}

function decryptToken(raw: AuthFile): string {
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
    const raw = JSON.parse(readFileSync(lightyuAuthPath(), 'utf8')) as Partial<AuthFile>
    if (typeof raw.token !== 'string' || typeof raw.expiresAt !== 'number') return null
    const token = decryptToken(raw as AuthFile)
    if (!token || raw.expiresAt <= Date.now()) return null
    return { token, expiresAt: raw.expiresAt, profile: asProfile(raw.profile) }
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
  let tokenEncoding: AuthFile['tokenEncoding'] = 'plain'
  try {
    if (safeStorage.isEncryptionAvailable()) {
      token = safeStorage.encryptString(auth.token).toString('base64')
      tokenEncoding = 'safeStorage'
    }
  } catch {
    // A 0600 file is the fallback on systems without a usable keychain.
  }
  const data: AuthFile = {
    token,
    tokenEncoding,
    expiresAt: auth.expiresAt,
    profile: auth.profile,
  }
  writeFileSync(lightyuAuthPath(), `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  // writeFileSync does not tighten permissions when the file already exists.
  chmodSync(lightyuAuthPath(), 0o600)
  cachedAuth = auth
}

function clearAuth(): void {
  try {
    if (existsSync(lightyuAuthPath())) unlinkSync(lightyuAuthPath())
  } catch {
    // Local logout should remain usable even if cleanup is interrupted.
  }
  cachedAuth = null
}

async function fetchProfile(token: string): Promise<AccountProfile> {
  try {
    const response = await fetch(`${API_BASE_URL}/data/user/fetchUser`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
    })
    if (!response.ok) return {}
    const result = (await response.json()) as Record<string, unknown>
    return result.code === 200 ? asProfile(result.data) : {}
  } catch {
    // Login remains valid if the optional profile request is unavailable.
    return {}
  }
}

function finishLogin(progress: LightyuLoginProgress): void {
  const flow = activeLogin
  if (!flow || flow.done) return
  flow.done = true
  clearTimeout(flow.timer)
  if (!flow.window.isDestroyed()) flow.window.close()
  activeLogin = undefined
  flow.emit(progress)
}

async function exchangeCode(code: string, state: string): Promise<void> {
  const flow = activeLogin
  if (!flow || flow.done || state !== flow.state) return
  flow.emit({ phase: 'scanned' })
  try {
    const response = await fetch(`${API_BASE_URL}/data/user/wxlogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    const result = (await response.json()) as Record<string, unknown>
    const data = result.data as Record<string, unknown> | undefined
    const token = typeof data?.token === 'string' ? data.token : ''
    if (!response.ok || result.code !== 200 || !token) {
      throw new Error(typeof result.msg === 'string' ? result.msg : '微信登录失败，请重试')
    }
    const expire = typeof result.expire === 'number' ? result.expire : Date.now() + 86_400_000
    // A second login may have replaced this flow while the request was in flight.
    if (activeLogin !== flow || flow.done) return
    const profile = await fetchProfile(token)
    if (activeLogin !== flow || flow.done) return
    saveAuth({ token, expiresAt: expire, profile })
    finishLogin({ phase: 'success' })
  } catch (error) {
    finishLogin({
      phase: 'error',
      error: error instanceof Error ? error.message : '微信登录失败，请重试',
    })
  }
}

function inspectCallback(url: string): void {
  const flow = activeLogin
  if (!flow || flow.done) return
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.origin !== API_BASE_URL || parsed.pathname !== '/login.html') return
  const state = parsed.searchParams.get('state') || ''
  const code = parsed.searchParams.get('code') || ''
  if (!state || state !== flow.state || !code) return
  void exchangeCode(code, state)
}

async function publishWechatQr(flow: NonNullable<typeof activeLogin>): Promise<void> {
  if (flow.done || flow.qrPublished || flow.window.isDestroyed()) return
  const qrUrl = await flow.window.webContents.executeJavaScript(
    `(() => document.querySelector('.js_qrcode_img')?.src || '')()`,
    true,
  )
  if (typeof qrUrl !== 'string' || !qrUrl) {
    throw new Error('微信二维码加载失败，请刷新重试')
  }
  const parsed = new URL(qrUrl)
  if (parsed.protocol !== 'https:' || parsed.origin !== 'https://open.weixin.qq.com') {
    throw new Error('微信二维码地址无效，请刷新重试')
  }
  const response = await fetch(parsed)
  if (!response.ok) throw new Error('微信二维码加载失败，请刷新重试')
  const contentType = response.headers.get('content-type')?.split(';', 1)[0] || 'image/jpeg'
  const image = Buffer.from(await response.arrayBuffer()).toString('base64')
  if (activeLogin !== flow || flow.done) return
  flow.qrPublished = true
  flow.emit({
    phase: 'qr',
    qrDataUrl: `data:${contentType};base64,${image}`,
    url: flow.oauthUrl,
    expiresInSec: LOGIN_TTL_SEC,
  })
}

export function startLightyuLogin(onEvent: (progress: LightyuLoginProgress) => void): boolean {
  cancelLightyuLogin()
  const state = randomLoginState()
  const oauthUrl = buildLightyuOAuthUrl(state)
  const authWindow = new BrowserWindow({
    width: 460,
    height: 720,
    show: false,
    title: '微信登录',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:lightyu-login',
    },
  })
  const timer = setTimeout(
    () => finishLogin({ phase: 'error', error: '二维码已过期，请刷新重试' }),
    LOGIN_TTL_SEC * 1000,
  )
  activeLogin = {
    state,
    oauthUrl,
    window: authWindow,
    timer,
    emit: onEvent,
    done: false,
    qrPublished: false,
  }
  const inspect = (_event: unknown, url: string) => inspectCallback(url)
  authWindow.webContents.on('will-redirect', inspect)
  authWindow.webContents.on('did-navigate', inspect)
  authWindow.webContents.on('did-finish-load', () => {
    const flow = activeLogin
    if (!flow || flow.window !== authWindow || flow.done) return
    void publishWechatQr(flow).catch((error: unknown) => {
      finishLogin({
        phase: 'error',
        error: error instanceof Error ? error.message : '二维码生成失败',
      })
    })
  })
  authWindow.webContents.on('did-fail-load', (_event, errorCode) => {
    if (errorCode !== -3) finishLogin({ phase: 'error', error: '无法打开微信登录页面，请检查网络' })
  })
  authWindow.on('closed', () => {
    if (activeLogin?.window === authWindow && !activeLogin.done) {
      finishLogin({ phase: 'error', error: '登录窗口已关闭' })
    }
  })
  void authWindow.loadURL(oauthUrl).catch((error: unknown) => {
    finishLogin({
      phase: 'error',
      error: error instanceof Error ? error.message : '无法打开微信登录页面，请检查网络',
    })
  })
  return true
}

export function openLightyuLoginWindow(): void {
  if (activeLogin && !activeLogin.window.isDestroyed()) {
    activeLogin.window.show()
    activeLogin.window.focus()
  }
}

export function cancelLightyuLogin(): void {
  if (!activeLogin) return
  const flow = activeLogin
  flow.done = true
  clearTimeout(flow.timer)
  if (!flow.window.isDestroyed()) flow.window.close()
  activeLogin = undefined
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
  cancelLightyuLogin()
  clearAuth()
}
