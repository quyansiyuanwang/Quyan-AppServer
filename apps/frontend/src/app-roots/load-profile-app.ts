import type { ResolvedSiteProfile } from '@/config/site-registry'
import { moduleHost } from '@/plugins/modules'

export const loadProfileApp = (profile: ResolvedSiteProfile) =>
  moduleHost.loadApp(profile, async () => (await import('./RejectedHostApp.vue')).default)
