import { watch, type WatchStopHandle } from 'vue'
import router, { currentSiteProfile } from '@/router'
import { isKnownSiteProfile } from '@/config/site-registry'
import { getCentralLoginFallbackUrl, redirectToCentralLogin } from '@/service/centralLoginService'
import { replaceDocument } from '@/service/navigationService'
import { useSessionStore } from '@/stores/sessionStore'
import { getLoginRoute } from '@/utils/auth-routes'

let redirectPromise: Promise<void> | null = null

const isAuthEntryRoute = () =>
  router.currentRoute.value.matched.some((record) => record.meta.isAuthEntry === true)

const isGuestRoute = () => {
  const route = router.currentRoute.value
  return (
    route.meta.allowGuest === true ||
    (route.meta.allowGuestWhenEmbedded === true && String(route.query.embed ?? '') === '1')
  )
}

const redirectExpiredSession = async () => {
  if (
    redirectPromise ||
    !isKnownSiteProfile(currentSiteProfile) ||
    isAuthEntryRoute() ||
    isGuestRoute()
  ) {
    return redirectPromise
  }

  const returnPath = router.currentRoute.value.fullPath
  redirectPromise = (async () => {
    if (currentSiteProfile.id === 'identity') {
      await router.replace(getLoginRoute(returnPath))
      return
    }

    try {
      await redirectToCentralLogin(returnPath)
    } catch (error) {
      console.warn('[session] Central login redirect failed after session expiry:', error)
      replaceDocument(getCentralLoginFallbackUrl(currentSiteProfile))
    }
  })().finally(() => {
    redirectPromise = null
  })

  return redirectPromise
}

export const installSessionExpiryRedirect = (): WatchStopHandle => {
  const sessionStore = useSessionStore()

  return watch(
    () => sessionStore.status,
    (status, previousStatus) => {
      if (status === 'expired' && previousStatus === 'authenticated') {
        void redirectExpiredSession()
      }
    },
  )
}
