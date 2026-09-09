import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { resolveRouteMigrationUrl } from './route-migration'
import {
  isKnownSiteProfile,
  resolveCurrentSiteProfile,
  type ResolvedSiteProfile,
  type SiteProfile,
} from '@/config/site-registry'
import { getCentralLoginFallbackUrl, redirectToCentralLogin } from '@/service/centralLoginService'
import { replaceDocument } from '@/service/navigationService'
import { sessionCoordinator } from '@/service/sessionCoordinator'
import { moduleHost } from '@/plugins/modules'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

const isAuthEntryRoute = (to: RouteLocationNormalized): boolean =>
  to.matched.some((record) => record.meta.isAuthEntry === true)

const isRootOAuthEntry = (to: RouteLocationNormalized): boolean =>
  to.path === '/' &&
  to.query.response_type === 'code' &&
  typeof to.query.client_id === 'string' &&
  typeof to.query.redirect_uri === 'string'

const scheduleAnalyticsTrack = (task: () => void) => {
  const scheduleTask = () => {
    const idleWindow = window as IdleWindow

    setTimeout(() => {
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.requestIdleCallback(task, { timeout: 5000 })
        return
      }

      task()
    }, 1200)
  }

  if (document.readyState === 'complete') {
    scheduleTask()
    return
  }

  window.addEventListener('load', scheduleTask, { once: true })
}

const rejectedHostRoutes = [
  {
    path: '/:catchAll(.*)',
    name: 'rejectedHost',
    component: () => import('@/views/common/404View.vue'),
    meta: { allowGuest: true },
  },
]

export const createAppRouter = (profile: ResolvedSiteProfile) => {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [],
  })

  router.onError((error, to) => {
    console.warn('[router] Failed to load route view', { route: String(to.name ?? ''), error })
    if (to.name !== 'home') void router.replace({ name: 'home' }).catch(() => undefined)
  })

  if (isKnownSiteProfile(profile)) {
    installNavigationGuards(router, profile)
  }
  return router
}

export const currentSiteProfile = resolveCurrentSiteProfile()
export const router = createAppRouter(currentSiteProfile)

export const installProfileRoutes = async (
  router: ReturnType<typeof createRouter>,
  profile: ResolvedSiteProfile,
): Promise<void> => {
  if (!isKnownSiteProfile(profile)) {
    for (const route of rejectedHostRoutes) router.addRoute(route)
    return
  }

  await moduleHost.installSiteRoutes(router, profile)
}

const validateProtectedNavigationInBackground = (
  router: ReturnType<typeof createRouter>,
  profile: SiteProfile,
  to: RouteLocationNormalized,
) => {
  void sessionCoordinator
    .ensureSession()
    .then(async (token) => {
      if (!token) {
        // A later navigation owns the redirect decision. Do not interrupt it
        // when an earlier route's session probe eventually resolves.
        if (router.currentRoute.value.fullPath !== to.fullPath) return

        if (profile.id === 'identity') {
          await router.replace({ name: 'login', query: { redirect: to.fullPath } })
          return
        }

        try {
          await redirectToCentralLogin(to.fullPath)
        } catch (error) {
          console.error('Failed to start central login:', error)
          replaceDocument(getCentralLoginFallbackUrl(profile))
        }
        return
      }

      // The initial navigation has not updated router.currentRoute yet when
      // this promise resolves. Hydration must still run so the shell receives
      // the user's permissions after mounting.
      await sessionCoordinator.hydrateUserAndPermissions()
    })
    .catch((error) => console.warn('[router] Background session validation failed:', error))
}

function installNavigationGuards(router: ReturnType<typeof createRouter>, profile: SiteProfile) {
  // 全局路由守卫：检查认证状态
  router.beforeEach(async (to, from, next) => {
    // Static hosts do not always rewrite deep links to index.html. The CLI
    // therefore starts OAuth at the identity site's root (which is always a
    // real file), and the SPA promotes the preserved query to its canonical
    // authorization route after boot.
    if (profile.id === 'identity' && isRootOAuthEntry(to)) {
      next({ name: 'oauthAuthorize', query: to.query, replace: true })
      return
    }

    const requestedUrl = new URL(to.fullPath, profile.canonicalOrigin)
    const migrationUrl = resolveRouteMigrationUrl(
      to.path,
      requestedUrl.search,
      requestedUrl.hash,
      profile,
    )
    if (migrationUrl) {
      replaceDocument(migrationUrl)
      next(false)
      return
    }

    if (isAuthEntryRoute(to)) {
      next()
      return
    }

    const allowGuestWhenEmbedded =
      to.meta.allowGuestWhenEmbedded === true && String(to.query.embed ?? '') === '1'
    const allowGuest = to.meta.allowGuest === true

    if (allowGuestWhenEmbedded || allowGuest) {
      next()
      return
    }

    // Let the route render immediately. The API remains the authority for
    // authentication and resource permissions; this background validation
    // redirects only after it has a definitive answer from the backend.
    validateProtectedNavigationInBackground(router, profile, to)
    next()
  })

  router.afterEach((to, from) => {
    if (isAuthEntryRoute(to)) return

    scheduleAnalyticsTrack(() => {
      void import('@/utils/tracker')
        .then(({ tracker }) => {
          tracker.track('view', 'page_view', {
            toPath: to.fullPath,
            toName: String(to.name ?? ''),
            fromPath: from.fullPath,
            title: document.title,
          })
        })
        .catch((error) => {
          console.warn('[router] Failed to record page view:', error)
        })
    })

    void moduleHost.activateRoute(router, profile, to.name).catch((error) => {
      console.warn('[router] Failed to activate feature module:', error)
    })
  })
}

export default router
