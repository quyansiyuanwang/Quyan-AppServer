import type { Permission } from '@quyan/shared'

declare module 'vue-router' {
  interface RouteMeta {
    allowGuest?: boolean
    allowGuestWhenEmbedded?: boolean
    isAuthEntry?: boolean
    permission?: Permission
    publicStatus?: boolean
    titleKey?: string
  }
}
