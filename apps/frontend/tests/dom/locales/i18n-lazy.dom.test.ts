// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import en from '@/locales/en'
import { routeLocaleNamespaces, commonLocaleNamespaces } from '@/router/.gen/i18n/manifest.gen'

type MessageTree = { [key: string]: string | MessageTree }
const flattenKeys = (tree: MessageTree | string, prefix: string): string[] =>
  typeof tree === 'string'
    ? [prefix]
    : Object.entries(tree).flatMap(([key, value]) => flattenKeys(value, prefix + '.' + key))
const setSharedLocaleCookie = (locale: 'en' | 'zh-CN' | 'emoji') => {
  document.cookie = 'appserver.preference.locale=' + locale + '; Path=/'
}

describe('lazy i18n locale loading', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    document.cookie = 'appserver.preference.locale=; Max-Age=0; Path=/'
  })

  it('initializes shared UI without preloading unrelated page namespaces', async () => {
    setSharedLocaleCookie('zh-CN')
    const { initializeI18n, i18n, getLocale } = await import('@/locales')
    await initializeI18n(5000, 'management-core')
    expect(getLocale()).toBe('zh-CN')
    expect(i18n.global.availableLocales.sort()).toEqual(['en', 'zh-CN'])
    expect(i18n.global.te('nav.siteManagementAi', 'zh-CN')).toBe(true)
    expect(i18n.global.te('PermissionManagement.title', 'zh-CN')).toBe(false)
    expect(i18n.global.te('nav.siteManagementAi', 'en')).toBe(true)
  })

  it('loads cross-site translations required by the AI management settings page', async () => {
    setSharedLocaleCookie('zh-CN')
    const { initializeI18n, i18ns, ensureRouteLocaleMessages } = await import('@/locales')
    await initializeI18n(5000, 'management-ai')
    await ensureRouteLocaleMessages('zh-CN', 'management-ai', ['relaySettings'])
    expect(i18ns.t('ServerConfigView.requestQueueTitle')).toBe('请求队列')
    expect(i18ns.t('ServerConfigView.relayCustomKeyTitle')).toBe('Relay 自定义 Key 限制')
    expect(i18ns.t('ServerConfigView.allowedModelsAndPricing')).toBe('允许的模型及定价')
    expect(i18ns.t('relay.tokenManagement')).toBe('中转令牌管理')
  })

  it('loads the selected language for every previously visited page and updates refs', async () => {
    setSharedLocaleCookie('en')
    const { initializeI18n, i18n, i18ns, setLocale, ensureRouteLocaleMessages } = await import(
      '@/locales'
    )
    await initializeI18n(5000, 'management-ai')
    await ensureRouteLocaleMessages('en', 'management-ai', ['relaySettings'])
    const title = i18ns.tref('ServerConfigView.requestQueueTitle')
    expect(title.value).toBe(en.ServerConfigView.requestQueueTitle)
    await setLocale('zh-CN')
    expect(title.value).toBe('请求队列')
    expect(i18n.global.availableLocales.sort()).toEqual(['en', 'zh-CN'])
    await setLocale('emoji')
    expect(title.value).not.toBe(en.ServerConfigView.requestQueueTitle)
    expect(i18n.global.te('ServerConfigView.requestQueueTitle', 'emoji')).toBe(true)
  })

  it('covers each page dependency in all three languages', async () => {
    const { ensureRouteLocaleMessages, i18n } = await import('@/locales')
    const checked = new Set<string>()
    for (const locale of ['en', 'zh-CN', 'emoji'] as const) {
      for (const [routeName, namespaces] of Object.entries(routeLocaleNamespaces)) {
        await ensureRouteLocaleMessages(locale, 'management-ai', [routeName])
        for (const namespace of new Set([...commonLocaleNamespaces, ...namespaces])) {
          const id = locale + ':' + namespace
          if (checked.has(id)) continue
          const keys = flattenKeys(en[namespace], namespace)
          expect(
            keys.filter((key) => !i18n.global.te(key, locale)),
            id,
          ).toEqual([])
          checked.add(id)
        }
      }
    }
    expect(checked.size).toBeGreaterThan(150)
  }, 20_000)

  it('updates cached table row labels in a mounted component when the language changes', async () => {
    const { initializeI18n, ensureRouteLocaleMessages, setLocale } = await import('@/locales')
    await initializeI18n(5000, 'management-ai')
    await ensureRouteLocaleMessages('zh-CN', 'management-ai', ['relayContentSafetySystem'])
    const Component = (await import('@/components/content-safety/ContentSafetyPolicyFields.vue'))
      .default
    const Table = defineComponent({
      props: ['data'],
      setup(props) {
        return () =>
          h(
            'div',
            props.data.map((row: { direction: string }) => h('span', row.direction)),
          )
      },
    })
    const wrapper = mount(Component, {
      props: {
        model: {
          requestEnabled: true,
          requestAction: 'unreachable',
          requestMaxAction: 'unreachable',
          requestAiEnabled: false,
          requestAiAction: 'unreachable',
          responseEnabled: true,
          responseAction: 'unreachable',
          responseMaxAction: 'unreachable',
          responseAiEnabled: false,
          responseAiAction: 'unreachable',
        },
      },
      global: { stubs: { 'el-table': Table } },
    })
    expect(wrapper.text()).toContain('请求')
    await setLocale('en')
    await nextTick()
    expect(wrapper.text()).toContain(en.contentSafety.request)
    expect(wrapper.text()).not.toContain('请求')
    wrapper.unmount()
  })

  it('exposes an unknown route manifest as a load error', async () => {
    const { ensureRouteLocaleMessages } = await import('@/locales')
    await expect(
      ensureRouteLocaleMessages('en', 'management-ai', ['missing-fixture-route']),
    ).rejects.toThrow('no translation dependency manifest')
  })
})
