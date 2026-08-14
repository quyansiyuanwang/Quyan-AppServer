import type { Component } from 'vue'
import type { SiteProfileId } from '@/config/site-registry'
import { defineFeatureModule, defineSiteModule, type SiteModule } from '@/plugins/modules/contracts'
import { getFeatureManifestEntries } from '@/plugins/modules/feature-manifest'

type AppRootModule = { default: Component }

const domainAppLoaders = import.meta.glob<AppRootModule>('/src/app-roots/domains/*.vue')

const loadApplicationRoot = async (
  siteId: SiteProfileId,
  appRoot: string = siteId,
): Promise<Component> => {
  if (siteId === 'public') return (await import('@/app-roots/PublicApp.vue')).default
  if (siteId === 'identity') return (await import('@/app-roots/IdentityApp.vue')).default

  const loader = domainAppLoaders[`/src/app-roots/domains/${appRoot}.vue`]
  if (!loader) throw new Error(`No application root is registered for site "${siteId}".`)
  return (await loader()).default
}

/**
 * Keeps the current route records available during migration while exposing
 * every canonical page as a feature manifest. The route table is imported only
 * after this exact site module has been selected from the hostname.
 */
export const createCompatibilitySiteModule = (
  siteId: SiteProfileId,
  appRoot?: string,
): SiteModule => {
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
