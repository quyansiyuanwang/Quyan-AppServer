import { createI18n } from 'vue-i18n'
import type { DeepPartial, NestedKeys, Assert, Equal, Tail } from '@/types/common'
import { ref, type Ref } from 'vue'
import StorageKey from '@/constant/storagekey'
import { getSharedPreference, setSharedPreference } from '@/utils/sharedPreferences'
import { resolveCurrentSiteProfile } from '@/config/site-registry'
import type { SiteProfileId } from '@/config/site-registry'

const SUPPORTED_LOCALES = ['en', 'zh-CN', 'emoji'] as const
const I18N_INIT_TIMEOUT_MS = 5000

export type Locale = (typeof SUPPORTED_LOCALES)[number]
export type BackendLocale = Exclude<Locale, 'emoji'>

type LocaleMessages = typeof import('./zh-CN').default
type EnMessages = typeof import('./en').default
type EmojiMessages = typeof import('./emoji').default
type LocaleBundle = DeepPartial<EnMessages>
type LocaleBundleLoader = () => Promise<LocaleBundle>
type SiteLocaleLoaders = Record<Locale, LocaleBundleLoader>

const normalizeLocale = (locale: string): Locale => {
  return SUPPORTED_LOCALES.includes(locale as Locale) ? (locale as Locale) : 'zh-CN'
}

// Language is shared by every site in the same deployment family. The
// localStorage value is retained only as a migration fallback for old clients.
const savedLocale = normalizeLocale(
  getSharedPreference('locale', StorageKey.Util.LOCALE) || 'zh-CN',
)
const defaultLocale: Locale = 'zh-CN'
const fallbackLocale: Locale = 'en'

const baseLocaleLoaders: Record<Locale, LocaleBundleLoader> = {
  en: () => import('./base/en').then(({ default: messages }) => messages),
  'zh-CN': () => import('./base/zh-CN').then(({ default: messages }) => messages),
  emoji: () => import('./base/emoji').then(({ default: messages }) => messages),
}

const sharedLocaleLoaders: Record<Locale, LocaleBundleLoader> = {
  en: () => import('./sites/shared/en').then(({ default: messages }) => messages),
  'zh-CN': () => import('./sites/shared/zh-CN').then(({ default: messages }) => messages),
  emoji: () => import('./sites/shared/emoji').then(({ default: messages }) => messages),
}

const siteLocaleLoaders: Record<SiteProfileId, SiteLocaleLoaders> = {
  public: {
    en: () => import('./sites/public/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/public/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/public/emoji').then(({ default: messages }) => messages),
  },
  identity: {
    en: () => import('./sites/identity/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/identity/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/identity/emoji').then(({ default: messages }) => messages),
  },
  account: {
    en: () => import('./sites/account/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/account/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/account/emoji').then(({ default: messages }) => messages),
  },
  chat: {
    en: () => import('./sites/chat/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/chat/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/chat/emoji').then(({ default: messages }) => messages),
  },
  terminal: {
    en: () => import('./sites/terminal/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/terminal/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/terminal/emoji').then(({ default: messages }) => messages),
  },
  'console-ai': {
    en: () => import('./sites/console-ai/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/console-ai/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/console-ai/emoji').then(({ default: messages }) => messages),
  },
  'console-developer': {
    en: () => import('./sites/console-developer/en').then(({ default: messages }) => messages),
    'zh-CN': () =>
      import('./sites/console-developer/zh-CN').then(({ default: messages }) => messages),
    emoji: () =>
      import('./sites/console-developer/emoji').then(({ default: messages }) => messages),
  },
  'console-ram': {
    en: () => import('./sites/console-ram/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/console-ram/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/console-ram/emoji').then(({ default: messages }) => messages),
  },
  'product-oj': {
    en: () => import('./sites/product-oj/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/product-oj/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/product-oj/emoji').then(({ default: messages }) => messages),
  },
  'management-core': {
    en: () => import('./sites/management-core/en').then(({ default: messages }) => messages),
    'zh-CN': () =>
      import('./sites/management-core/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/management-core/emoji').then(({ default: messages }) => messages),
  },
  'management-ai': {
    en: () => import('./sites/management-ai/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/management-ai/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/management-ai/emoji').then(({ default: messages }) => messages),
  },
  'management-developer': {
    en: () => import('./sites/management-developer/en').then(({ default: messages }) => messages),
    'zh-CN': () =>
      import('./sites/management-developer/zh-CN').then(({ default: messages }) => messages),
    emoji: () =>
      import('./sites/management-developer/emoji').then(({ default: messages }) => messages),
  },
  'management-terminal': {
    en: () => import('./sites/management-terminal/en').then(({ default: messages }) => messages),
    'zh-CN': () =>
      import('./sites/management-terminal/zh-CN').then(({ default: messages }) => messages),
    emoji: () =>
      import('./sites/management-terminal/emoji').then(({ default: messages }) => messages),
  },
  'product-kv': {
    en: () => import('./sites/product-kv/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/product-kv/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/product-kv/emoji').then(({ default: messages }) => messages),
  },
  'product-short_link': {
    en: () => import('./sites/product-short_link/en').then(({ default: messages }) => messages),
    'zh-CN': () =>
      import('./sites/product-short_link/zh-CN').then(({ default: messages }) => messages),
    emoji: () =>
      import('./sites/product-short_link/emoji').then(({ default: messages }) => messages),
  },
  'product-secret': {
    en: () => import('./sites/product-secret/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/product-secret/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/product-secret/emoji').then(({ default: messages }) => messages),
  },
  'product-status': {
    en: () => import('./sites/product-status/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/product-status/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/product-status/emoji').then(({ default: messages }) => messages),
  },
  'product-verification': {
    en: () => import('./sites/product-verification/en').then(({ default: messages }) => messages),
    'zh-CN': () =>
      import('./sites/product-verification/zh-CN').then(({ default: messages }) => messages),
    emoji: () =>
      import('./sites/product-verification/emoji').then(({ default: messages }) => messages),
  },
  'product-ip_geolocation': {
    en: () => import('./sites/product-ip_geolocation/en').then(({ default: messages }) => messages),
    'zh-CN': () =>
      import('./sites/product-ip_geolocation/zh-CN').then(({ default: messages }) => messages),
    emoji: () =>
      import('./sites/product-ip_geolocation/emoji').then(({ default: messages }) => messages),
  },
  'product-push': {
    en: () => import('./sites/product-push/en').then(({ default: messages }) => messages),
    'zh-CN': () => import('./sites/product-push/zh-CN').then(({ default: messages }) => messages),
    emoji: () => import('./sites/product-push/emoji').then(({ default: messages }) => messages),
  },
  'product-json_endpoint': {
    en: () => import('./sites/product-json_endpoint/en').then(({ default: messages }) => messages),
    'zh-CN': () =>
      import('./sites/product-json_endpoint/zh-CN').then(({ default: messages }) => messages),
    emoji: () =>
      import('./sites/product-json_endpoint/emoji').then(({ default: messages }) => messages),
  },
}

const resolveSiteId = (siteId?: string): SiteProfileId => {
  const resolved = siteId ?? resolveCurrentSiteProfile().id
  return resolved in siteLocaleLoaders ? (resolved as SiteProfileId) : 'public'
}

const getSiteLocaleLoaders = (siteId: SiteProfileId): SiteLocaleLoaders => siteLocaleLoaders[siteId]

const loadedLocales = new Set<Locale>()
const localeLoadPromises = new Map<Locale, Promise<void>>()
const loadedSiteLocales = new Set<string>()
const siteLocaleLoadPromises = new Map<string, Promise<void>>()

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale,
  messages: {},
  globalInjection: false,
})

const localeRef = i18n.global.locale as unknown as Ref<Locale>

/** Increments whenever a base or site bundle becomes available. */
export const localeMessagesVersion = ref(0)

const withTimeout = async <T>(
  task: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const ensureLocaleBase = (locale: Locale): Promise<void> => {
  if (loadedLocales.has(locale)) return Promise.resolve()
  const pending = localeLoadPromises.get(locale)
  if (pending) return pending
  const loading = baseLocaleLoaders[locale]()
    .then((messages) => {
      i18n.global.setLocaleMessage(locale, messages)
      loadedLocales.add(locale)
      localeMessagesVersion.value++
    })
    .finally(() => localeLoadPromises.delete(locale))
  localeLoadPromises.set(locale, loading)
  return loading
}

export const ensureSiteLocaleMessages = (
  locale: Locale,
  siteId = resolveSiteId(),
): Promise<void> => {
  const key = `${locale}:${siteId}`
  if (loadedSiteLocales.has(key)) return Promise.resolve()
  const pending = siteLocaleLoadPromises.get(key)
  if (pending) return pending

  const loading = (async () => {
    // Base text is deliberately awaited before advanced bundles. Navigation and
    // document titles must never render while their fallback keys are absent.
    await ensureLocaleBase(locale)
    const [shared, site] = await Promise.all([
      sharedLocaleLoaders[locale](),
      getSiteLocaleLoaders(siteId)[locale](),
    ])
    const current = i18n.global.getLocaleMessage(locale) as LocaleBundle
    i18n.global.setLocaleMessage(locale, { ...current, ...shared, ...site })
    loadedSiteLocales.add(key)
    localeMessagesVersion.value++
  })().finally(() => siteLocaleLoadPromises.delete(key))
  siteLocaleLoadPromises.set(key, loading)
  return loading
}

export const initializeI18n = async (
  timeoutMs = I18N_INIT_TIMEOUT_MS,
  siteId = resolveSiteId(),
): Promise<void> => {
  let initialLocale = savedLocale
  try {
    await withTimeout(
      Promise.all([
        ensureSiteLocaleMessages(savedLocale, siteId),
        ensureLocaleBase(fallbackLocale),
      ]).then(() => undefined),
      timeoutMs,
      `[i18n] initialize timeout after ${timeoutMs}ms`,
    )
  } catch (error) {
    console.warn('[i18n] Failed to initialize locale messages, fallback to zh-CN.', error)
    initialLocale = defaultLocale
    try {
      await withTimeout(
        ensureSiteLocaleMessages(defaultLocale, siteId),
        timeoutMs,
        `[i18n] default initialize timeout after ${timeoutMs}ms`,
      )
    } catch (fallbackError) {
      console.error('[i18n] Failed to initialize any locale messages.', fallbackError)
      return
    }
  }
  localeRef.value = initialLocale
}

export default i18n

export const setLocale = async (locale: Locale): Promise<void> => {
  await ensureSiteLocaleMessages(locale)
  localeRef.value = locale
  setSharedPreference('locale', locale, StorageKey.Util.LOCALE)
}

export const getLocale = (): Locale => localeRef.value

export const getBackendLocale = (): BackendLocale | undefined => {
  const locale = getLocale()
  return locale === 'emoji' ? undefined : locale
}

type TFunc = typeof i18n.global.t
export type I18nENAvailableKeys = NestedKeys<EnMessages>

type FixedTFunc<RT> = (
  key: I18nENAvailableKeys,
  params?: Record<string, any>,
  ...args: Tail<Parameters<TFunc>, 2> | undefined extends [any, ...infer R] ? R : []
) => RT

type EnKeys = NestedKeys<EnMessages>
type ZhKeys = NestedKeys<LocaleMessages>
type EmojiKeys = NestedKeys<EmojiMessages>
type _AssertKeys = Assert<Equal<EnKeys, ZhKeys>>
type _AssertEmojiKeys = Assert<Equal<EnKeys, EmojiKeys>>

const readableMissingKey = (key: string) =>
  key
    .split('.')
    .slice(-1)[0]!
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/^./, (value) => value.toUpperCase())

const translate = ((...args: Parameters<TFunc>) => {
  const result = i18n.global.t(...args)
  const key = args[0]
  if (typeof key === 'string' && result === key) {
    if (import.meta.env.DEV) console.warn(`[i18n] Missing translation: ${key}`)
    return readableMissingKey(key)
  }
  return result
}) as TFunc

const i18ns = {
  plugin: i18n,
  t: translate as FixedTFunc<ReturnType<TFunc>>,
  or_t: <R extends NestedKeys<EnMessages>>(is: boolean, r1: R, r2: R) =>
    is ? i18ns.t(r1) : i18ns.t(r2),
  tc: ((...args: Parameters<TFunc>) =>
    () =>
      translate(...args)) as FixedTFunc<() => ReturnType<TFunc>>,
  refer: i18n.global.locale,
  tref: ((...args: Parameters<TFunc>) => ref(translate(...args))) as FixedTFunc<
    Ref<ReturnType<TFunc>>
  >,
  tf: <T extends I18nENAvailableKeys>(key: T, params?: Record<string, any>, countForS?: number) => {
    if (params === undefined) params = new Map()
    if (countForS !== undefined && params) params['s'] = countForS > 1 ? 's' : ''
    return translate(key, params)
  },
  get locale(): Locale {
    return getLocale()
  },
}

export { i18ns, i18n }
