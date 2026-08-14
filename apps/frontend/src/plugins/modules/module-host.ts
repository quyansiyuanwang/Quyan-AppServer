import type { Component } from 'vue'
import type { Router } from 'vue-router'
import type { ResolvedSiteProfile, SiteProfile, SiteProfileId } from '@/config/site-registry'
import type {
  FeatureModule,
  FeatureModuleContext,
  FeatureModuleRuntime,
  SiteModule,
  SiteModuleContext,
} from './contracts'

export type SiteModuleLoader = () => Promise<{ default: SiteModule }>

const featureKey = (profile: SiteProfile, feature: FeatureModule) =>
  `${profile.deploymentId}:${profile.id}:${feature.id}`

/**
 * Owns lazy site/feature module loading. The host intentionally caches module
 * promises: a rapid menu double-click or duplicated router navigation must not
 * initialize the same feature twice.
 */
export class ModuleHost {
  private readonly siteLoads = new Map<SiteProfileId, Promise<SiteModule>>()
  private readonly featureLoads = new Map<string, Promise<FeatureModuleRuntime>>()
  private readonly featureActivations = new Map<string, Promise<void>>()
  private activeFeature?: { feature: FeatureModule; runtime: FeatureModuleRuntime; profile: SiteProfile }

  constructor(private readonly siteLoaders: Readonly<Partial<Record<SiteProfileId, SiteModuleLoader>>>) {}

  loadSite(profile: SiteProfile): Promise<SiteModule> {
    const existing = this.siteLoads.get(profile.id)
    if (existing) return existing

    const loader = this.siteLoaders[profile.id]
    if (!loader) return Promise.reject(new Error(`No site module is registered for "${profile.id}".`))

    const loading = loader().then(({ default: module }) => {
      if (module.id !== profile.id) {
        throw new Error(`Site module "${module.id}" does not match profile "${profile.id}".`)
      }
      return module
    })
    this.siteLoads.set(profile.id, loading)
    return loading
  }

  async loadApp(profile: ResolvedSiteProfile, rejectedApp: () => Promise<Component>): Promise<Component> {
    if (profile.id === 'rejected') return rejectedApp()
    return (await this.loadSite(profile)).loadApp()
  }

  async installSiteRoutes(router: Router, profile: ResolvedSiteProfile): Promise<void> {
    if (profile.id === 'rejected') return
    const site = await this.loadSite(profile)
    const context: SiteModuleContext = { profile, router }
    for (const route of await site.loadRoutes(context)) router.addRoute(route)
  }

  async activateRoute(router: Router, profile: ResolvedSiteProfile, routeName: string | symbol | null | undefined) {
    if (profile.id === 'rejected' || typeof routeName !== 'string') return
    const site = await this.loadSite(profile)
    const feature = site.features.find((candidate) => candidate.routeNames.includes(routeName))
    if (!feature || this.activeFeature?.feature.id === feature.id) return

    const context: FeatureModuleContext = { profile, router }
    const key = featureKey(profile, feature)
    const active = this.featureActivations.get(key)
    if (active) return active

    const activation = this.activateFeature(context, feature, key)
    this.featureActivations.set(key, activation)
    try {
      await activation
    } finally {
      this.featureActivations.delete(key)
    }
  }

  private async activateFeature(
    context: FeatureModuleContext,
    feature: FeatureModule,
    key: string,
  ): Promise<void> {
    let loading = this.featureLoads.get(key)
    if (!loading) {
      loading = feature.load()
      this.featureLoads.set(key, loading)
    }
    const runtime = await loading

    if (this.activeFeature) {
      await this.activeFeature.runtime.dispose?.({
        profile: this.activeFeature.profile,
        router: context.router,
      })
    }
    await runtime.activate?.(context)
    this.activeFeature = { feature, runtime, profile: context.profile }
  }

  async getFeatures(profile: ResolvedSiteProfile): Promise<readonly FeatureModule[]> {
    if (profile.id === 'rejected') return []
    return (await this.loadSite(profile)).features
  }

  async dispose(router: Router): Promise<void> {
    if (!this.activeFeature) return
    const context: FeatureModuleContext = {
      profile: this.activeFeature.profile,
      router,
    }
    await this.activeFeature.runtime.dispose?.(context)
    this.activeFeature = undefined
  }
}
