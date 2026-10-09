import type en from './en'
import type zhCN from './zh-CN'
import type emoji from './emoji'
import type base from './base/en'
import type { Assert, Equal, NestedKeys, DeepPartial, DeepStringify } from '@/types/common'

import type { Locale } from './locale'
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, FALLBACK_LOCALE } from './locale'
export type { Locale, BackendLocale } from './locale'
export type LocaleMessages = typeof en
export type LocaleBundle = DeepPartial<DeepStringify<LocaleMessages>>
export type I18nAvailableKey = NestedKeys<LocaleMessages>
export type LocaleNamespace = Exclude<keyof LocaleMessages, keyof typeof base>
export type LocaleNamespaceLoaders = {
  [Namespace in LocaleNamespace]: {
    [Language in Locale]: () => Promise<{ [Key in Namespace]: DeepStringify<LocaleMessages[Key]> }>
  }
}

// 's' is the optional English suffix supplied by tf; other parameters carry
// business data and must survive translation in every language.
type ParametersIn<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? (Name extends `'${string}` | `"${string}` ? never : Exclude<Name, 's'>) | ParametersIn<Rest>
  : never

export type TranslationIssues<Reference, Translation, Prefix extends string = ''> = {
  [Key in keyof Reference]: Key extends keyof Translation
    ? Reference[Key] extends string
      ? Translation[Key] extends string
        ? Equal<ParametersIn<Reference[Key]>, ParametersIn<Translation[Key]>> extends true
          ? never
          : `${Prefix}${Key & string}: interpolation mismatch`
        : `${Prefix}${Key & string}: expected text`
      : TranslationIssues<Reference[Key], Translation[Key], `${Prefix}${Key & string}.`>
    : `${Prefix}${Key & string}: missing translation`
}[keyof Reference]

// Exporting these assertions keeps structural/interpolation coverage in vue-tsc.
// Source auditing additionally catches empty text, duplicate owners and unused
// invalid keys, including references inside Vue templates and metadata.
export type LocaleCoverage = [
  Assert<Equal<I18nAvailableKey, NestedKeys<typeof zhCN>>>,
  Assert<Equal<I18nAvailableKey, NestedKeys<typeof emoji>>>,
  Assert<Equal<TranslationIssues<LocaleMessages, typeof zhCN>, never>>,
  Assert<Equal<TranslationIssues<LocaleMessages, typeof emoji>, never>>,
]
