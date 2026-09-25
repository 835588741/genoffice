import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { AI_PROVIDERS, getProviderAdapter } from '@genoffice/ai-provider'
import type { AiSettings } from '@genoffice/ai-provider'
import { installDropOpenBridge } from '@genoffice/electron-utils/drop-open'
import type {
  AccountLoginEvent,
  AccountStatus,
  CloudProjectsSnapshot,
  HomeApi,
  RecentEntry,
  RecentPage,
  RenameResult,
  ProjectHomeApi,
  ProjectSummaryEntry,
  TimelineEntryItem,
  UiLanguage,
  AppleIapEvent,
  AppleIapProduct,
} from '../shared/home-api'
import { HOME_CHANNELS, PROJECT_CHANNELS } from '../shared/home-api'
import type { TabsApi, TabSummary } from '../shared/tabs-api'
import { TABS_CHANNELS } from '../shared/tabs-api'

const UI_LANGUAGES: readonly UiLanguage[] = [
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'th',
  'id',
  'ru',
  'ar',
  'pt',
  'it',
  'pl',
  'nl',
  'ms',
  'he',
  'hi',
  'zh-TW',
]

function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.includes(value as UiLanguage)
}

const EMPTY_PAGE: RecentPage = { entries: [], total: 0, totalAll: 0 }

/** Models exposed by the AiOffice desktop product. The gateway may publish
 * more providers, but the desktop UI intentionally keeps this catalog small. */
const DESKTOP_MODEL_LABELS: Readonly<Record<string, string>> = {
  'glm-5.3-flash': '智普模型',
  'deepseek-v4-flash-vision-exp': 'DeepSeek模型',
}

function asRecentPage(result: unknown): RecentPage {
  if (result && typeof result === 'object' && Array.isArray((result as RecentPage).entries)) {
    return result as RecentPage
  }
  return EMPTY_PAGE
}

const homeApi: HomeApi = {
  async recents(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.recents, query))
  },
  async starred(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.starred, query))
  },
  async statPaths(paths) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.statPaths, paths)
    return Array.isArray(result) ? (result as RecentEntry[]) : []
  },
  async toggleStar(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.toggleStar, path)
  },
  async openPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.openPath, path)
  },
  async browse() {
    await ipcRenderer.invoke(HOME_CHANNELS.browse)
  },
  async newDoc(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newDoc, opts)
  },
  async newSheet(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSheet, opts)
  },
  async newSlide(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSlide, opts)
  },
  async newMarkdown(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newMarkdown, opts)
  },
  async newPdf(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newPdf, opts)
  },
  async removeRecent(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.removeRecent, paths)
  },
  async revealPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.revealPath, path)
  },
  async renameFile(path, newName) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.renameFile, path, newName)
    return (result ?? { ok: false, error: 'Rename failed' }) as RenameResult
  },
  async duplicateFile(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.duplicateFile, path)
  },
  async deleteFiles(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.deleteFiles, paths)
  },
  async openTrash() {
    await ipcRenderer.invoke(HOME_CHANNELS.openTrash)
  },
  async getLanguage() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getLanguage)
    return isUiLanguage(result) ? result : 'zh'
  },
  async setLanguage(lang) {
    if (!isUiLanguage(lang)) throw new Error('Invalid language.')
    await ipcRenderer.invoke(HOME_CHANNELS.setLanguage, lang)
  },
  async getUpdateChannel() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getUpdateChannel)
    return result === 'beta' ? 'beta' : 'stable'
  },
  async setUpdateChannel(channel) {
    // validated inline: a runtime import from ../shared/update-api would be
    // shared with the update.ts preload entry and get split into a chunk,
    // which sandboxed preload scripts cannot load (window.aiOffice would
    // silently disappear). Preload entries must stay single-file bundles.
    if (channel !== 'stable' && channel !== 'beta') throw new Error('Invalid update channel.')
    await ipcRenderer.invoke(HOME_CHANNELS.setUpdateChannel, channel)
  },
  async accountStatus() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountStatus)
    return (result ?? { loggedIn: false }) as AccountStatus
  },
  async accountLogin() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountLogin)
    return result === true
  },
  async accountAppleLogin() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountAppleLogin)
    return result === true
  },
  onAccountLogin(handler) {
    const listener = (_event: IpcRendererEvent, ev: AccountLoginEvent) => handler(ev)
    ipcRenderer.on(HOME_CHANNELS.accountLoginEvent, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.accountLoginEvent, listener)
  },
  async accountSendEmailCode(account) {
    if (typeof account !== 'string' || account.trim().length === 0)
      throw new Error('请输入邮箱地址')
    await ipcRenderer.invoke(HOME_CHANNELS.accountSendEmailCode, account.trim())
  },
  async accountEmailLogin(account, code) {
    if (typeof account !== 'string' || account.trim().length === 0)
      throw new Error('请输入邮箱地址')
    if (typeof code !== 'string' || code.trim().length === 0) throw new Error('请输入验证码')
    await ipcRenderer.invoke(HOME_CHANNELS.accountEmailLogin, {
      account: account.trim(),
      code: code.trim(),
    })
  },
  async accountLogout() {
    await ipcRenderer.invoke(HOME_CHANNELS.accountLogout)
  },
  async accountDelete() {
    await ipcRenderer.invoke(HOME_CHANNELS.accountDelete)
  },
  async getAppVersion() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAppVersion)
    return typeof result === 'string' ? result : ''
  },
  async onboardingSeen() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.onboardingSeen)
    return result === true
  },
  async setOnboardingSeen() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setOnboardingSeen)
    return result === true
  },
  async getTheme() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getTheme)
    return result === 'dark' || result === 'light' ? result : 'system'
  },
  async setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system')
      throw new Error('Invalid theme.')
    await ipcRenderer.invoke(HOME_CHANNELS.setTheme, theme)
  },
  async getAnalyticsEnabled() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAnalyticsEnabled)
    return result === true
  },
  async setAnalyticsEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid analytics consent.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setAnalyticsEnabled, enabled)
    return result === true
  },
  async getAiDataSharingConsent() {
    const result: unknown = await ipcRenderer.invoke('ai:get-data-sharing-consent')
    return result === true
  },
  async revokeAiDataSharingConsent() {
    const result: unknown = await ipcRenderer.invoke('ai:revoke-data-sharing-consent')
    return result === true
  },
  async getDefaultSaveDir() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getDefaultSaveDir)
    return typeof result === 'string' ? result : ''
  },
  async pickDefaultSaveDir() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.pickDefaultSaveDir)
    return typeof result === 'string' && result ? result : null
  },
  onThemeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
      if (theme === 'light' || theme === 'dark' || theme === 'system') handler(theme)
    }
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  async openGenTeam() {
    await ipcRenderer.invoke(HOME_CHANNELS.openGenTeam)
  },
  async openCreditUsage() {
    await ipcRenderer.invoke(HOME_CHANNELS.openCreditUsage)
  },
  async openGitHubRepo() {
    await ipcRenderer.invoke(HOME_CHANNELS.openGitHubRepo)
  },
  async openLightyuWebsite() {
    await ipcRenderer.invoke(HOME_CHANNELS.openLightyuWebsite)
  },
  async openLightyuRecharge() {
    await ipcRenderer.invoke(HOME_CHANNELS.openLightyuRecharge)
  },
  async githubStars() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.githubStars)
    return typeof result === 'number' && Number.isFinite(result) ? result : null
  },
  async starPromptShouldShow() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.starPromptShouldShow)
    const raw = (result ?? {}) as { show?: unknown; docOpens?: unknown }
    return {
      show: raw.show === true,
      docOpens:
        typeof raw.docOpens === 'number' && Number.isFinite(raw.docOpens) ? raw.docOpens : 0,
    }
  },
  async starPromptAction(action) {
    if (action !== 'starred' && action !== 'later') throw new Error('Invalid star prompt action.')
    await ipcRenderer.invoke(HOME_CHANNELS.starPromptAction, action)
  },
  async cloudProjectsCached() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.cloudProjectsCached)
    return asCloudProjectsSnapshot(result)
  },
  async cloudProjectsSync() {
    // failures (network / CLI) resolve to null so the renderer keeps whatever it has
    try {
      const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.cloudProjects)
      return asCloudProjectsSnapshot(result)
    } catch {
      return null
    }
  },
  async openCloudProject(projectUrl) {
    if (typeof projectUrl !== 'string' || !projectUrl) throw new Error('Invalid project URL.')
    await ipcRenderer.invoke(HOME_CHANNELS.openCloudProject, projectUrl)
  },
  // AI settings channels are registered once by the shell's aggregated docs handlers
  async getAiSettings() {
    return (await ipcRenderer.invoke('ai:get-settings')) as AiSettings
  },
  async setAiSettings(settings) {
    await ipcRenderer.invoke('ai:set-settings', settings)
  },
  getAiProviders() {
    return AI_PROVIDERS.map((meta) => {
      let defaultBaseUrl = ''
      // genspark routes by model and custom has no default — both stay ''
      if (meta.id !== 'genspark' && !meta.needsBaseUrl) {
        defaultBaseUrl = getProviderAdapter(meta.id).resolveEndpoint({
          apiKey: '',
          model: meta.defaultModel,
        }).baseUrl
      }
      return { ...meta, defaultBaseUrl }
    })
  },
  async testAiSettings(settings) {
    const result: unknown = await ipcRenderer.invoke('ai:chat', {
      settings,
      system: 'You are a connectivity test. Reply with the single word OK.',
      user: 'ping',
    })
    const raw = (result ?? {}) as { ok?: unknown; error?: unknown }
    return raw.ok === true
      ? { ok: true }
      : { ok: false, error: typeof raw.error === 'string' ? raw.error : 'Connection failed' }
  },
  async desktopAiModels() {
    const result: unknown = await ipcRenderer.invoke('ai:desktop-models')
    const rawModels = extractModelList(result)
    return rawModels
      .filter((item): item is Record<string, unknown> => {
        if (!item || typeof item !== 'object') return false
        const model = item as Record<string, unknown>
        const id = modelIdentifier(model)
        return id !== null && Object.hasOwn(DESKTOP_MODEL_LABELS, id)
      })
      .map((item) => {
        const model = item as Record<string, unknown>
        const id = modelIdentifier(model)!
        const name = [
          model.name,
          model.display_name,
          model.displayName,
          model.label,
          model.title,
        ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)
        return {
          id,
          name: DESKTOP_MODEL_LABELS[id] ?? name?.trim() ?? id,
        }
      })
  },
  async desktopAiBilling(limit) {
    const result: unknown = await ipcRenderer.invoke('ai:desktop-billing', limit)
    return Array.isArray(result) ? result : []
  },
  async appleIapAvailable() {
    return (await ipcRenderer.invoke('home:apple-iap-available')) === true
  },
  async appleIapProducts() {
    const result: unknown = await ipcRenderer.invoke('home:apple-iap-products')
    return Array.isArray(result) ? (result as AppleIapProduct[]) : []
  },
  async appleIapPurchase(productId?: string) {
    const result: unknown = await ipcRenderer.invoke('home:apple-iap-purchase', productId)
    return result && typeof result === 'object'
      ? (result as { started: boolean; error?: string })
      : { started: false, error: '无法发起 Apple 内购' }
  },
  async appleIapRestore() {
    await ipcRenderer.invoke('home:apple-iap-restore')
  },
  onAppleIapEvent(handler) {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      if (value && typeof value === 'object') handler(value as AppleIapEvent)
    }
    ipcRenderer.on('home:apple-iap-event', listener)
    return () => ipcRenderer.removeListener('home:apple-iap-event', listener)
  },
}

function extractModelList(result: unknown): unknown[] {
  const queue: unknown[] = [result]
  const visited = new Set<object>()
  const collectionKeys = ['models', 'data', 'items', 'results', 'ModelList', 'model_list']
  while (queue.length > 0) {
    const current = queue.shift()
    if (Array.isArray(current)) {
      if (
        current.some(
          (item) =>
            item && typeof item === 'object' && modelIdentifier(item as Record<string, unknown>),
        )
      ) {
        return current
      }
      for (const item of current) {
        if (item && typeof item === 'object') queue.push(item)
      }
      continue
    }
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    const payload = current as Record<string, unknown>
    if (modelIdentifier(payload)) return [payload]
    for (const key of collectionKeys) {
      if (payload[key] !== undefined) queue.push(payload[key])
    }
  }
  throw new Error('模型目录格式错误')
}

function modelIdentifier(model: Record<string, unknown>): string | null {
  for (const key of ['id', 'model', 'model_id', 'modelId', 'model_name', 'name']) {
    const value = model[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function asCloudProjectsSnapshot(result: unknown): CloudProjectsSnapshot | null {
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as CloudProjectsSnapshot).projects)
  ) {
    return result as CloudProjectsSnapshot
  }
  return null
}

contextBridge.exposeInMainWorld('aiOffice', homeApi)

const projectApi: ProjectHomeApi = {
  async listProjects() {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.list)
    return Array.isArray(result) ? (result as ProjectSummaryEntry[]) : []
  },
  async listFiles(projectId) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.files, { projectId })
    return Array.isArray(result)
      ? result.filter((path): path is string => typeof path === 'string')
      : []
  },
  async createProject(name) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.create, { name })
    return result as ProjectSummaryEntry
  },
  async renameProject(id, name) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.rename, { id, name })
  },
  async deleteProject(id) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.delete, { id })
  },
  async moveFile(filePath, projectId) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.moveFile, { filePath, projectId })
  },
  async getTimeline(projectId, limit) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.timeline, {
      projectId,
      limit,
    })
    return Array.isArray(result) ? (result as TimelineEntryItem[]) : []
  },
}

contextBridge.exposeInMainWorld('aiOfficeProject', projectApi)

const tabsApi: TabsApi = {
  async list() {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.list)
    return Array.isArray(result) ? (result as TabSummary[]) : []
  },
  async activate(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.activate, id)
  },
  async close(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.close, id)
  },
  async showMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showMenu, x, y)
  },
  async showNewMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showNewMenu, x, y)
  },
  async reorder(id, toIndex) {
    await ipcRenderer.invoke(TABS_CHANNELS.reorder, id, toIndex)
  },
  onChanged(handler) {
    const listener = (_event: IpcRendererEvent, tabs: TabSummary[]) => handler(tabs)
    ipcRenderer.on(TABS_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.changed, listener)
  },
  notifyChromePressed() {
    ipcRenderer.send(TABS_CHANNELS.chromePressed)
  },
  onChromePressed(handler) {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
}

contextBridge.exposeInMainWorld('aiOfficeTabs', tabsApi)

// open documents dragged from the OS anywhere over Home or the tab strip
installDropOpenBridge()
