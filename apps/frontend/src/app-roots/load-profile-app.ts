import type { Component } from 'vue'
import type { ResolvedSiteProfile } from '@/config/site-registry'

type AppRootModule = { default: Component }
const domainAppLoaders = import.meta.glob<AppRootModule>('./domains/*.vue')

export const loadProfileApp = async (profile: ResolvedSiteProfile): Promise<Component> => {
  if (profile.id === 'rejected') return (await import('./RejectedHostApp.vue')).default

  if (profile.id === 'public') return (await import('./PublicApp.vue')).default
  if (profile.id === 'identity') return (await import('./IdentityApp.vue')).default

  const loader = domainAppLoaders['./domains/' + profile.app + '.vue']
  if (!loader) {
    throw new Error('No domain app is registered for site profile "' + profile.id + '".')
  }

  return (await loader()).default
}
