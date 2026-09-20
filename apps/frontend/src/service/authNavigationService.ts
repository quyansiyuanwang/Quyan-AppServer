import type { Router } from 'vue-router'
import type { SiteProfile } from '@/config/site-registry'
import { devSingleSiteMode } from '@/config/site-registry'
import { getLoginRoute } from '@/utils/auth-routes'
import { getCentralLoginFallbackUrl, redirectToCentralLogin } from '@/service/centralLoginService'
import { replaceDocument } from '@/service/navigationService'
import { sessionCoordinator } from '@/service/sessionCoordinator'

export const navigateToLogin = async (
  router: Router,
  profile: SiteProfile,
  returnPath: string,
): Promise<void> => {
  // The identity site owns the login routes. The privilege-free localhost mode
  // grafts them onto a business profile on one origin, so it must stay in-app
  // instead of creating a central-login flow that requires HTTPS.
  if (profile.id === 'identity' || devSingleSiteMode) {
    await router.replace(getLoginRoute(returnPath))
    return
  }

  try {
    await redirectToCentralLogin(returnPath)
  } catch (error) {
    console.warn('[auth] Central login redirect failed:', error)
    replaceDocument(getCentralLoginFallbackUrl(profile))
  }
}

export const clearSessionAndNavigateToLogin = async (
  router: Router,
  profile: SiteProfile,
  returnPath: string,
): Promise<void> => {
  await sessionCoordinator.logout()
  await navigateToLogin(router, profile, returnPath)
}
