import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const docsMain = readFileSync(join(__dirname, '../../docs/src/main/docs-main.ts'), 'utf8')
const shellMain = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
const shellAuth = readFileSync(join(__dirname, '../src/main/lightyu-auth.ts'), 'utf8')
const nativeAuth = readFileSync(join(__dirname, '../native/auth-session.swift'), 'utf8')
const authBuild = readFileSync(join(__dirname, '../scripts/build-auth-session.mjs'), 'utf8')
const authSession = readFileSync(join(__dirname, '../src/main/auth-session.ts'), 'utf8')
const analytics = readFileSync(join(__dirname, '../src/main/analytics.ts'), 'utf8')
const builder = readFileSync(join(__dirname, '../electron-builder.cjs'), 'utf8')

describe('App Review regression contracts', () => {
  it('requires explicit AI data-sharing consent before chat or streaming providers run', () => {
    const streamHandler = docsMain.indexOf("ipcMain.handle('ai:stream'")
    const streamConsent = docsMain.indexOf(
      'promptForAiDataSharingConsent(event.sender)',
      streamHandler,
    )
    const streamProvider = docsMain.indexOf('await streamForProvider(', streamHandler)
    const chatHandler = docsMain.indexOf("ipcMain.handle('ai:chat'")
    const chatConsent = docsMain.indexOf('promptForAiDataSharingConsent(event.sender)', chatHandler)
    const chatProvider = docsMain.indexOf('chatForProvider(', chatHandler)

    expect(streamHandler).toBeGreaterThan(-1)
    expect(streamConsent).toBeGreaterThan(streamHandler)
    expect(streamProvider).toBeGreaterThan(streamConsent)
    expect(chatHandler).toBeGreaterThan(-1)
    expect(chatConsent).toBeGreaterThan(chatHandler)
    expect(chatProvider).toBeGreaterThan(chatConsent)
    expect(docsMain).toContain('上海栾青网络科技有限公司')
    expect(docsMain).toContain('Zhipu AI or DeepSeek')
    expect(docsMain).toContain('Google Serper, Tavily, or DuckDuckGo')
  })

  it('recreates the shell from Dock activation and the persistent New Window command', () => {
    expect(shellMain).toContain("app.on('activate', () => {\n    revealShellWindow()")
    expect(shellMain).toContain('setDocsShellNewWindowHook(() => {')
    expect(shellMain).toContain('setDocsShellHooks(null)')
    expect(shellMain).toContain('win.hide()')
    expect(shellMain).toContain('function openHomeWindow(): void')
    expect(shellMain).toContain('revealShellWindow()')
    expect(shellMain).toContain("tm('backToHome')")
  })

  it('uses explicit analytics opt-in and native web authentication', () => {
    expect(analytics).toContain('settings[ANALYTICS_ENABLED_KEY] === true')
    expect(shellAuth).toContain('startAuthSession')
    expect(shellAuth).not.toContain('shell.openExternal')
    expect(shellAuth).toContain('isExpectedCallback')
    expect(nativeAuth).toContain('ASWebAuthenticationSession')
    expect(nativeAuth).toContain('NSApplication.shared')
    expect(nativeAuth).toContain('presentationAnchor')
    expect(builder).toContain("const AUTH_SESSION_HELPER = 'native/AiOffice.app'")
    expect(builder).toContain('to: AUTH_SESSION_HELPER')
    expect(authBuild).toContain('CFBundleDisplayName')
    expect(authBuild).toContain('<string>AiOffice</string>')
    expect(authSession).toContain("'native', 'AiOffice.app', 'Contents', 'MacOS', 'auth-session'")
    expect(authBuild).toContain('codesign')
    expect(authBuild).toContain('entitlements.mas.inherit.plist')
  })

  it('keeps account recovery and deletion inside the app process', () => {
    expect(shellAuth).toContain('/data/user/sendEmailCode')
    expect(shellAuth).toContain('/data/user/desktop/email-login')
    expect(shellAuth).toContain('/data/user/deleteAccount')
    expect(shellAuth).toContain("lastAuthUrl = `${API_BASE_URL}/login.html?")
    expect(shellMain).toContain('HOME_CHANNELS.accountSendEmailCode')
    expect(shellMain).toContain('HOME_CHANNELS.accountEmailLogin')
    expect(shellMain).toContain('HOME_CHANNELS.accountDelete')
    expect(shellMain).toContain('startAppleLogin')
  })

  it('allows the sandboxed sign-in callback server to listen on localhost', () => {
    const entitlements = readFileSync(join(__dirname, '../build/entitlements.mas.plist'), 'utf8')
    expect(entitlements).toMatch(/<key>com\.apple\.security\.network\.server<\/key>\s*<true\/>/)
  })
})
