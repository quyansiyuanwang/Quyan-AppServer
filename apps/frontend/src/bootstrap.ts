import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from '@/App.vue'
import router from '@/router'
import { currentSiteProfile } from '@/router'
import { isKnownSiteProfile } from '@/config/site-registry'
import { queueBusinessRoutePreload } from '@/router/preload'
import { i18ns, initializeI18n } from '@/locales'
import { configureAll } from '@/config'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { resetCurrentStorageScope, setCurrentStorageScopeForUserId } from '@/utils/storageScope'
import { installErrorReporter, reportClientError } from '@/service/errorReportService'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

const scheduleAfterLoad = (task: () => void, delay: number, timeout: number) => {
  const scheduleTask = () => {
    const idleWindow = window as IdleWindow

    setTimeout(() => {
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.requestIdleCallback(task, { timeout })
        return
      }

      task()
    }, delay)
  }

  if (document.readyState === 'complete') {
    scheduleTask()
    return
  }

  window.addEventListener('load', scheduleTask, { once: true })
}

const shouldSkipDeferredStartupWork = () =>
  router
    .resolve(window.location.pathname)
    .matched.some((record) => record.meta.isAuthEntry === true)

export const bootstrapApp = async () => {
  try {
    await initializeI18n()
  } catch (error) {
    console.error('[i18n] Failed to initialize locale messages:', error)
  }

  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)
  app.use(i18ns.plugin)

  configureAll()

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

  const impersonationStore = useImpersonationStore()
  impersonationStore.hydrate()

  if (impersonationStore.sessionInfo?.targetUserId) {
    setCurrentStorageScopeForUserId(impersonationStore.sessionInfo.targetUserId)
  } else {
    resetCurrentStorageScope()
  }

  if (impersonationStore.isImpersonating) {
    const { impersonationService } = await import('@/service/impersonationService')
    impersonationService.registerExpiryHandlerOnRestore()
  }

  // Install before mounting so render-time and startup event failures are captured.
  installErrorReporter()
  app.mount('#app')

  if (!isKnownSiteProfile(currentSiteProfile)) return

  if (shouldSkipDeferredStartupWork()) {
    scheduleAfterLoad(
      () => {
        void import('@/events')
          .then(({ registerAllEvents }) => {
            registerAllEvents()
          })
          .catch((error) => {
            console.warn('[bootstrap] Failed to register deferred event listeners:', error)
          })
      },
      800,
      4000,
    )
  } else {
    const { registerAllEvents } = await import('@/events')
    registerAllEvents()
  }

  if (!shouldSkipDeferredStartupWork()) {
    scheduleAfterLoad(
      () => {
        void import('@/plugins/analytics')
          .then(({ setupAnalytics }) => {
            setupAnalytics(app)
          })
          .catch((error) => {
            console.warn('[bootstrap] Failed to initialize analytics:', error)
          })
      },
      1200,
      5000,
    )

    scheduleAfterLoad(
      () => {
        void import('@/service/authorizationService')
          .then(async ({ authorizationService }) => {
            const token = await authorizationService.bootstrapSession()
            if (token) queueBusinessRoutePreload(router)
          })
          .catch((error) => {
            console.warn('[bootstrap] Failed to restore heartbeat session:', error)
          })
      },
      2400,
      8000,
    )
  }
}
