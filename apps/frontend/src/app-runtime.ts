import { createApp, type App } from 'vue'
import { createPinia } from 'pinia'
import router, { currentSiteProfile, installProfileRoutes } from '@/router'
import { isKnownSiteProfile } from '@/config/site-registry'
import { loadProfileApp } from '@/app-roots/load-profile-app'
import { i18ns, initializeI18n } from '@/locales'
import { configureAll } from '@/config'
import { installErrorReporter, reportClientError } from '@/service/errorReportService'
import { clearLegacyAuthStorage } from '@/stores/request'
import { sessionCoordinator } from '@/service/sessionCoordinator'

export type AppRuntimePhase =
  | 'created'
  | 'routes-ready'
  | 'session-ready'
  | 'mounted'
  | 'running'

const isAuthEntryPath = () =>
  router.resolve(window.location.pathname).matched.some((route) => route.meta.isAuthEntry === true)

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
    clearLegacyAuthStorage()
    await initializeI18n()
    await installProfileRoutes(router, currentSiteProfile)
    this.phase = 'routes-ready'

    const app = createApp(await loadProfileApp(currentSiteProfile))
    app.use(createPinia())
    app.use(router)
    app.use(i18ns.plugin)
    app.config.errorHandler = (error, _instance, info) => {
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

    // Auth-entry and public routes deliberately do not probe the session cookie.
    if (isKnownSiteProfile(currentSiteProfile) && !isAuthEntryPath()) {
      const initialRoute = router.resolve(window.location.pathname)
      if (initialRoute.matched.some((route) => route.meta.allowGuest !== true)) {
        await sessionCoordinator.ensureSession()
      }
    }
    this.phase = 'session-ready'

    app.mount('#app')
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
