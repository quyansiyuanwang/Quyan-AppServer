import type { Component } from 'vue'

type FeatureName =
  | 'analytics'
  | 'auth'
  | 'management'
  | 'misc'
  | 'products'
  | 'relay'
  | 'settings'
  | 'system'

interface FeatureViewModule {
  getView: (path: string) => Component
}

const featureLoaders: Record<FeatureName, () => Promise<FeatureViewModule>> = {
  analytics: () => import('./feature-views/analytics'),
  auth: () => import('./feature-views/auth'),
  management: () => import('./feature-views/management'),
  misc: () => import('./feature-views/misc'),
  products: () => import('./feature-views/products'),
  relay: () => import('./feature-views/relay'),
  settings: () => import('./feature-views/settings'),
  system: () => import('./feature-views/system'),
}

const loadedFeatures = new Map<FeatureName, Promise<FeatureViewModule>>()

const loadFeature = (feature: FeatureName): Promise<FeatureViewModule> => {
  const existing = loadedFeatures.get(feature)
  if (existing) return existing

  const loader = featureLoaders[feature]()
  loadedFeatures.set(feature, loader)
  return loader
}

/**
 * Preserve Vue Router's lazy-component contract while loading all views for a
 * business domain from its one feature bundle. This avoids one tiny dynamic
 * import facade per route without making the domain part of the app shell.
 */
export const lazyFeatureView = (feature: FeatureName, path: string) => async () => ({
  default: (await loadFeature(feature)).getView(path),
})
