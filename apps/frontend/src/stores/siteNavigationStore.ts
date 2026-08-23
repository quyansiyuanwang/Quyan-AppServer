import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import StorageKey from '@/constant/storagekey'
import { siteProfileIds, type SiteProfileId } from '@/config/site-registry'
import { getSharedPreference, setSharedPreference } from '@/utils/sharedPreferences'

const MAX_RECENT_SITES = 5
const siteProfileIdSet = new Set<string>(siteProfileIds)

const normalizeRecentSiteIds = (value: unknown): SiteProfileId[] => {
  if (!Array.isArray(value)) return []

  return value
    .filter(
      (siteId, index, source): siteId is SiteProfileId =>
        typeof siteId === 'string' &&
        siteProfileIdSet.has(siteId) &&
        source.indexOf(siteId) === index,
    )
    .slice(0, MAX_RECENT_SITES)
}

const readRecentSiteIds = (): SiteProfileId[] => {
  const raw = getSharedPreference('recentSites', StorageKey.Navigation.RECENT_SITES)
  if (!raw) return []

  try {
    return normalizeRecentSiteIds(JSON.parse(raw))
  } catch {
    return []
  }
}

export const useSiteNavigationStore = defineStore('siteNavigation', () => {
  const openInNewTab = ref(
    getSharedPreference('siteOpenInNewTab', StorageKey.Navigation.SITE_OPEN_IN_NEW_TAB) !== 'false',
  )
  const recentSiteIds = ref<SiteProfileId[]>(readRecentSiteIds())

  const setOpenInNewTab = (value: boolean) => {
    openInNewTab.value = value
    setSharedPreference(
      'siteOpenInNewTab',
      value ? 'true' : 'false',
      StorageKey.Navigation.SITE_OPEN_IN_NEW_TAB,
    )
  }

  const recordRecentSite = (siteId: SiteProfileId) => {
    if (!siteProfileIdSet.has(siteId)) return

    recentSiteIds.value = [siteId, ...recentSiteIds.value.filter((id) => id !== siteId)].slice(
      0,
      MAX_RECENT_SITES,
    )
    setSharedPreference(
      'recentSites',
      JSON.stringify(recentSiteIds.value),
      StorageKey.Navigation.RECENT_SITES,
    )
  }

  const getRecentSiteIds = (accessibleSiteIds: readonly SiteProfileId[]) => {
    const accessible = new Set(accessibleSiteIds)
    return computed(() =>
      recentSiteIds.value.filter((siteId) => accessible.has(siteId)).slice(0, MAX_RECENT_SITES),
    )
  }

  return { openInNewTab, recentSiteIds, setOpenInNewTab, recordRecentSite, getRecentSiteIds }
})

export { MAX_RECENT_SITES, normalizeRecentSiteIds }
