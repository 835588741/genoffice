import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'

const AUTH_SESSION_TIMEOUT_MS = 10 * 60 * 1000

export interface AuthSessionHandle {
  promise: Promise<string>
  cancel: () => void
}

export interface AppleAuthCredential {
  user: string
  identityToken: string
  authorizationCode?: string
  email?: string
  givenName?: string
  familyName?: string
}

export interface AppleAuthSessionHandle {
  promise: Promise<AppleAuthCredential>
  cancel: () => void
}

function helperPath(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(root, 'native', 'AiOffice.app', 'Contents', 'MacOS', 'auth-session')
}

function startHelper<T>(
  args: string[],
  parseOutput: (line: string) => T,
  outputPrefix: string,
): { promise: Promise<T>; cancel: () => void } {
  const child = spawn(helperPath(), args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let settled = false
  let stdout = ''
  let stderr = ''
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (reason?: unknown) => void

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const finish = (error?: Error, value?: T): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (error) rejectPromise(error)
    else resolvePromise(value!)
  }

  child.stdout.on('data', (chunk: Buffer | string) => {
    stdout += chunk.toString()
    const newline = stdout.search(/\r?\n/)
    if (newline < 0) return
    const line = stdout.slice(0, newline).trim()
    if (!line.startsWith(`${outputPrefix}\t`)) return
    try {
      const value = parseOutput(line.slice(outputPrefix.length + 1).trim())
      finish(undefined, value)
    } catch {
      finish(new Error('系统登录授权返回了无效凭据'))
    }
  })
  child.stderr.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString()
  })
  child.once('error', () => finish(new Error('无法启动系统登录授权')))
  child.once('close', (code) => {
    if (settled) return
    const detail = stderr.trim().replace(/\s+/g, ' ')
    finish(new Error(detail || (code === 0 ? '登录授权未返回结果' : '登录授权已取消')))
  })

  const timer = setTimeout(() => {
    child.kill('SIGTERM')
    finish(new Error('登录授权已超时，请重试'))
  }, AUTH_SESSION_TIMEOUT_MS)

  return {
    promise,
    cancel: () => {
      child.kill('SIGTERM')
      finish(new Error('登录授权已取消'))
    },
  }
}

/** Runs the bundled helper in ASWebAuthenticationSession mode for web authorization. */
export function startAuthSession(loginUrl: string, callbackScheme: string): AuthSessionHandle {
  return startHelper([loginUrl, callbackScheme], (value) => value, 'CALLBACK')
}

function parseAppleCredential(value: string): AppleAuthCredential {
  const parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Record<string, unknown>
  if (
    typeof parsed.user !== 'string' ||
    !parsed.user ||
    typeof parsed.identityToken !== 'string' ||
    !parsed.identityToken
  ) {
    throw new Error('Apple 登录凭据不完整')
  }
  const identityToken = Buffer.from(parsed.identityToken, 'base64').toString('utf8')
  if (!identityToken || identityToken.length > 16 * 1024) throw new Error('Apple 身份凭据无效')
  const credential: AppleAuthCredential = {
    user: parsed.user,
    identityToken,
  }
  for (const field of ['authorizationCode', 'email', 'givenName', 'familyName'] as const) {
    if (typeof parsed[field] === 'string' && parsed[field]) credential[field] = parsed[field]
  }
  return credential
}

/** Runs the bundled helper in native ASAuthorizationAppleIDProvider mode. */
export function startAppleAuthSession(nonceHash: string): AppleAuthSessionHandle {
  return startHelper(['apple', nonceHash], parseAppleCredential, 'APPLE')
}
