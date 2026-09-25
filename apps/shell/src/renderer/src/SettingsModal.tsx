import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Dropdown } from '@genoffice/ui'
import type { AiSettings } from '@genoffice/ai-provider'
import { useI18n } from './locale'
import type { StringKey, TFunc } from './locale'
import type {
  AccountStatus,
  AppleIapEvent,
  AppleIapProduct,
  DesktopAiBillingRecord,
  DesktopAiModel,
  UiTheme,
} from '../../shared/home-api'
import './settings.css'

// ── Settings modal (opened from the account menu) ─────────
// Genspark-style two-pane dialog: section nav on the left, fields on the right.
// All values go through the existing home IPC; nothing is stored locally.

// sorted by ISO 639 language code — native-script labels have no natural
// shared alphabet, so the code is the ordering key
const LANG_OPTIONS = [
  { value: 'ar', label: 'العربية' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'he', label: 'עברית' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'th', label: 'ไทย' },
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
] as const

// GenMail's option order: follow-system first, then the manual picks
const THEME_OPTIONS = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: UiTheme; labelKey: StringKey }[]

const CHANNEL_OPTIONS = [
  { value: 'stable', labelKey: 'channelStable' },
  { value: 'beta', labelKey: 'channelBeta' },
] as const satisfies readonly { value: 'stable' | 'beta'; labelKey: StringKey }[]

/** GitHub-style abbreviated stargazer count (2591 → "2.6k") — the number is
 * social proof, not a metric; the cached/exact value would only look stale */
function formatStars(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 100 ? Math.round(k) : (Math.round(k * 10) / 10).toString().replace(/\.0$/, '')}k`
}

type SectionId = 'account' | 'aiModel' | 'billing' | 'general' | 'about'

const SECTIONS: readonly { id: SectionId; labelKey?: StringKey; label?: string }[] = [
  { id: 'account', labelKey: 'setSecAccount' },
  { id: 'aiModel', labelKey: 'setSecAiModel' },
  { id: 'billing', label: '账单记录' },
  { id: 'general', labelKey: 'setSecGeneral' },
  { id: 'about', labelKey: 'setSecAbout' },
]

function SectionIcon({ id }: { id: SectionId }) {
  if (id === 'aiModel') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 1.8 9.5 6l4.2 1.5L9.5 9 8 13.2 6.5 9 2.3 7.5 6.5 6 8 1.8Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M12.8 11.2v3M11.3 12.7h3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'account') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="5.2" r="2.9" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2.7 13.6a5.5 5.5 0 0 1 10.6 0"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'billing') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M4 1.8h6.1L13 4.7v9.5H4V1.8Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M6.2 7h4M6.2 10h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (id === 'general') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 5h8M13 5h1M2 11h1M6 11h8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="11.5" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="4.5" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.4v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.8" fill="currentColor" />
    </svg>
  )
}

/** label-over-value field row with an optional right-aligned action */
function Field({
  label,
  value,
  valueTitle,
  action,
}: {
  label: string
  value: string
  valueTitle?: string
  action?: ReactNode
}) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value" data-tip={valueTitle}>
          {value}
        </div>
      </div>
      {action}
    </div>
  )
}

/** AiOffice only exposes CCH-synced models. Credentials stay in the main process. */
const LIGHTYU_LOGIN_ERROR = '请先前往设置完成轻语 API 授权登录'

function isLightyuLoginError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes(LIGHTYU_LOGIN_ERROR)
}

function AiModelPane({
  t,
  onLogin,
  loginWaiting,
}: {
  t: TFunc
  onLogin: () => void
  loginWaiting: boolean
}) {
  const defaultModelId = 'glm-5.3-flash'
  const [models, setModels] = useState<DesktopAiModel[]>([])
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loginRequired, setLoginRequired] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadModels = () => {
    setLoading(true)
    setErrorMessage(null)
    setLoginRequired(false)
    setSaved(false)
    let alive = true
    void Promise.all([window.aiOffice.getAiSettings(), window.aiOffice.desktopAiModels()])
      .then(([nextSettings, nextModels]) => {
        if (!alive) return
        const currentModel = nextSettings.providers.custom?.model ?? ''
        const fallbackModel =
          nextModels.find((model) => model.id === defaultModelId)?.id ?? nextModels[0]?.id
        const resolvedSettings =
          fallbackModel && !nextModels.some((model) => model.id === currentModel)
            ? {
                ...nextSettings,
                provider: 'custom' as const,
                providers: {
                  ...nextSettings.providers,
                  custom: { ...nextSettings.providers.custom, model: fallbackModel },
                },
              }
            : nextSettings
        setSettings(resolvedSettings)
        setModels(nextModels)
        // A CCH provider may be retired while a desktop client is offline.
        // Persist the first currently published model so the next document
        // request cannot keep sending a stale model id.
        if (resolvedSettings !== nextSettings) {
          void window.aiOffice.setAiSettings(resolvedSettings).catch(() => {
            if (alive) setErrorMessage('模型已更新，请点击保存后重试')
          })
        }
      })
      .catch(
        (error) => {
          if (!alive) return
          const message = error instanceof Error ? error.message : '模型目录暂不可用'
          if (isLightyuLoginError(error)) {
            setLoginRequired(true)
            setErrorMessage(null)
          } else {
            setErrorMessage(message)
          }
        },
      )
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }

  useEffect(loadModels, [])

  const selected = settings?.providers.custom?.model ?? ''
  const selectedModel = models.find((model) => model.id === selected)
  const pickModel = (model: string) => {
    if (!settings) return
    setSettings({
      ...settings,
      provider: 'custom',
      providers: { ...settings.providers, custom: { ...settings.providers.custom, model } },
    })
    setLoginRequired(false)
    setErrorMessage(null)
    setSaved(false)
  }
  const save = () => {
    if (!settings || !selectedModel) return
    void window.aiOffice
      .setAiSettings(settings)
      .then(() => {
        setErrorMessage(null)
        setSaved(true)
      })
      .catch((error) => {
        setSaved(false)
        const message = error instanceof Error ? error.message : '保存失败'
        if (isLightyuLoginError(error)) {
          setLoginRequired(true)
          setErrorMessage(null)
        } else {
          setErrorMessage(message)
        }
      })
  }

  return (
    <>
      <h3 className="set-pane-title">{t('setSecAiModel')}</h3>
      <div className="set-field" aria-busy={loading}>
        <div className="set-field-text">
          <label className="set-field-label">{t('setAiModelId')}</label>
        </div>
        <Dropdown
          className="set-dd"
          value={selected}
          ariaLabel={t('setAiModelId')}
          options={models.map((model) => ({ value: model.id, label: model.name }))}
          disabled={loading || Boolean(errorMessage) || models.length === 0}
          onPick={pickModel}
        />
      </div>
      {loading && <div className="set-empty-state">正在加载模型...</div>}
      {!loading && loginRequired && (
        <div className="set-empty-state set-model-error" role="alert">
          <span>请先登录轻语 API 后加载 AI 模型</span>
          <div className="set-model-error-actions">
            <button className="set-btn primary" onClick={onLogin}>
              {loginWaiting ? t('waitingShort') : '登录轻语 API'}
            </button>
            <button className="set-btn" onClick={loadModels}>
              重新加载
            </button>
          </div>
        </div>
      )}
      {!loading && errorMessage && !loginRequired && (
        <div className="set-empty-state set-model-error" role="alert">
          <span>{errorMessage}</span>
          <button className="set-btn" onClick={loadModels}>
            重新加载
          </button>
        </div>
      )}
      {!loading && !errorMessage && models.length === 0 && (
        <div className="set-empty-state set-model-error" role="status">
          <span>暂无可用模型</span>
          <button className="set-btn" onClick={loadModels}>
            重新加载
          </button>
        </div>
      )}
      <div className="set-pane-footer">
        {saved && <AiStatusPill status={{ kind: 'ok', text: '已保存' }} />}
        <button className="set-btn primary" disabled={!selectedModel || loading} onClick={save}>
          {t('setAiSave')}
        </button>
      </div>
    </>
  )
}

function AiBillingPane() {
  const [records, setRecords] = useState<DesktopAiBillingRecord[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    void window.aiOffice
      .desktopAiBilling(50)
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const formatBillingTime = (value: string): string => {
    const raw = value.trim()
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
    const isoValue = raw.includes('T') ? raw : raw.replace(' ', 'T')
    const utcValue = /^\d{4}-\d{2}-\d{2}$/.test(isoValue)
      ? `${isoValue}T00:00:00Z`
      : hasTimezone
        ? isoValue
        : `${isoValue}Z`
    const date = new Date(utcValue)
    if (Number.isNaN(date.getTime())) return value
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(date)
    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
  }

  const formatBillingModel = (value: string): string => {
    const model = value.toLowerCase()
    if (model.includes('glm')) return 'GLM模型'
    if (model.includes('deepseek')) return 'DeepSeek模型'
    return 'AI模型'
  }

  return (
    <>
      <h3 className="set-pane-title">账单记录</h3>
      <div className="set-billing-list" aria-busy={loading}>
        {records.map((record) => (
          <div className="set-billing-row" key={record.request_id}>
            <div className="set-billing-main">
              <div className="set-billing-model">{formatBillingModel(record.model)}</div>
              <div className="set-billing-meta">
                输入 {record.input_tokens ?? 0} / 输出 {record.output_tokens ?? 0} Token
              </div>
            </div>
            <div className="set-billing-cost">
              <strong>{record.jindou ?? 0} 金豆</strong>
              <div className="set-billing-time">{formatBillingTime(record.create_time)}</div>
              {record.status.toUpperCase() === 'FAILED' && (
                <span className="set-billing-status failed">
                  {record.error_message?.trim() || '扣费失败'}
                </span>
              )}
            </div>
          </div>
        ))}
        {!loading && records.length === 0 && <div className="set-empty-state">暂无 AI 账单</div>}
      </div>
      <div className="set-pane-footer">
        <button className="set-btn" onClick={load}>
          刷新
        </button>
      </div>
    </>
  )
}

interface AiStatus {
  kind: 'testing' | 'ok' | 'err'
  text: string
}

/** colored feedback pill in the AI pane footer: spinner while testing, then success/error */
function AiStatusPill({ status }: { status: AiStatus | null }) {
  if (!status) return null
  return (
    <span
      className={`set-ai-status ${status.kind}`}
      role="status"
      // error text (HTTP body, network message) can be long — full text via native tooltip
      title={status.kind === 'err' ? status.text : undefined}
    >
      {status.kind === 'testing' ? (
        <span className="set-ai-spin" aria-hidden="true" />
      ) : status.kind === 'ok' ? (
        <svg
          className="set-ai-status-icon"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="6.3" fill="currentColor" opacity="0.16" />
          <path
            d="M4.2 7.3l1.9 1.9 3.7-4.3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      ) : (
        <svg
          className="set-ai-status-icon"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="6.3" fill="currentColor" opacity="0.16" />
          <path d="M7 3.8v3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="7" cy="10.1" r="1" fill="currentColor" />
        </svg>
      )}
      <span className="set-ai-status-text">{status.text}</span>
    </span>
  )
}

function LoginPane({
  loginWaiting,
  onEmailSendCode,
  onEmailLogin,
  onAppleLogin,
  onLightyuLogin,
}: {
  loginWaiting: boolean
  onEmailSendCode: (account: string) => Promise<void>
  onEmailLogin: (account: string, code: string) => Promise<void>
  onAppleLogin: () => void
  onLightyuLogin: () => void
}) {
  const [account, setAccount] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  const sendCode = async () => {
    setError('')
    setSending(true)
    try {
      await onEmailSendCode(account)
      setCooldown(60)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '验证码发送失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onEmailLogin(account, code)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="set-login-pane">
      <div className="set-login-heading">
        <div className="set-login-mark" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
            <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--color-btn-primary)" />
            <path
              d="M9 11.5h14M9 16h10M9 20.5h7"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div>
          <h3 className="set-login-title">登录 AiOffice</h3>
          <p className="set-login-subtitle">使用邮箱或第三方账号继续</p>
        </div>
      </div>
      <form className="set-login-form" onSubmit={(event) => void submit(event)}>
        <label className="set-login-label" htmlFor="aioffice-login-email">
          邮箱
        </label>
        <input
          id="aioffice-login-email"
          className="set-login-input"
          type="email"
          autoComplete="email"
          placeholder="请输入邮箱地址"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          required
        />
        <label className="set-login-label" htmlFor="aioffice-login-code">
          邮箱验证码
        </label>
        <div className="set-login-code-row">
          <input
            id="aioffice-login-code"
            className="set-login-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="请输入验证码"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          <button
            className="set-btn set-login-code-btn"
            type="button"
            disabled={sending || cooldown > 0 || !account.trim()}
            onClick={() => void sendCode()}
          >
            {sending ? '发送中…' : cooldown > 0 ? `${cooldown}s` : '发送验证码'}
          </button>
        </div>
        {error && (
          <div className="set-login-error" role="alert">
            {error}
          </div>
        )}
        <button className="set-btn primary set-login-submit" type="submit" disabled={submitting}>
          {submitting ? '登录中…' : '邮箱登录 / 注册'}
        </button>
      </form>
      <div className="set-login-divider" aria-hidden="true">
        <span>或</span>
      </div>
      <div className="set-login-providers">
        <button className="set-btn set-login-provider apple" disabled={loginWaiting} onClick={onAppleLogin}>
          <span className="set-apple-mark" aria-hidden="true">●</span>
          {loginWaiting ? '正在授权…' : '使用 Apple 登录'}
        </button>
        <button className="set-btn set-login-provider" disabled={loginWaiting} onClick={onLightyuLogin}>
          轻语 API 授权登录
        </button>
      </div>
      <p className="set-login-legal">登录即表示你同意轻语 API 的服务条款和隐私政策。</p>
    </div>
  )
}

export interface SettingsModalProps {
  status: AccountStatus | null
  loggingOut: boolean
  deletingAccount: boolean
  /** system sign-in in progress (spinner shows on the account entry) */
  loginWaiting: boolean
  onClose: () => void
  /** launches the native Lightyu login flow */
  onLogin: () => void
  onAppleLogin: () => void
  onEmailSendCode: (account: string) => Promise<void>
  onEmailLogin: (account: string, code: string) => Promise<void>
  onLogout: () => void
  onDeleteAccount: () => Promise<void>
}

export function SettingsModal({
  status,
  loggingOut,
  deletingAccount,
  loginWaiting,
  onClose,
  onLogin,
  onAppleLogin,
  onEmailSendCode,
  onEmailLogin,
  onLogout,
  onDeleteAccount,
}: SettingsModalProps) {
  const { lang, setLang, t } = useI18n()
  const [section, setSection] = useState<SectionId>('account')
  const [theme, setTheme] = useState<UiTheme>('system')
  const [saveDir, setSaveDir] = useState('')
  const [analyticsOn, setAnalyticsOn] = useState(false)
  const [analyticsSaving, setAnalyticsSaving] = useState(false)
  const [aiDataSharingOn, setAiDataSharingOn] = useState(false)
  const [aiDataSharingSaving, setAiDataSharingSaving] = useState(false)
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable')
  const [appVersion, setAppVersion] = useState('')
  const [githubStars, setGithubStars] = useState<number | null>(null)
  // `null` avoids briefly exposing web checkout while a MAS/TestFlight build
  // is discovering its StoreKit capability. Apple review must never see an
  // external payment path alongside in-app purchases.
  const [appleIapSupported, setAppleIapSupported] = useState<boolean | null>(null)
  const [appleIapProducts, setAppleIapProducts] = useState<AppleIapProduct[]>([])
  const [appleIapBusy, setAppleIapBusy] = useState(false)
  const [appleIapActiveProductId, setAppleIapActiveProductId] = useState<string | null>(null)
  const [appleIapError, setAppleIapError] = useState<string | null>(null)
  const [appleBalance, setAppleBalance] = useState<number | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletePhrase, setDeletePhrase] = useState('')
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    let alive = true
    void window.aiOffice.getTheme?.().then((th) => {
      if (alive) setTheme(th)
    })
    void window.aiOffice.getDefaultSaveDir?.().then((dir) => {
      if (alive && dir) setSaveDir(dir)
    })
    void window.aiOffice.getAnalyticsEnabled?.().then((on) => {
      if (alive) setAnalyticsOn(on === true)
    })
    void window.aiOffice.getAiDataSharingConsent?.().then((on) => {
      if (alive) setAiDataSharingOn(on === true)
    })
    void window.aiOffice.getUpdateChannel?.().then((ch) => {
      if (alive) setChannel(ch)
    })
    void window.aiOffice.getAppVersion?.().then((v) => {
      if (alive && v) setAppVersion(v)
    })
    void window.aiOffice.githubStars?.().then((n) => {
      if (alive && n !== null) setGithubStars(n)
    })
    if (!window.aiOffice.appleIapAvailable) {
      setAppleIapSupported(false)
    } else {
      void window.aiOffice
        .appleIapAvailable()
        .then((supported) => {
          if (!alive) return
          setAppleIapSupported(supported)
          if (!supported) return
          void window.aiOffice.appleIapProducts?.().then((products) => {
            if (alive) setAppleIapProducts(products)
          })
        })
        .catch(() => {
          if (alive) setAppleIapSupported(false)
        })
    }
    const removeAppleIapListener = window.aiOffice.onAppleIapEvent?.((event: AppleIapEvent) => {
      if (event.phase === 'purchasing' || event.phase === 'deferred') {
        setAppleIapBusy(true)
        setAppleIapActiveProductId(event.productId)
        setAppleIapError(null)
      } else if (event.phase === 'success') {
        setAppleIapBusy(false)
        setAppleIapActiveProductId(null)
        setAppleIapError(null)
        setAppleBalance(event.balance)
      } else {
        setAppleIapBusy(false)
        setAppleIapActiveProductId(null)
        setAppleIapError('error' in event ? event.error : 'Apple 交易失败')
      }
    })
    return () => {
      alive = false
      removeAppleIapListener?.()
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const applyTheme = (next: UiTheme) => {
    setTheme(next)
    void window.aiOffice.setTheme(next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
  }

  const changeSaveDir = () => {
    void window.aiOffice.pickDefaultSaveDir?.().then((dir) => {
      if (dir) setSaveDir(dir)
    })
  }

  const loggedIn = status?.loggedIn ?? false
  const nickname = status?.nickname ?? ''
  const jindou = appleBalance ?? (typeof status?.jindou === 'number' ? status.jindou : 0)
  const avatar = status?.avatar?.trim() ?? ''
  const isChinese = lang === 'zh' || lang === 'zh-TW'
  const aiSharingLabel = isChinese ? '允许云端 AI 处理内容' : 'Allow cloud AI data processing'
  const aiSharingDescription = aiDataSharingOn
    ? isChinese
      ? '已同意轻语 API 及所选模型服务商处理您主动发送的指令和文件内容。关闭后，下次使用 AI 会重新征求同意。'
      : 'Lightyu API and the selected model provider may process prompts and file content you choose to send. Turn this off to ask again before the next AI request.'
    : isChinese
      ? '当前未授权。首次使用 AI 时会先说明发送的数据、接收方和用途；不同意不影响本地编辑。'
      : 'Not allowed. Before the first AI request, AiOffice will explain what is sent, who receives it, and why. Local editing remains available if you decline.'

  return (
    <div
      className="set-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="set-dialog" role="dialog" aria-modal="true" aria-label={t('settings')}>
        <div className="set-header">
          <h2 className="set-title">{t('settings')}</h2>
          <button className="set-close" onClick={onClose} aria-label={t('cancel')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="set-body">
          <nav className="set-nav" aria-label={t('settings')}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`set-nav-item${section === s.id ? ' active' : ''}`}
                aria-current={section === s.id}
                onClick={() => setSection(s.id)}
              >
                <SectionIcon id={s.id} />
                {s.labelKey ? t(s.labelKey) : s.label}
              </button>
            ))}
          </nav>
          <div className="set-pane">
            {section === 'account' && (
              <>
                <h3 className="set-pane-title">{t('setSecAccount')}</h3>
                {loggedIn ? (
                  <>
                    <div className="set-account-profile">
                      {avatar ? (
                        <img className="set-account-avatar" src={avatar} alt="" />
                      ) : (
                        <div
                          className="set-account-avatar set-account-avatar-fallback"
                          aria-hidden="true"
                        >
                          {(nickname || t('account')).slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="set-account-profile-info">
                        <div className="set-account-profile-name" title={nickname || t('account')}>
                          {nickname || t('account')}
                        </div>
                        <div className="set-account-profile-balance">{jindou} 金豆</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <LoginPane
                    loginWaiting={loginWaiting}
                    onEmailSendCode={onEmailSendCode}
                    onEmailLogin={onEmailLogin}
                    onAppleLogin={onAppleLogin}
                    onLightyuLogin={onLogin}
                  />
                )}
                {loggedIn && appleIapSupported === false && (
                  <div className="set-account-service">
                    <div className="set-account-service-info">
                      <button
                        className="set-account-service-site"
                        onClick={() => void window.aiOffice.openLightyuWebsite()}
                      >
                        5555api.com
                      </button>
                      <div className="set-account-service-company">上海栾青网络科技有限公司</div>
                      <div className="set-account-service-note">
                        {loggedIn ? '前往轻语 API 充值金豆' : '登录轻语 API 后可充值金豆'}
                      </div>
                    </div>
                    <button
                      className="set-btn primary set-account-recharge-btn"
                      onClick={() => void window.aiOffice.openLightyuRecharge()}
                    >
                      充值金豆
                    </button>
                  </div>
                )}
                {loggedIn && appleIapSupported === true && (
                  <div className="set-account-iap" role="group" aria-label="Apple 内购充值">
                    <div className="set-account-iap-title">Apple 内购充值</div>
                    {appleIapProducts.length > 0 ? (
                      <div className="set-account-iap-grid">
                        {appleIapProducts.map((product) => (
                          <button
                            className="set-account-iap-option"
                            key={product.id}
                            disabled={appleIapBusy}
                            onClick={() => {
                              setAppleIapBusy(true)
                              setAppleIapActiveProductId(product.id)
                              setAppleIapError(null)
                              void window.aiOffice.appleIapPurchase(product.id).then((result) => {
                                if (!result.started) {
                                  setAppleIapBusy(false)
                                  setAppleIapActiveProductId(null)
                                  setAppleIapError(result.error ?? '无法发起 Apple 内购')
                                }
                              })
                            }}
                          >
                            <span className="set-account-iap-beans">{product.beans} 金豆</span>
                            <span className="set-account-iap-price">
                              {appleIapActiveProductId === product.id && appleIapBusy
                                ? '处理中…'
                                : product.formattedPrice}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="set-account-iap-status">
                        请从 App Store 或 TestFlight 运行 AiOffice 以加载内购商品
                      </div>
                    )}
                    <button
                      className="set-btn"
                      disabled={appleIapBusy}
                      onClick={() => {
                        setAppleIapBusy(true)
                        setAppleIapError(null)
                        void window.aiOffice
                          .appleIapRestore()
                          .catch((error) => {
                            setAppleIapError(
                              error instanceof Error ? error.message : '恢复交易失败',
                            )
                          })
                          .finally(() => setAppleIapBusy(false))
                      }}
                    >
                      {appleIapBusy ? '处理中…' : '恢复未完成交易'}
                    </button>
                    {appleIapError ? `：${appleIapError}` : ''}
                  </div>
                )}
                {loggedIn && (
                  <div className="set-pane-footer">
                    <button className="set-btn" disabled={loggingOut || deletingAccount} onClick={onLogout}>
                      {loggingOut ? t('loggingOut') : t('logout')}
                    </button>
                    <button
                      className="set-btn danger"
                      disabled={loggingOut || deletingAccount}
                      onClick={() => {
                        setDeletePhrase('')
                        setDeleteError('')
                        setDeleteConfirmOpen(true)
                      }}
                    >
                      删除账号
                    </button>
                  </div>
                )}
              </>
            )}
            {section === 'aiModel' && (
              <AiModelPane t={t} onLogin={onLogin} loginWaiting={loginWaiting} />
            )}
            {section === 'billing' && <AiBillingPane />}
            {section === 'general' && (
              <>
                <h3 className="set-pane-title">{t('setSecGeneral')}</h3>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('language')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={lang}
                    ariaLabel={t('language')}
                    options={LANG_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                    onPick={(v) => setLang(v as typeof lang)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('theme')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={theme}
                    ariaLabel={t('theme')}
                    options={THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyTheme(v as UiTheme)}
                  />
                </div>
                <Field
                  label={t('saveLocation')}
                  value={saveDir || '—'}
                  valueTitle={saveDir}
                  action={
                    <button className="set-btn" onClick={changeSaveDir}>
                      {t('setChange')}
                    </button>
                  }
                />
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAnalytics')}</div>
                      <div className="set-field-desc">{t('setAnalyticsDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={analyticsOn}
                    aria-label={t('setAnalytics')}
                    disabled={analyticsSaving}
                    onClick={() => {
                      const next = !analyticsOn
                      setAnalyticsSaving(true)
                      void window.aiOffice
                        .setAnalyticsEnabled(next)
                        .then((persisted) => {
                          if (persisted) setAnalyticsOn(next)
                        })
                        .catch(() => {})
                        .finally(() => setAnalyticsSaving(false))
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{aiSharingLabel}</div>
                      <div className="set-field-desc">{aiSharingDescription}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={aiDataSharingOn}
                    aria-label={aiSharingLabel}
                    disabled={!aiDataSharingOn || aiDataSharingSaving}
                    onClick={() => {
                      setAiDataSharingSaving(true)
                      void window.aiOffice
                        .revokeAiDataSharingConsent()
                        .then((revoked) => {
                          if (revoked) setAiDataSharingOn(false)
                        })
                        .catch(() => {})
                        .finally(() => setAiDataSharingSaving(false))
                    }}
                  />
                </div>
              </>
            )}
            {section === 'about' && (
              <>
                <h3 className="set-pane-title">{t('setSecAbout')}</h3>
                <Field label={t('versionLabel')} value={appVersion || '—'} />
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('updateChannel')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={channel}
                    ariaLabel={t('updateChannel')}
                    options={CHANNEL_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => {
                      const next = v === 'beta' ? 'beta' : 'stable'
                      setChannel(next)
                      void window.aiOffice.setUpdateChannel(next)
                    }}
                  />
                </div>
                <Field
                  label={t('setGithub')}
                  value={
                    githubStars === null
                      ? 'github.com/genspark-ai/genoffice'
                      : `github.com/genspark-ai/genoffice · ★ ${formatStars(githubStars)}`
                  }
                  action={
                    <button
                      className="set-btn"
                      onClick={() => void window.aiOffice.openGitHubRepo?.()}
                    >
                      {t('starOnGitHub')}
                    </button>
                  }
                />
              </>
            )}
          </div>
        </div>
        {deleteConfirmOpen && (
          <div className="set-confirm-overlay" role="presentation">
            <div className="set-confirm-dialog" role="alertdialog" aria-modal="true" aria-label="删除账号">
              <h3>删除账号</h3>
              <p>此操作不可恢复。账号资料、登录凭据和未使用的金豆将被删除，本地文档不会受到影响。</p>
              <p>请输入“删除账号”确认。</p>
              <input
                className="set-login-input"
                value={deletePhrase}
                onChange={(event) => setDeletePhrase(event.target.value)}
                autoFocus
                aria-label="删除账号确认文本"
              />
              {deleteError && <div className="set-login-error" role="alert">{deleteError}</div>}
              <div className="set-confirm-actions">
                <button className="set-btn" disabled={deletingAccount} onClick={() => setDeleteConfirmOpen(false)}>
                  取消
                </button>
                <button
                  className="set-btn danger"
                  disabled={deletingAccount || deletePhrase.trim() !== '删除账号'}
                  onClick={() => {
                    setDeleteError('')
                    void onDeleteAccount().catch((cause) => {
                      setDeleteError(cause instanceof Error ? cause.message : '账号删除失败，请稍后重试')
                    })
                  }}
                >
                  {deletingAccount ? '删除中…' : '永久删除'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
