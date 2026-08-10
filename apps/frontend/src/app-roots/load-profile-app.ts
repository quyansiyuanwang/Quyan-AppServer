import type { Component } from 'vue'
import type { ResolvedSiteProfile, SiteProfileId } from '@/config/site-registry'

type AppRootModule = { default: Component }
type AppRootLoader = () => Promise<AppRootModule>

const businessAppLoader: AppRootLoader = () => import('@/App.vue')

const profileAppLoaders: Readonly<Record<SiteProfileId, AppRootLoader>> = {
  public: () => import('./PublicApp.vue'),
  identity: () => import('./IdentityApp.vue'),
  account: businessAppLoader,
  chat: businessAppLoader,
  developer: businessAppLoader,
  terminal: businessAppLoader,
  'console-core': businessAppLoader,
  'console-ai': businessAppLoader,
  'console-developer': businessAppLoader,
  'console-terminal': businessAppLoader,
  'console-ram': businessAppLoader,
  'management-core': businessAppLoader,
  'management-ai': businessAppLoader,
  'management-developer': businessAppLoader,
  'management-terminal': businessAppLoader,
}

export const loadProfileApp = async (profile: ResolvedSiteProfile): Promise<Component> => {
  if (profile.id === 'rejected') return (await import('./RejectedHostApp.vue')).default
  return (await profileAppLoaders[profile.id]()).default
}
