import { setupAnalytics } from '@/plugins/analytics'
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from '@/App.vue'
import router from '@/router'
import { i18ns, initializeI18n } from '@/locales'
import { configureAll } from '@/config'
import { registerAllEvents } from '@/events'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { resetCurrentStorageScope, setCurrentStorageScopeForUserId } from '@/utils/storageScope'
import { authorizationService } from '@/service/authorizationService'

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

  setupAnalytics(app)

  configureAll()
  registerAllEvents()

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

  void authorizationService.bootstrapSession().catch((error) => {
    console.warn('[bootstrap] Failed to restore heartbeat session:', error)
  })

  app.mount('#app')
}
