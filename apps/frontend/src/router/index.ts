import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { resolveRouteMigrationUrl } from './route-migration'
import {
  isKnownSiteProfile,
  resolveCurrentSiteProfile,
  type ResolvedSiteProfile,
} from '@/config/site-registry'
import { globalEventBus } from '@/stores/globalInstance'
import { usePermissionStore } from '@/stores/permissionStore'
import { redirectToCentralLogin } from '@/service/centralLoginService'

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
  const profileRoutes = isKnownSiteProfile(profile)
    ? await import('./routes').then(({ createRoutesForProfile }) => createRoutesForProfile(profile))
    : rejectedHostRoutes

  for (const route of profileRoutes) {
    router.addRoute(route)
  }
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
      window.location.replace(migrationUrl)
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

    const { authorizationService, AuthorizationService } = await import(
      '@/service/authorizationService'
    )
    const accessToken = AuthorizationService.getAccessToken()
    const token = accessToken || (await authorizationService.bootstrapSession())

    if (!token) {
      if (allowGuestWhenEmbedded || allowGuest) {
        next()
        return
      }

      if (profile.id === 'identity') {
        next({ name: 'login', query: { redirect: to.fullPath } })
        return
      }

      try {
        await redirectToCentralLogin(to.fullPath)
      } catch (error) {
        console.error('Failed to start central login:', error)
      }
      next(false)
      return
    }

    const permissionStore = usePermissionStore()
    const requiredPermission = to.meta.permission as string | undefined
    const anyPermissions = to.meta.anyPermissions as string[] | undefined

    if (requiredPermission || (anyPermissions && anyPermissions.length > 0)) {
      try {
        await permissionStore.untilReady()

        const hasRequiredPermission = requiredPermission
          ? permissionStore.hasPermission(requiredPermission)
          : true
        const hasAnyPermission = anyPermissions?.length
          ? permissionStore.hasAnyPermission(...anyPermissions)
          : true

        if (!hasRequiredPermission || !hasAnyPermission) {
          globalEventBus.emit('FORBIDDEN')
          if (from.name) {
            next(false)
            return
          }

          next({ name: 'home' })
          return
        }
      } catch (error) {
        console.error('Failed to initialize permission guard:', error)
      }
    }

    // 其他情况正常导航
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
  })
}

export default router
