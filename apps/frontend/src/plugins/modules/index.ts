import { ModuleHost } from './module-host'
import { siteModuleLoaders } from '@/plugins/sites/site-module-loaders'

export { defineFeatureModule, defineSiteModule } from './contracts'
export type {
  FeatureModule,
  FeatureModuleContext,
  FeatureModuleRuntime,
  SiteModule,
  SiteModuleContext,
} from './contracts'
export { ModuleHost } from './module-host'
export { getFeatureManifestEntries, hasFeatureRoute } from './feature-manifest'
export type { FeatureManifestEntry } from './feature-manifest'

export const moduleHost = new ModuleHost(siteModuleLoaders)
