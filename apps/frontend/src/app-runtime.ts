import { createApp, defineAsyncComponent, type App } from 'vue'
import { createPinia } from 'pinia'
import router, { currentSiteProfile, installProfileRoutes } from '@/router'
import { getPublicSiteProfile, isKnownSiteProfile } from '@/config/site-registry'
import { loadProfileApp } from '@/app-roots/load-profile-app'
import { i18ns, initializeI18n } from '@/locales'
import { configureAll } from '@/config'
import {
  installErrorReporter,
  reportClientError,
  showGlobalErrorNotice,
} from '@/service/errorReportService'
import { clearLegacyAuthStorage } from '@/stores/request'
import { installSessionExpiryRedirect } from '@/service/sessionExpiryRedirectService'
import { installRequestErrorNotifier } from '@/service/requestErrorNoticeInstaller'
import { replaceDocument } from '@/service/navigationService'
import RouteAccessBoundary from '@/components/common/RouteAccessBoundary.vue'
import { routeAccessState } from '@/router/route-access'
import { isNavigationFailure, NavigationFailureType } from 'vue-router'

export type AppRuntimePhase = 'created' | 'routes-ready' | 'session-ready' | 'mounted' | 'running'

const isAuthEntryPath = () =>
  router.resolve(window.location.pathname).matched.some((route) => route.meta.isAuthEntry === true)

const startupMark = (stage: string) => {
  performance.mark(`app-startup:${stage}`)
}

const startupMeasure = (stage: string, start: string, end: string) => {
  performance.measure(`app-startup:${stage}`, `app-startup:${start}`, `app-startup:${end}`)
}

export class AppRuntime {
  private startPromise: Promise<void> | null = null
  private phase: AppRuntimePhase = 'created'
  private app: App | null = null

  getPhase() {
    return this.phase
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal()
    return this.startPromise
  }

  private async startInternal(): Promise<void> {
    startupMark('start')
    clearLegacyAuthStorage()

    installRequestErrorNotifier()

    // The bare platform domain is an alias of the public site. Resolve it
    // before installing the rejected-host fallback, otherwise `/` renders a
    // 404 even though the canonical `www` host has the public routes.
    if (!isKnownSiteProfile(currentSiteProfile) && typeof window !== 'undefined') {
      const publicProfile = getPublicSiteProfile(window.location.hostname)
      const target = new URL(window.location.href)
      const canonical = new URL(publicProfile.canonicalOrigin)
      if (target.hostname !== canonical.hostname) {
        canonical.pathname = target.pathname
        canonical.search = target.search
        canonical.hash = target.hash
        replaceDocument(canonical.toString())
        return
      }
    }

    await initializeI18n()
    startupMark('i18n-ready')
    startupMeasure('i18n', 'start', 'i18n-ready')
    await installProfileRoutes(router, currentSiteProfile)
    startupMark('routes-ready')
    startupMeasure('site-routes', 'i18n-ready', 'routes-ready')
    this.phase = 'routes-ready'

    const profileApp = defineAsyncComponent(() => loadProfileApp(currentSiteProfile))
    const app = createApp(RouteAccessBoundary, { profileApp })
    startupMark('app-root-ready')
    startupMeasure('app-root', 'routes-ready', 'app-root-ready')
    app.use(createPinia())
    app.use(router)
    app.use(i18ns.plugin)
    app.config.errorHandler = (error, _instance, info) => {
      showGlobalErrorNotice(error)
      void reportClientError({
        errorType: error instanceof Error ? error.name : 'VueError',
        message: error instanceof Error ? error.message : String(error),
        route: window.location.pathname,
        severity: 'error',
        stack: error instanceof Error ? error.stack : undefined,
        context: { vueInfo: info },
      })
    }

    installErrorReporter()
    configureAll()
    this.app = app

    // Session restoration and permission hydration are resolved by the route
    // guard before this point. The boundary only renders the business app
    // after access has been approved.
    this.phase = 'session-ready'

    // Resolve the initial navigation before mount. The guard performs cookie
    // session restoration and permission hydration in front of an access
    // boundary, so protected views never mount speculatively.
    try {
      await router.isReady()
    } catch (error) {
      if (!isNavigationFailure(error, NavigationFailureType.aborted)) throw error
    }
    startupMark('router-ready')
    startupMeasure('router-ready', 'app-root-ready', 'router-ready')

    if (routeAccessState.status.value === 'redirecting') return

    app.mount('#app')
    startupMark('mounted')
    startupMeasure('total-to-mount', 'start', 'mounted')
    installSessionExpiryRedirect()
    this.phase = 'mounted'
    this.startOptionalPlugins(app)
    this.phase = 'running'
  }

  private startOptionalPlugins(app: App) {
    if (!isKnownSiteProfile(currentSiteProfile) || isAuthEntryPath()) return
    void import('@/plugins/analytics')
      .then(({ setupAnalytics }) => setupAnalytics(app))
      .catch((error) => console.warn('[runtime] Analytics initialization failed:', error))
  }
}

export const appRuntime = new AppRuntime()
