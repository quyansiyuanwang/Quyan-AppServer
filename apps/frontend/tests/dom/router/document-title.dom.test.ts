// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { resolveSiteProfile } from '@/config/site-registry'
import { resolveDocumentTitle } from '@/router/document-title'
import { initializeI18n } from '@/locales'

const getKnownProfile = (hostname: string) => {
  const profile = resolveSiteProfile(hostname)
  if (profile.id === 'rejected') throw new Error(`Expected ${hostname} to be registered`)
  return profile
}

const route = (name: string, titleKey?: string) =>
  ({
    name,
    meta: titleKey ? { titleKey } : {},
  }) as Pick<RouteLocationNormalizedLoaded, 'name' | 'meta'>

describe('document title', () => {
  beforeAll(async () => {
    await initializeI18n()
  })

  it('uses the Quyan brand, translated page name, and current site', () => {
    expect(resolveDocumentTitle(route('home'), getKnownProfile('www.qysyw.cn'))).toBe(
      'Quyan · 首页 · 官网',
    )
    expect(resolveDocumentTitle(route('login'), getKnownProfile('auth.qysyw.cn'))).toBe(
      'Quyan · 登录 · 认证中心',
    )
  })

  it('supports route-specific title keys and a site-only fallback', () => {
    expect(
      resolveDocumentTitle(
        route('unknownRoute', 'notFound.title'),
        getKnownProfile('auth.qysyw.cn'),
      ),
    ).toBe('Quyan · 页面未找到 · 认证中心')
    expect(resolveDocumentTitle(route('unknownRoute'), getKnownProfile('www.qysyw.cn'))).toBe(
      'Quyan · 官网',
    )
  })
})
