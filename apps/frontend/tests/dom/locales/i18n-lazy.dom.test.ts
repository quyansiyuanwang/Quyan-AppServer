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

  it('loads the saved locale site bundle and the fallback base bundle', async () => {
    setSharedLocaleCookie('zh-CN')
    const { initializeI18n, i18n, getLocale } = await import('@/locales')

    await initializeI18n(5000, 'management-core')

    expect(getLocale()).toBe('zh-CN')
    expect(i18n.global.availableLocales.sort()).toEqual(['en', 'zh-CN'])
    expect(i18n.global.te('nav.siteManagementAi', 'zh-CN')).toBe(true)
    expect(i18n.global.te('PermissionManagement.title', 'zh-CN')).toBe(true)
    expect(i18n.global.t('relay.tokenManagement', {}, { locale: 'zh-CN' })).toBe('中转令牌管理')
    expect(i18n.global.te('nav.siteManagementAi', 'en')).toBe(true)
  })

  it('loads another locale only when it is selected', async () => {
    setSharedLocaleCookie('en')
    const { initializeI18n, i18n, setLocale, getLocale } = await import('@/locales')
    await initializeI18n()

    await setLocale('zh-CN')

    expect(getLocale()).toBe('zh-CN')
    expect(i18n.global.availableLocales.sort()).toEqual(['en', 'zh-CN'])
  })

  it('loads shared relay messages for the AI management site', async () => {
    setSharedLocaleCookie('zh-CN')
    const { initializeI18n, i18n } = await import('@/locales')

    await initializeI18n(5000, 'management-ai')

    expect(i18n.global.t('relay.tokenManagement', {}, { locale: 'zh-CN' })).toBe('中转令牌管理')
    expect(i18n.global.t('relay.createToken', {}, { locale: 'zh-CN' })).toBe('创建令牌')
  })
})
