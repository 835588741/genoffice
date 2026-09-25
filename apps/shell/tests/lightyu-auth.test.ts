import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  startAuthSession: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/test-lightyu' },
  safeStorage: { isEncryptionAvailable: () => false },
}))
vi.mock('../src/main/auth-session', () => ({
  startAuthSession: mocks.startAuthSession,
}))
vi.mock('node:fs', () => ({
  readFileSync: (path: string) => {
    const value = mocks.disk.get(String(path))
    if (value === undefined) throw new Error('ENOENT')
    return value
  },
  writeFileSync: (path: string, value: string) => {
    mocks.disk.set(String(path), value)
  },
  existsSync: (path: string) => mocks.disk.has(String(path)),
  unlinkSync: (path: string) => {
    mocks.disk.delete(String(path))
  },
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
}))

let auth: typeof import('../src/main/lightyu-auth')
let complete: (value: Response) => void
let reject: (error: Error) => void
let exchangeSignal: AbortSignal | undefined
let exchangeBody: Record<string, unknown> | undefined
let revoked: string[]
let realFetch: typeof fetch

const authPath = '/test-lightyu/lightyu-auth.json'
const guestAuthPath = '/test-lightyu/lightyu-guest.json'

beforeEach(async () => {
  vi.resetModules()
  mocks.disk.clear()
  mocks.startAuthSession.mockReset()
  exchangeSignal = undefined
  exchangeBody = undefined
  revoked = []
  realFetch = globalThis.fetch
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options: RequestInit) => {
      if (url.startsWith('http://127.0.0.1:')) return realFetch(url, options)
      if (url.endsWith('/logout')) {
        revoked.push((options.headers as Record<string, string>).Authorization)
        return Promise.resolve(new Response('{}'))
      }
      exchangeSignal = options.signal as AbortSignal
      exchangeBody = JSON.parse(String(options.body)) as Record<string, unknown>
      // Deliberately ignore abort to exercise a response already buffered at cancellation.
      return new Promise<Response>((resolve, fail) => {
        complete = resolve
        reject = fail
      })
    }),
  )
  mocks.startAuthSession.mockImplementation((url: string) => {
    const authUrl = new URL(url)
    const target = new URL(authUrl.searchParams.get('redirect_uri')!)
    target.searchParams.set('state', authUrl.searchParams.get('state')!)
    target.searchParams.set('code', 'test-code')
    return { promise: Promise.resolve(target.toString()), cancel: vi.fn() }
  })
  auth = await import('../src/main/lightyu-auth')
})

afterEach(() => {
  auth.lightyuLogout()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function callback() {
  const events: { phase: string }[] = []
  auth.startLightyuLogin((event) => events.push(event))
  await vi.waitFor(() => expect(mocks.startAuthSession).toHaveBeenCalled())
  await vi.waitFor(() => expect(exchangeSignal).toBeDefined())
  return { events }
}

function success(token = 'test-token', expire = Date.now() + 30 * 86400000, guestMerged = false) {
  complete(
    Response.json({
      code: 200,
      data: { token, expire, guestMerged, profile: { nickname: 'Test', jindou: 1234 } },
    }),
  )
}

it('only reports browser success after token exchange and persistence succeed', async () => {
  const { events } = await callback()
  expect(auth.lightyuAccountStatus().loggedIn).toBe(false)
  success()
  await vi.waitFor(() => expect(events.at(-1)?.phase).toBe('success'))
  expect(auth.lightyuAccountStatus().loggedIn).toBe(true)
  expect(auth.lightyuAccountStatus().nickname).toBe('Test')
  expect(auth.lightyuAccountStatus().jindou).toBe(1234)
})

it('returns browser failure when token exchange fails', async () => {
  const { events } = await callback()
  complete(Response.json({ code: 500, msg: 'exchange failed' }))
  await vi.waitFor(() => expect(events.at(-1)?.phase).toBe('error'))
  expect(mocks.disk.has(authPath)).toBe(false)
})

it('ends the browser response on a network timeout', async () => {
  const { events } = await callback()
  reject(new DOMException('Timed out', 'TimeoutError'))
  await vi.waitFor(() => expect(events.at(-1)?.phase).toBe('error'))
  expect(auth.lightyuAccountStatus().loggedIn).toBe(false)
})

for (const action of ['logout', 'restart'] as const) {
  it(`rejects and revokes a late token after ${action}`, async () => {
    const { events } = await callback()
    const oldSignal = exchangeSignal!
    if (action === 'logout') auth.lightyuLogout()
    else auth.startLightyuLogin(() => {})
    expect(oldSignal.aborted).toBe(true)
    success('late-token')
    await vi.waitFor(() => expect(revoked).toContain('late-token'))
    expect(auth.lightyuAccountStatus().loggedIn).toBe(false)
    expect(mocks.disk.has(authPath)).toBe(false)
    expect(events.some((event) => event.phase === 'success')).toBe(false)
  })
}

it('clears a cached credential at its exact expiry', () => {
  const expiresAt = Date.now() + 1000
  mocks.disk.set(authPath, JSON.stringify({ token: 'cached-token', expiresAt, profile: {} }))
  expect(auth.lightyuAccountStatus().loggedIn).toBe(true)
  vi.spyOn(Date, 'now').mockReturnValue(expiresAt)
  expect(auth.lightyuAccountStatus().loggedIn).toBe(false)
  expect(mocks.disk.has(authPath)).toBe(false)
})

it('does not extend an already expired server credential by another 30 days', async () => {
  await callback()
  success('expired-token', Date.now() - 1)
  await vi.waitFor(() => expect(auth.lightyuAccountStatus().loggedIn).toBe(false))
  expect(auth.lightyuAccountStatus().loggedIn).toBe(false)
  await vi.waitFor(() => expect(revoked).toContain('expired-token'))
})

it('submits a guest token and clears it after a successful merge', async () => {
  auth.saveLightyuGuest('guest-token', Date.now() + 30 * 86400000)
  await callback()
  expect(exchangeBody?.guestToken).toBe('guest-token')
  success('member-token', Date.now() + 30 * 86400000, true)
  await vi.waitFor(() => expect(auth.lightyuServiceToken()).toBe('member-token'))
  expect(auth.lightyuServiceToken()).toBe('member-token')
  expect(mocks.disk.has(guestAuthPath)).toBe(false)
})

it('keeps a valid guest token when the server did not merge it', async () => {
  auth.saveLightyuGuest('guest-token', Date.now() + 30 * 86400000)
  await callback()
  success('member-token')
  await vi.waitFor(() => expect(auth.lightyuServiceToken()).toBe('member-token'))
  expect(auth.lightyuServiceToken()).toBe('member-token')
  expect(auth.lightyuGuestToken()).toBe('guest-token')
  expect(mocks.disk.has(guestAuthPath)).toBe(true)
})

it('removes an expired guest credential from disk', () => {
  mocks.disk.set(
    guestAuthPath,
    JSON.stringify({ token: 'expired-guest', expiresAt: Date.now() - 1, profile: {} }),
  )
  expect(auth.lightyuGuestToken()).toBeNull()
  expect(mocks.disk.has(guestAuthPath)).toBe(false)
})
