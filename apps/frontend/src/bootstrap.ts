import { createApp } from 'vue'
import { createPinia } from 'pinia'
import type { RouteRecordRaw } from 'vue-router'

import App from '@/App.vue'
import router from '@/router'
import { queueBusinessRoutePreload } from '@/router/preload'
import { routes } from '@/router/routes'
import { i18ns, initializeI18n } from '@/locales'
import { configureAll } from '@/config'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { resetCurrentStorageScope, setCurrentStorageScopeForUserId } from '@/utils/storageScope'

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

const resolveRoutePath = (path: string, basePath = ''): string => {
  if (!path) return basePath || '/'
  if (path.startsWith('/')) return path

  const normalizedBase = basePath === '/' ? '' : basePath.replace(/\/$/, '')
  const normalizedPath = path.replace(/^\//, '')

  if (!normalizedBase) return `/${normalizedPath}`
  return `${normalizedBase}/${normalizedPath}`
}

const hasAuthEntryRoute = (
  records: readonly RouteRecordRaw[],
  pathname: string,
  basePath = '',
): boolean => {
  for (const record of records) {
    const fullPath = resolveRoutePath(record.path, basePath)

    if (record.meta?.isAuthEntry === true && fullPath === pathname) {
      return true
    }

    if (Array.isArray(record.children) && record.children.length > 0) {
      const nextBasePath = record.path.startsWith('/')
        ? record.path
        : resolveRoutePath(record.path, basePath)

      if (hasAuthEntryRoute(record.children, pathname, nextBasePath)) {
        return true
      }
    }
  }

  return false
}

const shouldSkipDeferredStartupWork = () => hasAuthEntryRoute(routes, window.location.pathname)

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

  app.mount('#app')

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
