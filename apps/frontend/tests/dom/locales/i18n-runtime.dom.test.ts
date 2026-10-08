// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const manifestPath = '@/router/.gen/i18n/manifest.gen'
type Manifest = typeof import('@/router/.gen/i18n/manifest.gen')

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  document.cookie = 'appserver.preference.locale=zh-CN; Path=/'
})
afterEach(() => vi.doUnmock(manifestPath))

const installLoader = async (
  wrap: (original: Manifest['loadLocaleNamespace']) => Manifest['loadLocaleNamespace'],
) => {
  const actual = (await import(manifestPath)) as Manifest
  const loader = vi.fn(wrap(actual.loadLocaleNamespace))
  vi.doMock(manifestPath, () => ({ ...actual, loadLocaleNamespace: loader }))
  return loader
}

describe('i18n loader recovery and concurrency', () => {
  it('deduplicates concurrent requests across route and site preloading', async () => {
    const loader = await installLoader((original) => original)
    const { ensureRouteLocaleMessages, ensureSiteLocaleMessages } = await import('@/locales')
    await Promise.all([
      ensureRouteLocaleMessages('zh-CN', 'management-ai', ['relaySettings']),
      ensureRouteLocaleMessages('zh-CN', 'management-ai', ['relaySettings']),
      ensureSiteLocaleMessages('zh-CN', 'management-ai'),
    ])
    const calls = loader.mock.calls.map(([namespace, locale]) => locale + ':' + namespace)
    expect(new Set(calls).size).toBe(calls.length)
    expect(calls).toContain('zh-CN:ServerConfigView')
  })

  it('retries a failed page chunk without reloading successful namespaces', async () => {
    let failed = false
    const loader = await installLoader((original) => async (namespace, locale) => {
      if (namespace === 'ServerConfigView' && !failed) {
        failed = true
        throw new Error('chunk unavailable')
      }
      return original(namespace, locale)
    })
    const { ensureRouteLocaleMessages, i18ns } = await import('@/locales')
    await expect(
      ensureRouteLocaleMessages('zh-CN', 'management-ai', ['relaySettings']),
    ).rejects.toThrow('chunk unavailable')
    await ensureRouteLocaleMessages('zh-CN', 'management-ai', ['relaySettings'])
    expect(
      loader.mock.calls.filter(([namespace]) => namespace === 'ServerConfigView'),
    ).toHaveLength(2)
    expect(loader.mock.calls.filter(([namespace]) => namespace === 'waterMark')).toHaveLength(1)
    expect(i18ns.t('ServerConfigView.requestQueueTitle')).toBe('请求队列')
  })

  it('keeps the latest direct locale request when earlier requests finish late', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await installLoader((original) => async (namespace, locale) => {
      if (locale === 'en' && namespace === 'relay') await pending
      return original(namespace, locale)
    })
    const { initializeI18n, setLocale, getLocale } = await import('@/locales')
    await initializeI18n()
    const earlier = setLocale('en')
    await setLocale('emoji')
    release!()
    await earlier
    expect(getLocale()).toBe('emoji')
    expect(document.cookie).toContain('appserver.preference.locale=emoji')
  })

  it('rejects startup if neither language can load instead of mounting missing translations', async () => {
    await installLoader(() => async () => {
      throw new Error('all chunks unavailable')
    })
    const { initializeI18n } = await import('@/locales')
    await expect(initializeI18n()).rejects.toThrow('all chunks unavailable')
  })
})
