import type { SiteProfileId } from '@/config/site-registry'
import type { SiteModule } from '@/plugins/modules/contracts'
import type { SiteModuleLoader } from '@/plugins/modules/module-host'

const siteEntryLoaders = import.meta.glob<{ default: SiteModule }>('./*/site.ts')

const loadSiteModule = async (siteId: SiteProfileId): Promise<{ default: SiteModule }> => {
  const loader = siteEntryLoaders[`./${siteId}/site.ts`]
  if (!loader) throw new Error(`No site module is registered for "${siteId}".`)
  return loader()
}

// Site entry modules subscribe their own generated view manifest. Only the
// entry selected by the hostname is imported, preserving domain chunking.
export const siteModuleLoaders = new Proxy({} as Record<SiteProfileId, SiteModuleLoader>, {
  get: (_target, property) => {
    if (typeof property !== 'string') return undefined
    return () => loadSiteModule(property as SiteProfileId)
  },
})
