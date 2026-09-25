import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'

const AUTH_SESSION_TIMEOUT_MS = 10 * 60 * 1000

export interface AuthSessionHandle {
  promise: Promise<string>
  cancel: () => void
}

function helperPath(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(root, 'native', 'auth-session')
}

/** Runs the signed macOS helper that owns ASWebAuthenticationSession. */
export function startAuthSession(loginUrl: string, callbackScheme: string): AuthSessionHandle {
  const child = spawn(helperPath(), [loginUrl, callbackScheme], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let settled = false
  let stdout = ''
  let resolvePromise!: (value: string) => void
  let rejectPromise!: (reason?: unknown) => void

  const promise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const finish = (error?: Error, value?: string): void => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    if (error) rejectPromise(error)
    else resolvePromise(value!)
  }

  child.stdout.on('data', (chunk: Buffer | string) => {
    stdout += chunk.toString()
    const line = stdout.split(/\r?\n/, 1)[0]
    if (!line.startsWith('CALLBACK\t')) return
    const callbackUrl = line.slice('CALLBACK\t'.length).trim()
    if (!callbackUrl) finish(new Error('认证回调地址为空'))
    else finish(undefined, callbackUrl)
  })
  child.once('error', () => finish(new Error('无法启动系统登录授权')))
  child.once('close', (code) => {
    if (settled) return
    finish(new Error(code === 0 ? '登录授权未返回回调' : '登录授权已取消'))
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
