import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import type { NestedKeys, Assert, Equal, Tail } from '@/types/common'
import { ref, type Ref } from 'vue'
import StorageKey from '@/constant/storagekey'
import { getSharedPreference, setSharedPreference } from '@/utils/sharedPreferences'

const SUPPORTED_LOCALES = ['en', 'zh-CN', 'emoji'] as const
const I18N_INIT_TIMEOUT_MS = 5000

export type Locale = (typeof SUPPORTED_LOCALES)[number]
export type BackendLocale = Exclude<Locale, 'emoji'>

type LocaleMessages = typeof zhCN
type EnMessages = typeof import('./en').default
type EmojiMessages = typeof import('./emoji').default

const normalizeLocale = (locale: string): Locale => {
  return SUPPORTED_LOCALES.includes(locale as Locale) ? (locale as Locale) : 'zh-CN'
}

// Language is shared by every site in the same deployment family. The
// localStorage value is retained only as a migration fallback for old clients.
const savedLocale = normalizeLocale(getSharedPreference('locale', StorageKey.Util.LOCALE) || 'zh-CN')
const defaultLocale: Locale = 'zh-CN'
const fallbackLocale: Locale = 'en'

const localeLoaders: Record<Locale, () => Promise<LocaleMessages>> = {
  en: () => import('./en').then(({ default: messages }) => messages as LocaleMessages),
  'zh-CN': () => Promise.resolve(zhCN),
  emoji: () => import('./emoji').then(({ default: messages }) => messages as LocaleMessages),
}

const loadedLocales = new Set<Locale>(['zh-CN'])

const i18n = createI18n({
  legacy: false, // 使用 Composition API 模式
  locale: defaultLocale,
  fallbackLocale,
  messages: {
    [defaultLocale]: zhCN,
  },
  globalInjection: false,
})

const localeRef = i18n.global.locale as unknown as Ref<Locale>

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
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

const ensureLocaleMessages = async (locale: Locale): Promise<void> => {
  if (loadedLocales.has(locale)) return

  const messages = await localeLoaders[locale]()
  i18n.global.setLocaleMessage(locale, messages)
  loadedLocales.add(locale)
}

export const initializeI18n = async (timeoutMs = I18N_INIT_TIMEOUT_MS): Promise<void> => {
  try {
    await withTimeout(
      ensureLocaleMessages(savedLocale),
      timeoutMs,
      `[i18n] initialize timeout after ${timeoutMs}ms`,
    )
    localeRef.value = savedLocale
  } catch (error) {
    console.warn('[i18n] Failed to initialize locale messages, fallback to zh-CN.', error)
    localeRef.value = defaultLocale
  }

  // Warm fallback language in the background to keep key-fallback experience stable.
  if (localeRef.value !== fallbackLocale) {
    void ensureLocaleMessages(fallbackLocale).catch((warmupError) => {
      console.warn('[i18n] Failed to warm fallback locale.', warmupError)
    })
  }
}

export default i18n

export const setLocale = async (locale: Locale): Promise<void> => {
  await ensureLocaleMessages(locale)
  localeRef.value = locale
  setSharedPreference('locale', locale, StorageKey.Util.LOCALE)
}

export const getLocale = (): Locale => {
  return localeRef.value
}

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

// self-alias
const i18ns = {
  plugin: i18n,
  t: ((...args: Parameters<TFunc>) => i18n.global.t(...args)) as FixedTFunc<ReturnType<TFunc>>,
  or_t: <R extends NestedKeys<EnMessages>>(is: boolean, r1: R, r2: R) =>
    is ? i18ns.t(r1) : i18ns.t(r2),
  tc: ((...args: Parameters<TFunc>) =>
    () =>
      i18n.global.t(...args)) as FixedTFunc<() => ReturnType<TFunc>>,

  refer: i18n.global.locale,

  tref: ((...args: Parameters<TFunc>) => ref(i18n.global.t(...args))) as FixedTFunc<
    Ref<ReturnType<TFunc>>
  >,

  tf: <T extends I18nENAvailableKeys>(key: T, params?: Record<string, any>, countForS?: number) => {
    if (params === undefined) params = new Map()
    if (countForS !== undefined && params) {
      params['s'] = countForS > 1 ? 's' : ''
    }

    return i18n.global.t(key, params)
  },

  get locale(): Locale {
    return getLocale()
  },
}

export { i18ns, i18n }
