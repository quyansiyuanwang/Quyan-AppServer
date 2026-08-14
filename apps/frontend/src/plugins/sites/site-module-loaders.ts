import type { SiteProfileId } from '@/config/site-registry'
import type { SiteModuleLoader } from '@/plugins/modules/module-host'

const siteModules = import.meta.glob<{ default: unknown }>('./*/site.ts')

const siteModulePath = (id: SiteProfileId) => `./${id}/site.ts`

export const siteModuleLoaders = new Proxy({} as Record<SiteProfileId, SiteModuleLoader>, {
  get: (_target, property) => {
    if (typeof property !== 'string') return undefined
    return siteModules[siteModulePath(property as SiteProfileId)] as SiteModuleLoader | undefined
  },
})
