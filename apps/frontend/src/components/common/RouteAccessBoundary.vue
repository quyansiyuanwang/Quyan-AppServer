<template>
  <component :is="profileApp" v-if="showApp" />

  <aside
    v-if="preserveView && !isIdle"
    class="route-recovery-notice"
    role="status"
    aria-live="polite"
  >
    <span>{{ isRecovering ? i18ns.t('routeAccess.recovering') : description }}</span>
    <button
      v-if="!isRecovering"
      class="route-access-button"
      :disabled="!online"
      @click="retryNavigation"
    >
      {{ online ? i18ns.t('routeAccess.retry') : i18ns.t('routeAccess.offline') }}
    </button>
  </aside>

  <main
    v-if="!showApp && (isRedirecting || isRecovering)"
    class="route-access-page"
    aria-live="polite"
  >
    <div class="route-access-loading" role="status">
      <span class="route-access-spinner" aria-hidden="true" />
      <span>Quyan</span>
    </div>
  </main>

  <main v-else-if="!showApp" class="route-access-page">
    <section class="route-access-panel" aria-labelledby="route-access-title">
      <p class="route-access-code" aria-hidden="true">{{ code }}</p>
      <h1 id="route-access-title">{{ title }}</h1>
      <p class="route-access-description">{{ description }}</p>
      <div class="route-access-actions">
        <button
          class="route-access-button is-primary"
          type="button"
          :disabled="!isDenied && !online"
          @click="handlePrimary"
        >
          {{ primaryAction }}
        </button>
        <button class="route-access-button" type="button" @click="handleLogin">
          {{ i18ns.t('routeAccess.backToLogin') }}
        </button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, type Component } from 'vue'
import { i18ns } from '@/locales'
import router, { currentSiteProfile } from '@/router'
import { routeAccessState } from '@/router/route-access'
import { clearSessionAndNavigateToLogin } from '@/service/authNavigationService'
import { reloadDocument } from '@/service/navigationService'
import { classifyRecoveryFailure } from '@/utils/session-recovery'
import { isKnownSiteProfile } from '@/config/site-registry'

defineProps<{ profileApp: Component }>()

const online = ref(navigator.onLine)
const preserveView = computed(() => routeAccessState.preserveView.value)
const isRecovering = computed(() => routeAccessState.status.value === 'recovering')
const showApp = computed(() => isIdle.value || preserveView.value)
const isIdle = computed(() => routeAccessState.status.value === 'idle')
const isRedirecting = computed(() => routeAccessState.status.value === 'redirecting')
const isDenied = computed(() => routeAccessState.status.value === 'denied')
const code = computed(() => (isDenied.value ? '403' : '!'))
const title = computed(() =>
  i18ns.t(isDenied.value ? 'routeAccess.forbiddenTitle' : 'routeAccess.sessionErrorTitle'),
)
const description = computed(() =>
  i18ns.t(
    isDenied.value ? 'routeAccess.forbiddenDescription' : 'routeAccess.sessionErrorDescription',
  ),
)
const primaryAction = computed(() =>
  i18ns.t(isDenied.value ? 'routeAccess.goBack' : 'routeAccess.retry'),
)

const retryNavigation = async () => {
  const target = routeAccessState.targetPath.value
  if (!target || !online.value || isRecovering.value) return
  const resolved = router.resolve(target)
  await router
    .replace({ path: resolved.path, query: resolved.query, hash: resolved.hash, force: true })
    .catch(() => undefined)
}
const onConnectivity = () => {
  online.value = navigator.onLine
  const kind = classifyRecoveryFailure(routeAccessState.error.value)
  if (
    online.value &&
    routeAccessState.status.value === 'error' &&
    (kind === 'offline' || kind === 'transient')
  )
    void retryNavigation()
}
onMounted(() => {
  window.addEventListener('online', onConnectivity)
  window.addEventListener('offline', onConnectivity)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', onConnectivity)
  window.removeEventListener('offline', onConnectivity)
})
const handlePrimary = () => {
  if (!isDenied.value) {
    void retryNavigation()
    return
  }

  if (router.currentRoute.value.name) {
    router.back()
    return
  }

  void router.replace({ name: 'home' }).catch(() => undefined)
}

const handleLogin = () => {
  if (!isKnownSiteProfile(currentSiteProfile)) return

  const returnPath = routeAccessState.targetPath.value || router.currentRoute.value.fullPath
  void clearSessionAndNavigateToLogin(router, currentSiteProfile, returnPath).catch((error) => {
    console.warn('[route-access] Failed to redirect to login:', error)
    reloadDocument()
  })
}
</script>

<style scoped>
.route-recovery-notice {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
  display: flex;
  align-items: center;
  gap: 16px;
  width: max-content;
  max-width: calc(100vw - 48px);
  padding: 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  box-shadow: var(--el-box-shadow-light);
}

.route-access-page {
  box-sizing: border-box;
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
  background: var(--color-background);
}

.route-access-panel {
  width: min(100%, 560px);
  padding: 40px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
  text-align: center;
}

.route-access-code {
  margin: 0;
  color: var(--el-color-primary);
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
}

.route-access-panel h1 {
  margin: 20px 0 0;
  color: var(--el-text-color-primary);
  font-size: 24px;
  font-weight: 600;
}

.route-access-description {
  margin: 12px auto 0;
  color: var(--el-text-color-regular);
  line-height: 1.7;
}

.route-access-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}

.route-access-button {
  min-width: 120px;
  padding: 10px 18px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  cursor: pointer;
}

.route-access-button.is-primary {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
}

.route-access-loading {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--el-text-color-primary);
  font-size: 18px;
  font-weight: 600;
}

.route-access-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--el-border-color);
  border-top-color: var(--el-color-primary);
  border-radius: 50%;
  animation: route-access-spin 0.8s linear infinite;
}

@keyframes route-access-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 480px) {
  .route-access-page {
    padding: 16px;
  }

  .route-access-panel {
    padding: 32px 24px;
  }

  .route-access-button {
    width: 100%;
  }
}
</style>
