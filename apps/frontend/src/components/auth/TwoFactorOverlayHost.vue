<template>
  <Teleport to="body">
    <div
      v-if="overlayState.visible && overlayState.context"
      ref="hostRef"
      class="two-factor-overlay-host"
      :style="{ zIndex: TWO_FACTOR_OVERLAY_Z_INDEX }"
      role="presentation"
    >
      <div class="two-factor-overlay-backdrop" aria-hidden="true" />
      <div
        class="two-factor-overlay-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="i18ns.t('twoFactor.verifyIdentityTitle')"
        tabindex="-1"
      >
        <TwoFactorVerificationPanel :overlay="true" :context="overlayState.context" />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { i18ns } from '@/locales'
import {
  twoFactorOverlayService,
  TWO_FACTOR_OVERLAY_Z_INDEX,
} from '@/service/twoFactorOverlayService'

const TwoFactorVerificationPanel = defineAsyncComponent(
  () => import('@/components/auth/TwoFactorVerificationPanel.vue'),
)

const overlayState = twoFactorOverlayService.state
const hostRef = ref<HTMLElement | null>(null)
let previousBodyOverflow = ''
let previouslyFocused: HTMLElement | null = null
let appWasInert = false
let lockAcquired = false

const getFocusableElements = (): HTMLElement[] => {
  const root = hostRef.value
  if (!root) return []

  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null)
}

const focusOverlay = async () => {
  await nextTick()
  const dialog = hostRef.value?.querySelector<HTMLElement>('.two-factor-overlay-dialog')
  const firstFocusable = getFocusableElements()[0]
  ;(firstFocusable || dialog)?.focus()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (!overlayState.visible) return

  // A challenge must not be bypassed through the keyboard or backdrop.
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (event.key !== 'Tab') return

  const focusable = getFocusableElements()
  if (focusable.length === 0) {
    event.preventDefault()
    void focusOverlay()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  const dialog = hostRef.value?.querySelector<HTMLElement>('.two-factor-overlay-dialog')
  if (!hostRef.value?.contains(active) || active === dialog) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
    return
  }

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first?.focus()
  }
}

const syncScrollLock = (visible: boolean) => {
  const app = document.getElementById('app')
  if (visible) {
    if (lockAcquired) return
    lockAcquired = true
    previousBodyOverflow = document.body.style.overflow
    previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    appWasInert = app?.inert || false
    if (app) app.inert = true
    document.body.style.overflow = 'hidden'
    void focusOverlay()
    return
  }

  if (!lockAcquired) return
  lockAcquired = false
  if (app) app.inert = appWasInert
  document.body.style.overflow = previousBodyOverflow
  previousBodyOverflow = ''
  previouslyFocused?.focus()
  previouslyFocused = null
}

onMounted(() => {
  twoFactorOverlayService.restore()
  document.addEventListener('keydown', handleKeydown, true)
  if (overlayState.visible) syncScrollLock(true)
})

watch(
  () => overlayState.visible,
  (visible) => syncScrollLock(visible),
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown, true)
  if (overlayState.visible) syncScrollLock(false)
})
</script>

<style scoped>
.two-factor-overlay-host {
  position: fixed;
  inset: 0;
  isolation: isolate;
}

.two-factor-overlay-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--el-bg-color-page, #0f172a) 78%, transparent);
  backdrop-filter: blur(4px);
}

.two-factor-overlay-dialog {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  outline: none;
  overflow: auto;
}

:deep(.verify-page) {
  min-height: 100%;
  box-sizing: border-box;
  background:
    radial-gradient(circle at 10% 12%, var(--verify-bg-soft), transparent 38%),
    linear-gradient(180deg, color-mix(in srgb, var(--verify-bg-mute) 88%, transparent), transparent);
}

:deep(.verify-actions) {
  display: none;
}
</style>
