import { watch, type WatchStopHandle } from 'vue'
import router, { currentSiteProfile } from '@/router'
import { isKnownSiteProfile } from '@/config/site-registry'
import { navigateToLogin } from '@/service/authNavigationService'
import { useSessionStore } from '@/stores/sessionStore'

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
  redirectPromise = navigateToLogin(router, currentSiteProfile, returnPath).finally(() => {
    redirectPromise = null
  })

  return redirectPromise
}

export const installSessionExpiryRedirect = (): WatchStopHandle => {
  const sessionStore = useSessionStore()

  return watch(
    () => sessionStore.status,
    (status) => {
      if (status === 'expired') {
        void redirectExpiredSession()
      }
    },
    { immediate: true },
  )
}
