import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { resolveRouteMigrationUrl } from './route-migration'
import {
  isKnownSiteProfile,
  resolveCurrentSiteProfile,
  type ResolvedSiteProfile,
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

  installNavigationGuards(router, profile)
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

function installNavigationGuards(
  router: ReturnType<typeof createRouter>,
  profile: ResolvedSiteProfile,
) {
  // 全局路由守卫：检查认证状态
  router.beforeEach(async (to, from, next) => {
    if (!isKnownSiteProfile(profile)) {
      next()
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

    const requiresCaptchaPreflight = Boolean(to.meta.requiresCaptchaPreflight)

    if (requiresCaptchaPreflight && to.name !== 'captchaVerification') {
      const [{ captchaTrustStateService }, { resolveCaptchaPreflightAction }] = await Promise.all([
        import('@/service/captchaTrustStateService'),
        import('@/service/captchaDialogService'),
      ])

      const captchaAction = resolveCaptchaPreflightAction(to)
      if (captchaAction) {
        try {
          const status = await captchaTrustStateService.getTrustStatus()
          if (status.trusted) {
            next()
            return
          }
        } catch {
          // fall through without blocking auth entry pages
        }
      }
    }

    if (allowGuestWhenEmbedded || allowGuest) {
      next()
      return
    }

    const token = await sessionCoordinator.ensureSession()

    if (!token) {
      if (profile.id === 'identity') {
        next({ name: 'login', query: { redirect: to.fullPath } })
        return
      }

      try {
        await redirectToCentralLogin(to.fullPath)
      } catch (error) {
        console.error('Failed to start central login:', error)

        // A failed flow request must not leave the user on a protected page.
        // Fall back to the same environment's auth origin; the auth app will
        // establish the session and send the user to its default destination.
        replaceDocument(getCentralLoginFallbackUrl(profile))
      }
      next(false)
      return
    }

    // The coordinator coalesces this with startup and later navigations. Do not
    // enter a protected shell until its identity and menu permissions are ready.
    try {
      await sessionCoordinator.hydrateUserAndPermissions()
    } catch (error) {
      console.warn('[router] Failed to hydrate authenticated session:', error)
    }
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
