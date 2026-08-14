import { currentSiteProfile } from '@/router'
import router from '@/router'
import { resolveCanonicalRouteUrl } from '@/router/routes'
import type { RouteName } from '@/types/route-types.gen'
import { assignDocument } from '@/service/navigationService'

/** Navigates locally when possible and otherwise crosses to the route's canonical host. */
export const navigateToCanonicalRoute = (routeName: RouteName): void => {
  if (currentSiteProfile.id !== 'rejected') {
    const target = resolveCanonicalRouteUrl(routeName, currentSiteProfile)
    if (target && new URL(target).origin !== currentSiteProfile.canonicalOrigin) {
      assignDocument(target)
      return
    }
  }

  void router.push({ name: routeName } as any)
}
