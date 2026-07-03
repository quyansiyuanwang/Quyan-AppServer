export type CaptchaProvider = 'none' | 'recaptcha' | 'turnstile'

export interface PublicCaptchaConfig {
  enabled: boolean
  provider: CaptchaProvider
  fallbackProvider: CaptchaProvider
}

export interface CaptchaRenderState {
  provider: CaptchaProvider
  enabled: boolean
  ready: boolean
  widgetVisible: boolean
}

export interface CaptchaDisplayMeta {
  provider: CaptchaProvider
  mode: 'hidden' | 'visible'
}

const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim() || ''
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || ''
const RECAPTCHA_SCRIPT_ID = 'recaptcha-v3-script'
const TURNSTILE_SCRIPT_ID = 'turnstile-script'
const CAPTCHA_LOAD_TIMEOUT_MS = 10000
const CAPTCHA_EXECUTE_TIMEOUT_MS = 10000
const RECAPTCHA_MAX_RETRIES = 2
const RECAPTCHA_SCRIPT_HOSTS = ['www.recaptcha.net', 'www.google.com'] as const
const RECAPTCHA_FALLBACK_LOCALE = 'en'
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

const defaultCaptchaConfig = (): PublicCaptchaConfig => {
  if (RECAPTCHA_SITE_KEY) {
    return {
      enabled: true,
      provider: 'recaptcha',
      fallbackProvider: TURNSTILE_SITE_KEY ? 'turnstile' : 'none',
    }
  }

  if (TURNSTILE_SITE_KEY) {
    return {
      enabled: true,
      provider: 'turnstile',
      fallbackProvider: 'none',
    }
  }

  return {
    enabled: false,
    provider: 'none',
    fallbackProvider: 'none',
  }
}

const normalizeCaptchaProvider = (value: unknown): CaptchaProvider => {
  if (value === 'recaptcha' || value === 'turnstile' || value === 'none') return value
  return 'none'
}

const buildBackendUrl = (path: string) => {
  const baseUrl = import.meta.env.VITE_BACKEND_URL?.trim() || ''
  if (!baseUrl) return path
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}

const normalizeRecaptchaLocale = (locale: string) => {
  const normalized = locale.trim().toLowerCase()
  if (!normalized) return RECAPTCHA_FALLBACK_LOCALE
  if (normalized.startsWith('zh')) return 'zh-CN'
  return RECAPTCHA_FALLBACK_LOCALE
}

const getPreferredRecaptchaLocale = () => {
  if (typeof document !== 'undefined' && document.documentElement.lang) {
    return normalizeRecaptchaLocale(document.documentElement.lang)
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalizeRecaptchaLocale(navigator.language)
  }

  return RECAPTCHA_FALLBACK_LOCALE
}

const getRecaptchaScriptCandidates = () => {
  const preferredLocale = getPreferredRecaptchaLocale()
  const locales = [...new Set([preferredLocale, RECAPTCHA_FALLBACK_LOCALE])]

  return RECAPTCHA_SCRIPT_HOSTS.flatMap((host) =>
    locales.map(
      (locale) =>
        `https://${host}/recaptcha/api.js?render=${encodeURIComponent(RECAPTCHA_SITE_KEY)}&hl=${encodeURIComponent(locale)}`,
    ),
  )
}

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  if (typeof window === 'undefined') return promise

  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)

    promise
      .then((result) => {
        window.clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        window.clearTimeout(timer)
        reject(error)
      })
  })
}

let runtimeConfigCache: PublicCaptchaConfig | null = null
let runtimeConfigPromise: Promise<PublicCaptchaConfig> | null = null
let recaptchaLoadPromise: Promise<void> | null = null
let turnstileLoadPromise: Promise<void> | null = null
let recaptchaScriptCandidateIndex = 0
let turnstileContainer: HTMLDivElement | null = null
let turnstileWidgetId: string | null = null
let turnstileWidgetAction = ''
let turnstileVisibleContainer: HTMLElement | null = null
let turnstileVisibleToken = ''
let turnstileVisibleTokenAction = ''
let turnstileVisibleSuccessHandler: ((token: string) => void) | null = null

declare global {
  interface Window {
    grecaptcha?: {
      ready: (callback: () => void) => void
      execute: (siteKey: string, options: { action: string }) => Promise<string>
    }
    turnstile?: {
      render: (element: string | HTMLElement, options: Record<string, unknown>) => string
      execute: (widgetId: string) => void
      reset: (widgetId?: string) => void
      remove: (widgetId: string) => void
    }
  }
}

export async function getCaptchaRuntimeConfig(force = false): Promise<PublicCaptchaConfig> {
  if (!force && runtimeConfigCache) return runtimeConfigCache
  if (!force && runtimeConfigPromise) return runtimeConfigPromise

  runtimeConfigPromise = (async () => {
    try {
      const response = await fetch(buildBackendUrl('/v1/config/public/captcha'), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      })

      if (!response.ok) throw new Error(`Captcha config request failed: ${response.status}`)

      const payload = (await response.json()) as {
        code?: number
        data?: Partial<PublicCaptchaConfig>
        enabled?: boolean
        provider?: string
        fallbackProvider?: string
      }

      const source = payload.data ?? payload
      const provider = normalizeCaptchaProvider(source.provider)
      const fallbackProvider = normalizeCaptchaProvider(source.fallbackProvider)
      runtimeConfigCache = {
        enabled: typeof source.enabled === 'boolean' ? source.enabled : provider !== 'none',
        provider,
        fallbackProvider,
      }
    } catch (error) {
      console.warn('Failed to load captcha runtime config, falling back to env defaults:', error)
      runtimeConfigCache = defaultCaptchaConfig()
    } finally {
      runtimeConfigPromise = null
    }

    return runtimeConfigCache
  })()

  return runtimeConfigPromise
}

export function getCachedCaptchaRuntimeConfig(): PublicCaptchaConfig | null {
  return runtimeConfigCache
}

export function isCaptchaConfigured(): boolean {
  const config = runtimeConfigCache ?? defaultCaptchaConfig()
  return config.enabled && config.provider !== 'none'
}

export function isCaptchaLoaded(): boolean {
  const config = runtimeConfigCache ?? defaultCaptchaConfig()
  switch (config.provider) {
    case 'recaptcha':
      return typeof window !== 'undefined' && typeof window.grecaptcha !== 'undefined'
    case 'turnstile':
      return typeof window !== 'undefined' && typeof window.turnstile !== 'undefined'
    default:
      return true
  }
}

export async function ensureCaptchaReady(): Promise<void> {
  const config = await getCaptchaRuntimeConfig()
  if (!config.enabled || config.provider === 'none' || typeof window === 'undefined') return

  if (config.provider === 'recaptcha') {
    await ensureRecaptchaScriptLoaded()
    return
  }

  if (config.provider === 'turnstile') {
    await ensureTurnstileScriptLoaded()
  }
}

export async function getCaptchaToken(
  action: string,
  providerOverride?: CaptchaProvider,
): Promise<string> {
  const config = await getCaptchaRuntimeConfig()
  const provider =
    providerOverride && providerOverride !== 'none' ? providerOverride : config.provider

  if (!config.enabled || provider === 'none' || typeof window === 'undefined') return ''

  if (provider === 'recaptcha') {
    return executeRecaptcha(action)
  }

  if (provider === 'turnstile') {
    return executeTurnstile(action)
  }

  return ''
}

export function resetCaptchaLoader() {
  runtimeConfigPromise = null
  recaptchaLoadPromise = null
  turnstileLoadPromise = null
  recaptchaScriptCandidateIndex = 0

  if (typeof window !== 'undefined') {
    if ('grecaptcha' in window) delete window.grecaptcha
    if ('turnstile' in window) delete window.turnstile
  }

  if (typeof document !== 'undefined') {
    document.getElementById(RECAPTCHA_SCRIPT_ID)?.remove()
    document.getElementById(TURNSTILE_SCRIPT_ID)?.remove()
    turnstileContainer?.remove()
  }

  turnstileContainer = null
  turnstileWidgetId = null
  turnstileWidgetAction = ''
  turnstileVisibleContainer = null
  turnstileVisibleToken = ''
  turnstileVisibleTokenAction = ''
  turnstileVisibleSuccessHandler = null
}

export function getCaptchaRenderState(): CaptchaRenderState {
  const config = runtimeConfigCache ?? defaultCaptchaConfig()
  return {
    provider: config.provider,
    enabled: config.enabled,
    ready: isCaptchaLoaded(),
    widgetVisible: Boolean(turnstileVisibleContainer),
  }
}

export async function getCaptchaDisplayMeta(): Promise<CaptchaDisplayMeta> {
  const config = await getCaptchaRuntimeConfig()
  const hasTurnstile = config.provider === 'turnstile' || config.fallbackProvider === 'turnstile'
  return {
    provider: hasTurnstile ? 'turnstile' : config.provider,
    mode: hasTurnstile ? 'visible' : 'hidden',
  }
}

export async function mountVisibleTurnstile(
  container: HTMLElement,
  action = 'interactive',
): Promise<void> {
  const config = await getCaptchaRuntimeConfig()
  if (
    !config.enabled ||
    (config.provider !== 'turnstile' && config.fallbackProvider !== 'turnstile')
  )
    return

  await ensureTurnstileScriptLoaded()
  const turnstile = window.turnstile
  if (!turnstile) throw new Error('Turnstile API is unavailable')

  if (turnstileVisibleContainer && turnstileVisibleContainer !== container && turnstileWidgetId) {
    try {
      turnstile.remove(turnstileWidgetId)
    } catch {
      // ignore
    }
    turnstileWidgetId = null
  }

  turnstileVisibleContainer = container
  turnstileWidgetAction = action
  turnstileVisibleToken = ''
  turnstileVisibleTokenAction = ''

  if (!turnstileWidgetId) {
    turnstileWidgetId = turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      action,
      appearance: 'always',
      execution: 'render',
      callback: (token: string) => {
        turnstileVisibleToken = token
        turnstileVisibleTokenAction = action
        turnstileVisibleSuccessHandler?.(token)
      },
      'expired-callback': () => {
        turnstileVisibleToken = ''
        turnstileVisibleTokenAction = ''
      },
      'timeout-callback': () => {
        turnstileVisibleToken = ''
        turnstileVisibleTokenAction = ''
      },
      'error-callback': () => {
        turnstileVisibleToken = ''
        turnstileVisibleTokenAction = ''
      },
    })
  } else {
    turnstile.reset(turnstileWidgetId)
  }
}

export function setVisibleTurnstileSuccessHandler(handler: ((token: string) => void) | null): void {
  turnstileVisibleSuccessHandler = handler
}

export function unmountVisibleTurnstile(): void {
  const turnstile = typeof window !== 'undefined' ? window.turnstile : undefined
  if (turnstile && turnstileWidgetId && turnstileVisibleContainer) {
    try {
      turnstile.remove(turnstileWidgetId)
    } catch {
      // ignore
    }
  }

  turnstileVisibleContainer = null
  turnstileWidgetId = null
  turnstileWidgetAction = ''
  turnstileVisibleToken = ''
  turnstileVisibleTokenAction = ''
  turnstileVisibleSuccessHandler = null
}

async function ensureRecaptchaScriptLoaded(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!RECAPTCHA_SITE_KEY) throw new Error('reCAPTCHA site key is not configured')
  if (typeof window.grecaptcha !== 'undefined') return

  const scriptCandidates = getRecaptchaScriptCandidates()
  const scriptSrc =
    scriptCandidates[recaptchaScriptCandidateIndex] ??
    scriptCandidates[0] ??
    `https://www.recaptcha.net/recaptcha/api.js?render=${encodeURIComponent(RECAPTCHA_SITE_KEY)}&hl=${encodeURIComponent(RECAPTCHA_FALLBACK_LOCALE)}`

  if (!recaptchaLoadPromise) {
    recaptchaLoadPromise = new Promise<void>((resolve, reject) => {
      const existing = document.getElementById(RECAPTCHA_SCRIPT_ID) as HTMLScriptElement | null

      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve()
          return
        }

        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener(
          'error',
          () => {
            recaptchaLoadPromise = null
            reject(new Error('Failed to load reCAPTCHA script'))
          },
          { once: true },
        )
        return
      }

      const script = document.createElement('script')
      script.id = RECAPTCHA_SCRIPT_ID
      script.src = scriptSrc
      script.async = true
      script.defer = true
      script.onload = () => {
        script.dataset.loaded = 'true'
        resolve()
      }
      script.onerror = () => {
        recaptchaLoadPromise = null
        reject(new Error('Failed to load reCAPTCHA script'))
      }

      document.head.appendChild(script)
    })
  }

  try {
    await withTimeout(recaptchaLoadPromise, CAPTCHA_LOAD_TIMEOUT_MS, 'reCAPTCHA load timeout')
    if (typeof window.grecaptcha === 'undefined') {
      throw new Error('reCAPTCHA loaded but grecaptcha is unavailable')
    }
  } catch (error) {
    recaptchaLoadPromise = null
    document.getElementById(RECAPTCHA_SCRIPT_ID)?.remove()
    throw error
  }
}

async function executeRecaptcha(action: string, retryCount = 0): Promise<string> {
  try {
    await ensureRecaptchaScriptLoaded()
  } catch (error) {
    if (retryCount < RECAPTCHA_MAX_RETRIES) {
      console.warn(
        `reCAPTCHA load failed, retrying (${retryCount + 1}/${RECAPTCHA_MAX_RETRIES})...`,
      )
      selectNextRecaptchaScriptCandidate()
      recaptchaLoadPromise = null
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return executeRecaptcha(action, retryCount + 1)
    }

    console.warn('reCAPTCHA load failed after retries, returning empty token', error)
    return ''
  }

  return withTimeout(
    new Promise<string>((resolve, reject) => {
      const grecaptcha = window.grecaptcha
      if (!grecaptcha) {
        resolve('')
        return
      }

      grecaptcha.ready(() => {
        grecaptcha
          .execute(RECAPTCHA_SITE_KEY, { action })
          .then((token) => resolve(token))
          .catch((error) => reject(error))
      })
    }),
    CAPTCHA_EXECUTE_TIMEOUT_MS,
    'reCAPTCHA execution timeout',
  )
}

async function ensureTurnstileScriptLoaded(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!TURNSTILE_SITE_KEY) throw new Error('Turnstile site key is not configured')
  if (typeof window.turnstile !== 'undefined') return

  if (!turnstileLoadPromise) {
    turnstileLoadPromise = new Promise<void>((resolve, reject) => {
      const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null

      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve()
          return
        }

        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener(
          'error',
          () => {
            turnstileLoadPromise = null
            reject(new Error('Failed to load Turnstile script'))
          },
          { once: true },
        )
        return
      }

      const script = document.createElement('script')
      script.id = TURNSTILE_SCRIPT_ID
      script.src = TURNSTILE_SCRIPT_URL
      script.async = true
      script.defer = true
      script.onload = () => {
        script.dataset.loaded = 'true'
        resolve()
      }
      script.onerror = () => {
        turnstileLoadPromise = null
        reject(new Error('Failed to load Turnstile script'))
      }

      document.head.appendChild(script)
    })
  }

  try {
    await withTimeout(turnstileLoadPromise, CAPTCHA_LOAD_TIMEOUT_MS, 'Turnstile load timeout')
    if (typeof window.turnstile === 'undefined') {
      throw new Error('Turnstile loaded but API is unavailable')
    }
  } catch (error) {
    turnstileLoadPromise = null
    document.getElementById(TURNSTILE_SCRIPT_ID)?.remove()
    throw error
  }
}

async function executeTurnstile(action: string): Promise<string> {
  await ensureTurnstileScriptLoaded()

  const turnstile = window.turnstile
  if (!turnstile) return ''

  if (turnstileVisibleToken && turnstileVisibleTokenAction === action) {
    const token = turnstileVisibleToken
    turnstileVisibleToken = ''
    turnstileVisibleTokenAction = ''
    return token
  }

  const container = turnstileVisibleContainer ?? getOrCreateTurnstileContainer()

  return withTimeout(
    new Promise<string>((resolve, reject) => {
      const cleanupAndReject = (error: Error) => {
        if (turnstileWidgetId) {
          try {
            turnstile.reset(turnstileWidgetId)
          } catch {
            // ignore reset failures
          }
        }
        reject(error)
      }

      try {
        const renderOptions: Record<string, unknown> = {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          execution: 'execute',
          appearance: 'execute',
          callback: (token: string) => resolve(token),
          'error-callback': () => cleanupAndReject(new Error('Turnstile execution failed')),
          'expired-callback': () => cleanupAndReject(new Error('Turnstile token expired')),
          'timeout-callback': () => cleanupAndReject(new Error('Turnstile execution timed out')),
        }

        if (turnstileWidgetId && turnstileWidgetAction !== action) {
          turnstile.remove(turnstileWidgetId)
          turnstileWidgetId = null
        }

        if (!turnstileWidgetId) {
          turnstileWidgetId = turnstile.render(container, renderOptions)
          turnstileWidgetAction = action
        } else {
          turnstile.reset(turnstileWidgetId)
          turnstileWidgetAction = action
        }

        turnstile.execute(turnstileWidgetId)
      } catch (error) {
        cleanupAndReject(error instanceof Error ? error : new Error('Turnstile execution failed'))
      }
    }),
    CAPTCHA_EXECUTE_TIMEOUT_MS,
    'Turnstile execution timeout',
  )
}

function getOrCreateTurnstileContainer(): HTMLDivElement {
  if (turnstileContainer) return turnstileContainer

  const container = document.createElement('div')
  container.id = 'turnstile-execute-container'
  container.style.position = 'fixed'
  container.style.left = '-9999px'
  container.style.top = '-9999px'
  container.style.width = '1px'
  container.style.height = '1px'
  container.style.opacity = '0'
  container.setAttribute('aria-hidden', 'true')
  document.body.appendChild(container)
  turnstileContainer = container
  return container
}

function selectNextRecaptchaScriptCandidate() {
  const scriptCandidates = getRecaptchaScriptCandidates()
  if (scriptCandidates.length <= 1) return
  recaptchaScriptCandidateIndex = (recaptchaScriptCandidateIndex + 1) % scriptCandidates.length
}
