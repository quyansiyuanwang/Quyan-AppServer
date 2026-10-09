import { createI18n } from 'vue-i18n'
import type { Tail } from '@/types/common'
import { computed, ref, type Ref } from 'vue'
import StorageKey from '@/constant/storagekey'
import { getSharedPreference, setSharedPreference } from '@/utils/sharedPreferences'
import { resolveCurrentSiteProfile, type SiteProfileId } from '@/config/site-registry'
import {
  commonLocaleNamespaces,
  routeLocaleNamespaces,
  siteLocaleNamespaces,
  loadLocaleNamespace,
} from '@/router/.gen/i18n/manifest.gen'
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, FALLBACK_LOCALE } from './locale'
import type {
  Locale,
  BackendLocale,
  LocaleBundle,
  LocaleNamespace,
  I18nAvailableKey,
} from './schema'

export type { Locale, BackendLocale } from './schema'
export type I18nENAvailableKeys = I18nAvailableKey

const I18N_INIT_TIMEOUT_MS = 5000
const defaultLocale = DEFAULT_LOCALE
const fallbackLocale = FALLBACK_LOCALE
const normalizeLocale = (locale: string): Locale =>
  SUPPORTED_LOCALES.includes(locale as Locale) ? (locale as Locale) : defaultLocale
const savedLocale = normalizeLocale(
  getSharedPreference('locale', StorageKey.Util.LOCALE) || defaultLocale,
)

const baseLocaleLoaders: Record<Locale, () => Promise<LocaleBundle>> = {
  en: () => import('./base/en').then((module) => module.default),
  'zh-CN': () => import('./base/zh-CN').then((module) => module.default),
  emoji: () => import('./base/emoji').then((module) => module.default),
}

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale,
  messages: {},
  globalInjection: false,
})
const localeRef = i18n.global.locale as unknown as Ref<Locale>
export const localeMessagesVersion = ref(0)
const loadedBundles = new Set<string>()
const pendingBundles = new Map<string, Promise<void>>()
const activeNamespaces = new Set<LocaleNamespace>(commonLocaleNamespaces)
const missingWarnings = new Set<string>()
let localeChangeVersion = 0

/** Cache each language/namespace once across startup, navigation and switching. */
const ensureBundle = (locale: Locale, namespace?: LocaleNamespace): Promise<void> => {
  const key = locale + ':' + (namespace ?? 'base')
  if (loadedBundles.has(key)) return Promise.resolve()
  const pending = pendingBundles.get(key)
  if (pending) return pending
  const loader = namespace
    ? () => loadLocaleNamespace(namespace, locale)
    : baseLocaleLoaders[locale]
  const loading = loader()
    .then((messages) => {
      // Each namespace has one owner; merging cannot replace another page's tree.
      i18n.global.mergeLocaleMessage(locale, messages)
      loadedBundles.add(key)
      localeMessagesVersion.value++
    })
    .finally(() => pendingBundles.delete(key))
  pendingBundles.set(key, loading)
  return loading
}

const ensureNamespaces = async (
  locale: Locale,
  namespaces: Iterable<LocaleNamespace>,
): Promise<void> => {
  const required = new Set(namespaces)
  for (const namespace of required) activeNamespaces.add(namespace)
  // Base and page namespaces are independent requests. Navigation awaits the
  // entire barrier before rendering, without a sequential base/site waterfall.
  await Promise.all([
    ensureBundle(locale),
    ...[...required].map((namespace) => ensureBundle(locale, namespace)),
  ])
}

const namespacesForRoute = routeLocaleNamespaces as Record<string, readonly LocaleNamespace[]>
const namespacesForSite = siteLocaleNamespaces as Record<string, readonly LocaleNamespace[]>

export const ensureRouteLocaleMessages = async (
  locale: Locale,
  siteId: SiteProfileId,
  routeNames: readonly string[],
): Promise<void> => {
  const required: LocaleNamespace[] = [
    ...commonLocaleNamespaces,
    ...(namespacesForSite.shared ?? []),
  ]
  for (const routeName of routeNames) {
    const namespaces = namespacesForRoute[routeName]
    if (!namespaces)
      throw new Error(
        '[i18n] Route has no translation dependency manifest: ' + routeName + ' (' + siteId + ')',
      )
    required.push(...namespaces)
  }
  await ensureNamespaces(locale, required)
}

/** Explicit preloading for every page in a site (normal navigation is per page). */
export const ensureSiteLocaleMessages = (
  locale: Locale,
  siteId: SiteProfileId = resolveSiteId(),
): Promise<void> =>
  ensureNamespaces(locale, [
    ...commonLocaleNamespaces,
    ...(namespacesForSite.shared ?? []),
    ...(namespacesForSite[siteId] ?? []),
  ])

const resolveSiteId = (): SiteProfileId => {
  const profile = resolveCurrentSiteProfile()
  return profile.id === 'rejected' ? 'public' : profile.id
}

const withTimeout = async <T>(task: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('[i18n] initialize timeout after ' + timeoutMs + 'ms')),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export const initializeI18n = async (
  timeoutMs = I18N_INIT_TIMEOUT_MS,
  siteId = resolveSiteId(),
): Promise<void> => {
  let initialLocale = savedLocale
  try {
    await withTimeout(
      Promise.all([
        ensureRouteLocaleMessages(savedLocale, siteId, []),
        ensureBundle(fallbackLocale),
      ]),
      timeoutMs,
    )
  } catch (error) {
    console.warn('[i18n] Failed to initialize locale messages, falling back to zh-CN.', error)
    initialLocale = defaultLocale
    await withTimeout(ensureRouteLocaleMessages(defaultLocale, siteId, []), timeoutMs)
  }
  localeRef.value = initialLocale
}

export const setLocale = async (locale: Locale): Promise<void> => {
  const version = ++localeChangeVersion
  // Include every namespace requested while this language was loading. A route
  // transition and a language change may overlap without leaving missing text.
  while (true) {
    const required = [...activeNamespaces]
    await ensureNamespaces(locale, required)
    if (version !== localeChangeVersion) return
    if (required.length === activeNamespaces.size) break
  }
  localeRef.value = locale
  setSharedPreference('locale', locale, StorageKey.Util.LOCALE)
}
export const getLocale = (): Locale => localeRef.value
export const getBackendLocale = (): BackendLocale | undefined =>
  getLocale() === 'emoji' ? undefined : (getLocale() as BackendLocale)

type TFunc = typeof i18n.global.t
type FixedTFunc<RT> = (
  key: I18nAvailableKey,
  params?: Record<string, any>,
  ...args: Tail<Parameters<TFunc>, 2> | undefined extends [any, ...infer R] ? R : []
) => RT

const translate = ((...args: Parameters<TFunc>) => {
  // tref and computed/template consumers update when lazy text arrives.
  void localeMessagesVersion.value
  const result = i18n.global.t(...args)
  const key = args[0]
  if (typeof key === 'string' && result === key && import.meta.env.DEV) {
    const warning = getLocale() + ':' + key
    if (!missingWarnings.has(warning)) {
      missingWarnings.add(warning)
      console.warn('[i18n] Missing translation: ' + warning)
    }
  }
  return result
}) as TFunc

const i18ns = {
  plugin: i18n,
  t: translate as FixedTFunc<ReturnType<TFunc>>,
  or_t: <R extends I18nAvailableKey>(is: boolean, r1: R, r2: R) => (is ? i18ns.t(r1) : i18ns.t(r2)),
  tc: ((...args: Parameters<TFunc>) =>
    () =>
      translate(...args)) as FixedTFunc<() => ReturnType<TFunc>>,
  refer: i18n.global.locale,
  tref: ((...args: Parameters<TFunc>) =>
    computed(() => translate(...args))) as unknown as FixedTFunc<Readonly<Ref<ReturnType<TFunc>>>>,
  tf: <T extends I18nAvailableKey>(key: T, params?: Record<string, any>, countForS?: number) => {
    const values = { ...params }
    if (countForS !== undefined) values.s = countForS > 1 ? 's' : ''
    return translate(key, values)
  },
  get locale(): Locale {
    return getLocale()
  },
}

export default i18n
export { i18ns, i18n }
