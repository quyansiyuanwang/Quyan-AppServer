import { createI18n } from 'vue-i18n'
import type { NestedKeys, Assert, Equal, Tail } from '@/types/common'
import { ref, type Ref } from 'vue'
import StorageKey from '@/constant/storagekey'
import { getSharedPreference, setSharedPreference } from '@/utils/sharedPreferences'

const SUPPORTED_LOCALES = ['en', 'zh-CN', 'emoji'] as const
const I18N_INIT_TIMEOUT_MS = 5000

export type Locale = (typeof SUPPORTED_LOCALES)[number]
export type BackendLocale = Exclude<Locale, 'emoji'>

type LocaleMessages = typeof import('./zh-CN').default
type EnMessages = typeof import('./en').default
type EmojiMessages = typeof import('./emoji').default

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

const localeLoaders: Record<Locale, () => Promise<LocaleMessages>> = {
  en: () => import('./en').then(({ default: messages }) => messages as LocaleMessages),
  'zh-CN': () => import('./zh-CN').then(({ default: messages }) => messages as LocaleMessages),
  emoji: () => import('./emoji').then(({ default: messages }) => messages as LocaleMessages),
}

const loadedLocales = new Set<Locale>()
const localeLoadPromises = new Map<Locale, Promise<void>>()

const i18n = createI18n({
  legacy: false, // 使用 Composition API 模式
  // 启动时就使用已保存的偏好，而不是 defaultLocale：请求语言（`X-Locale`）取自
  // `getBackendLocale()`，而 `app-runtime` 在 `initializeI18n()` 完成前就会发起
  // 会话恢复与权限水合请求，此时消息 chunk 尚未载入。以 defaultLocale 起步会让
  // en 用户冷启动期间的请求被后端按 zh-CN 渲染。
  locale: savedLocale,
  fallbackLocale,
  messages: {},
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

const ensureLocaleMessages = (locale: Locale): Promise<void> => {
  if (loadedLocales.has(locale)) return Promise.resolve()

  const pending = localeLoadPromises.get(locale)
  if (pending) return pending

  const loadPromise = localeLoaders[locale]()
    .then((messages) => {
      i18n.global.setLocaleMessage(locale, messages)
      loadedLocales.add(locale)
    })
    .finally(() => {
      localeLoadPromises.delete(locale)
    })

  localeLoadPromises.set(locale, loadPromise)
  return loadPromise
}

export const initializeI18n = async (timeoutMs = I18N_INIT_TIMEOUT_MS): Promise<void> => {
  let initialLocale = savedLocale
  try {
    await withTimeout(
      ensureLocaleMessages(savedLocale),
      timeoutMs,
      `[i18n] initialize timeout after ${timeoutMs}ms`,
    )
  } catch (error) {
    console.warn('[i18n] Failed to initialize locale messages, fallback to zh-CN.', error)
    initialLocale = defaultLocale
    try {
      await withTimeout(
        ensureLocaleMessages(defaultLocale),
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
