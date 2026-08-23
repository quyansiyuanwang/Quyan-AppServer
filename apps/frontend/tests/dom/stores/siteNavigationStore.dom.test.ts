// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { siteProfileIds, type SiteProfileId } from '@/config/site-registry'
import { useSiteNavigationStore } from '@/stores/siteNavigationStore'

describe('siteNavigationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    document.cookie = 'appserver.preference.siteOpenInNewTab=; Max-Age=0; Path=/'
    document.cookie = 'appserver.preference.recentSites=; Max-Age=0; Path=/'
  })

  it('defaults to opening sites in a new tab and persists changes', () => {
    const store = useSiteNavigationStore()

    expect(store.openInNewTab).toBe(true)
    store.setOpenInNewTab(false)

    expect(store.openInNewTab).toBe(false)
    expect(document.cookie).toContain('appserver.preference.siteOpenInNewTab=false')
  })

  it('deduplicates recent sites, keeps five entries, and ignores invalid ids', () => {
    const store = useSiteNavigationStore()
    const validIds = siteProfileIds.filter((siteId) => siteId !== 'identity').slice(0, 6)

    validIds.forEach((siteId) => store.recordRecentSite(siteId))
    store.recordRecentSite('not-a-site' as SiteProfileId)
    store.recordRecentSite(validIds[1])

    expect(store.recentSiteIds).toHaveLength(Math.min(5, validIds.length))
    expect(store.recentSiteIds[0]).toBe(validIds[1])
    expect(new Set(store.recentSiteIds).size).toBe(store.recentSiteIds.length)
    expect(store.recentSiteIds).not.toContain('not-a-site')
  })
})
