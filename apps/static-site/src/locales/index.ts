import { createI18n } from 'vue-i18n'
import zhCN from './messages/zh-CN'
import en from './messages/en'

const messages = {
  'zh-CN': zhCN,
  en,
}

export type AppLocale = keyof typeof messages

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages,
})

export const setI18nLocale = (locale: AppLocale): void => {
  i18n.global.locale.value = locale
}
