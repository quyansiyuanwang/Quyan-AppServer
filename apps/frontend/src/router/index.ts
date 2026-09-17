import { BACKGROUND_START_POLICY } from '@/config/loading-policy'
import { createRouter, createWebHistory } from 'vue-router'
import {
  isKnownSiteProfile,
  resolveCurrentSiteProfile,
  type ResolvedSiteProfile,
  type SiteProfile,
} from '@/config/site-registry'
import { moduleHost } from '@/plugins/modules'
import { installDocumentTitle } from './document-title'
import { createProtectedNavigationGuard, isAuthEntryRoute } from './navigation-guard'
import { installRoutePrefetch } from './route-prefetch'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

const scheduleAnalyticsTrack = (task: () => void) => {
  const scheduleTask = () => {
    const idleWindow = window as IdleWindow

    setTimeout(() => {
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.requestIdleCallback(task, {
          timeout: BACKGROUND_START_POLICY.analytics.idleTimeoutMs,
        })
        return
      }

      task()
    }, BACKGROUND_START_POLICY.analytics.delayMs)
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
    installDocumentTitle(router, profile)
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

function installNavigationGuards(router: ReturnType<typeof createRouter>, profile: SiteProfile) {
  installRoutePrefetch(router, profile)
  router.beforeEach(createProtectedNavigationGuard(router, profile))

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
