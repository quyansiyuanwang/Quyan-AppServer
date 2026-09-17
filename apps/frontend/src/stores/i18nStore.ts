import { defineStore } from 'pinia'
import { ref } from 'vue'
import { setLocale, getLocale, type Locale } from '@/locales'
import { i18nEventBus } from './globalInstance'

/**
 * 国际化 Store
 * 管理应用的语言设置
 */
export const useI18nStore = defineStore('i18n', () => {
  const currentLocale = ref<Locale>(getLocale())
  let localeChangePromise: Promise<void> | null = null
  let requestedLocale: Locale | null = null

  /**
   * 切换语言
   */
  const changeLocale = (locale: Locale): Promise<void> => {
    requestedLocale = locale
    if (localeChangePromise) return localeChangePromise

    localeChangePromise = (async () => {
      while (requestedLocale) {
        const targetLocale = requestedLocale
        requestedLocale = null
        if (targetLocale === currentLocale.value) continue

        await setLocale(targetLocale)
        currentLocale.value = targetLocale
        i18nEventBus.emit('LOCALE_CHANGED', targetLocale)
      }
    })().finally(() => {
      localeChangePromise = null
    })

    return localeChangePromise
  }

  /**
   * 切换到下一个语言（按列表循环）
   */
  const toggleLocale = async () => {
    const localeOrder: Locale[] = ['zh-CN', 'en', 'emoji']
    const fallbackLocale: Locale = 'zh-CN'
    const index = localeOrder.indexOf(currentLocale.value)
    const nextLocale: Locale =
      index >= 0
        ? (localeOrder[(index + 1) % localeOrder.length] ?? fallbackLocale)
        : fallbackLocale
    await changeLocale(nextLocale)
  }

  return {
    currentLocale,
    changeLocale,
    toggleLocale,
  }
})
