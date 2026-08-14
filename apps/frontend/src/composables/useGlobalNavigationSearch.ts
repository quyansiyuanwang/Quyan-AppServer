import { computed, ref, watch } from 'vue'
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import { currentSiteProfile } from '@/router'
import { getRouteCatalogEntry } from '@/router/route-catalog'
import { getAccessibleSiteProfiles, type SiteProfile } from '@/config/site-registry'
import {
  collectVisibleNavigationRoutes,
  debugNavigationNode,
  navigationMenuDefinition,
} from '@/config/navigation-catalog'
import { usePermissionStore } from '@/stores/permissionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { hasFeatureRoute } from '@/plugins/modules'
import type { RouteName } from '@/types/route-types.gen'
import type { Component } from 'vue'
import { Document, Grid } from '@element-plus/icons-vue'

export type GlobalNavigationSearchResult = {
  id: string
  kind: 'site' | 'page' | 'command'
  label: string
  siteLabel?: string
  pathLabel?: string
  keywords: string
  icon: Component
  profile?: SiteProfile
  route?: RouteName
}

const normalizeSearchText = (value: string): string => value.trim().toLocaleLowerCase()

const localized = (key: string): string => i18ns.t(key as I18nENAvailableKeys)

export const useGlobalNavigationSearch = () => {
  const permissionStore = usePermissionStore()
  const sessionStore = useSessionStore()
  const query = ref('')
  const selectedIndex = ref(0)

  const accessibleProfiles = computed(() => {
    // Touch the locale ref so translated titles update immediately after language changes.
    void i18ns.refer.value
    if (currentSiteProfile.id === 'rejected') return []
    if (!sessionStore.isAuthenticated) {
      return currentSiteProfile.id === 'public' ? [currentSiteProfile] : []
    }
    return getAccessibleSiteProfiles(currentSiteProfile, permissionStore.effectivePermissions)
  })

  const allResults = computed<GlobalNavigationSearchResult[]>(() => {
    const results: GlobalNavigationSearchResult[] = []
    const effectivePermissions = permissionStore.effectivePermissions

    for (const profile of accessibleProfiles.value) {
      const siteLabel = localized(profile.labelKey)
      results.push({
        id: `site:${profile.id}`,
        kind: 'site',
        label: siteLabel,
        keywords: `${siteLabel} ${profile.hostname} ${profile.id}`,
        icon: Grid,
        profile,
      })

      const routeEntries = collectVisibleNavigationRoutes(
        [...navigationMenuDefinition, debugNavigationNode],
        effectivePermissions,
        (route) => {
          const entry = getRouteCatalogEntry(route)
          return Boolean(
            entry && hasFeatureRoute(profile, route) && !entry.path.includes(':'),
          )
        },
      )

      for (const { node, parentLabelKeys } of routeEntries) {
        if (!node.route) continue
        const routeEntry = getRouteCatalogEntry(node.route)
        if (!routeEntry) continue
        const label = localized(node.labelKey)
        const pathLabel = parentLabelKeys.map(localized).join(' / ')
        results.push({
          id: `page:${profile.id}:${node.route}`,
          kind: 'page',
          label,
          siteLabel,
          pathLabel,
          keywords: [
            label,
            siteLabel,
            pathLabel,
            node.route,
            routeEntry.path,
            routeEntry.legacyPath,
            ...(routeEntry.legacyPaths ?? []),
          ]
            .filter(Boolean)
            .join(' '),
          icon: node.icon,
          profile,
          route: node.route,
        })
      }
    }

    results.push({
      id: 'command:docs',
      kind: 'command',
      label: localized('nav.docs'),
      pathLabel: localized('nav.quickAccess'),
      keywords: `${localized('nav.docs')} documentation help`,
      icon: Document,
    })
    return results
  })

  const results = computed(() => {
    const keyword = normalizeSearchText(query.value)
    const currentProfileId = currentSiteProfile.id
    const matched = keyword
      ? allResults.value.filter((result) => normalizeSearchText(result.keywords).includes(keyword))
      : allResults.value

    return [...matched].sort((left, right) => {
      const leftCurrent = left.profile?.id === currentProfileId ? 0 : 1
      const rightCurrent = right.profile?.id === currentProfileId ? 0 : 1
      if (leftCurrent !== rightCurrent) return leftCurrent - rightCurrent
      if (left.kind !== right.kind) return left.kind === 'site' ? -1 : 1
      return left.label.localeCompare(right.label)
    })
  })

  watch(results, (nextResults) => {
    if (!nextResults.length) {
      selectedIndex.value = 0
      return
    }
    selectedIndex.value = Math.min(selectedIndex.value, nextResults.length - 1)
  })

  const moveSelection = (offset: number) => {
    if (!results.value.length) return
    selectedIndex.value =
      (selectedIndex.value + offset + results.value.length) % results.value.length
  }

  const reset = () => {
    query.value = ''
    selectedIndex.value = 0
  }

  return {
    query,
    results,
    selectedIndex,
    moveSelection,
    reset,
  }
}
