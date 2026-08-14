import type { Component } from 'vue'
import type { RouteRecordRaw, Router } from 'vue-router'
import type { SiteProfile, SiteProfileId } from '@/config/site-registry'

export interface FeatureModuleContext {
  profile: SiteProfile
  router: Router
}

export interface FeatureModuleRuntime {
  activate?(context: FeatureModuleContext): void | Promise<void>
  dispose?(context: FeatureModuleContext): void | Promise<void>
}

export interface FeatureModule {
  id: string
  siteId: SiteProfileId
  routeNames: readonly string[]
  paths: readonly string[]
  load: () => Promise<FeatureModuleRuntime>
}

export interface SiteModuleContext {
  profile: SiteProfile
  router: Router
}

export interface SiteModule {
  id: SiteProfileId
  loadApp: () => Promise<Component>
  loadRoutes: (context: SiteModuleContext) => Promise<readonly RouteRecordRaw[]>
  features: readonly FeatureModule[]
}

export const defineFeatureModule = <T extends FeatureModule>(module: T): T => module

export const defineSiteModule = <T extends SiteModule>(module: T): T => module
