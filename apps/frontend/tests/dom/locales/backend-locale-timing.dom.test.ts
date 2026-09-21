// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `X-Locale` 取自 `getBackendLocale()`。前端 bootstrap（`app-runtime.ts`）在
 * `initializeI18n()` **未完成** 时就发起受保护会话恢复与权限水合请求，因此
 * 「消息 chunk 是否载入」不得影响「请求语言」——否则 en 用户冷启动期间发出的
 * 请求会按 zh-CN 渲染后端消息。
 */
const setSharedLocaleCookie = (locale: 'en' | 'zh-CN' | 'emoji') => {
  document.cookie = `appserver.preference.locale=${locale}; Path=/`
}

describe('backend locale is独立于 i18n 消息载入', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    document.cookie = 'appserver.preference.locale=; Max-Age=0; Path=/'
  })

  it('在消息 chunk 载入前就返回已保存的语言偏好', async () => {
    setSharedLocaleCookie('en')
    const { getBackendLocale } = await import('@/locales')

    expect(getBackendLocale()).toBe('en')
  })

  it('消息 chunk 载入后语言保持一致', async () => {
    setSharedLocaleCookie('en')
    const { getBackendLocale, initializeI18n, getLocale } = await import('@/locales')

    await initializeI18n()

    expect(getLocale()).toBe('en')
    expect(getBackendLocale()).toBe('en')
  })

  it('未保存偏好时回退 zh-CN', async () => {
    const { getBackendLocale } = await import('@/locales')

    expect(getBackendLocale()).toBe('zh-CN')
  })

  it('emoji 模式不发送语言头（计划 §3.1 记录的回退）', async () => {
    setSharedLocaleCookie('emoji')
    const { getBackendLocale } = await import('@/locales')

    expect(getBackendLocale()).toBeUndefined()
  })
})
