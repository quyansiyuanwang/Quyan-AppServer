import type { Component } from 'vue'
import type { SiteProfileId } from '@/config/site-registry'
import { registerSiteViewSubscription, type ViewModule } from '@/router/domain-view-loader'
import { defineFeatureModule, defineSiteModule, type SiteModule } from '@/plugins/modules/contracts'
import { getFeatureManifestEntries } from '@/plugins/modules/feature-manifest'

const loadApplicationRoot = async (
  siteId: SiteProfileId,
  _appRoot?: string,
): Promise<Component> => {
  if (siteId === 'public') return (await import('@/app-roots/PublicApp.vue')).default
  if (siteId === 'identity') return (await import('@/app-roots/IdentityApp.vue')).default

  // All non-public site profiles share the same router outlet. The historical
  // per-site wrappers only set a component name and created one request per
  // deployment without changing behavior.
  return (await import('@/App.vue')).default
}

/**
 * Keeps the current route records available during migration while exposing
 * every canonical page as a feature manifest. The route table is imported only
 * after this exact site module has been selected from the hostname.
 */
export const createCompatibilitySiteModule = (
  siteId: SiteProfileId,
  appRoot?: string,
  views?: ViewModule,
): SiteModule => {
  if (views) registerSiteViewSubscription(siteId, views)
  const entries = getFeatureManifestEntries(siteId)

  return defineSiteModule({
    id: siteId,
    loadApp: () => loadApplicationRoot(siteId, appRoot),
    loadRoutes: async ({ profile }) => {
      const { createRoutesForProfile } = await import('@/router/routes')
      return createRoutesForProfile(profile)
    },
    features: entries.map((entry) =>
      defineFeatureModule({
        id: entry.id,
        siteId,
        routeNames: [entry.routeName],
        paths: [entry.path],
        load: async () => (await import('./compatibility-feature')).default,
      }),
    ),
  })
}
