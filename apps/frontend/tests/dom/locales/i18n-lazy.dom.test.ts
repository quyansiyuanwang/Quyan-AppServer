// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const setSharedLocaleCookie = (locale: 'en' | 'zh-CN' | 'emoji') => {
  document.cookie = `appserver.preference.locale=${locale}; Path=/`
}

describe('lazy i18n locale loading', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    document.cookie = 'appserver.preference.locale=; Max-Age=0; Path=/'
  })

  it('loads only the saved locale during initialization', async () => {
    setSharedLocaleCookie('en')
    const { initializeI18n, i18n, getLocale } = await import('@/locales')

    await initializeI18n()

    expect(getLocale()).toBe('en')
    expect(i18n.global.availableLocales).toEqual(['en'])
  })

  it('loads another locale only when it is selected', async () => {
    setSharedLocaleCookie('en')
    const { initializeI18n, i18n, setLocale, getLocale } = await import('@/locales')
    await initializeI18n()

    await setLocale('zh-CN')

    expect(getLocale()).toBe('zh-CN')
    expect(i18n.global.availableLocales.sort()).toEqual(['en', 'zh-CN'])
  })
})
