import type { SiteProfileId } from '@/config/site-registry'
import type { SiteModule } from '@/plugins/modules/contracts'
import type { SiteModuleLoader } from '@/plugins/modules/module-host'

let siteModulesPromise: Promise<typeof import('./site-modules')> | null = null

const loadSiteModules = () => (siteModulesPromise ??= import('./site-modules'))

const loadSiteModule = async (siteId: SiteProfileId): Promise<{ default: SiteModule }> => {
  const { siteModules } = await loadSiteModules()
  const siteModule = siteModules[siteId]
  if (!siteModule) throw new Error(`No site module is registered for "${siteId}".`)
  return { default: siteModule }
}

// All hostname declarations are fetched as one small registry. Their app
// roots remain dynamic imports inside createCompatibilitySiteModule, so this
// does not pull code for every domain into the first document.
export const siteModuleLoaders = new Proxy({} as Record<SiteProfileId, SiteModuleLoader>, {
  get: (_target, property) => {
    if (typeof property !== 'string') return undefined
    return () => loadSiteModule(property as SiteProfileId)
  },
})
