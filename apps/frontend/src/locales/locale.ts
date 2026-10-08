export const SUPPORTED_LOCALES = ['zh-CN', 'en', 'emoji'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export type BackendLocale = Exclude<Locale, 'emoji'>
export const DEFAULT_LOCALE: Locale = 'zh-CN'
export const FALLBACK_LOCALE: Locale = 'en'
