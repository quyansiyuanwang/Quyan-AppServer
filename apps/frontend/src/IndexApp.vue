<template>
  <RouterView v-slot="{ Component, route }">
    <Transition :name="getShellTransitionName(route)" mode="out-in" appear>
      <component :is="Component" :key="getViewTransitionKey(route)" />
    </Transition>
  </RouterView>
  <TopLoadingProgress />
  <OverLay v-if="!isEmbeddedShell && !isPublicStatus">
    <template v-if="isDesktop && !floatingOverlayHidden" #bottom-right>
      <el-tooltip :content="themeButtonTitle" placement="top" :show-after="250">
        <el-button
          :title="themeButtonTitle"
          :aria-label="themeButtonTitle"
          @click="toggleDark"
          circle
        >
          <el-icon><component :is="iconRef" /></el-icon>
        </el-button>
      </el-tooltip>
      <LanguageSwitcher />
      <DocsQuickLink />
    </template>
  </OverLay>
  <FloatingWorkspaceManager
    v-if="isDesktop && !floatingOverlayHidden && !isEmbeddedShell && !isPublicStatus"
  />
  <WaterMark v-if="!isEmbeddedShell && !isPublicStatus" :text="text" />
</template>

<script setup lang="ts">
import { Sunny, Moon } from '@element-plus/icons-vue'

import OverLay from '@/components/layout/OverLay.vue'
import WaterMark from '@/components/layout/WaterMark.vue'
import FloatingWorkspaceManager from '@/components/workspace/FloatingWorkspaceManager.vue'
import { useThemeToggleStore } from '@/stores/themeToggleStore'
import { computed, onMounted } from 'vue'
import TopLoadingProgress from '@/components/layout/TopLoadingProgress.vue'
import { useWaterMarkTextStore } from '@/stores/waterMarkTextStore'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import DocsQuickLink from '@/components/common/DocsQuickLink.vue'
import { authEventBus } from '@/stores/globalInstance'
import { usePageDevice } from '@/composables/usePageDevice'
import { useFloatingOverlayVisibility } from '@/composables/useFloatingOverlayVisibility'
import { i18ns } from '@/locales'
import { useRoute, type RouteLocationNormalizedLoaded } from 'vue-router'
import { onBeforeUnmount } from 'vue'
import { heartbeatService } from '@/service/heartbeatService'

const themeToggleStore = useThemeToggleStore()
const route = useRoute()
const { isDesktop } = usePageDevice()
const { isHidden: floatingOverlayHidden } = useFloatingOverlayVisibility()
const isEmbeddedShell = computed(() => route.query.embed === '1')
const isPublicStatus = computed(() => route.meta.publicStatus === true)
const isDark = themeToggleStore.useIsDark()
const toggleDark = () => themeToggleStore.toggleTheme()

const iconRef = computed(() => (isDark.value ? Sunny : Moon))
const themeButtonTitle = computed(() =>
  isDark.value
    ? i18ns.t('floatingOverlay.switchToLightTheme')
    : i18ns.t('floatingOverlay.switchToDarkTheme'),
)

const waterMarkTextStore = useWaterMarkTextStore()
const text = waterMarkTextStore.useText()

const authRouteNames = new Set(['login', 'register', 'forgotPassword'])

const getShellTransitionName = (route: RouteLocationNormalizedLoaded) => {
  const matchedRecords = route.matched as Array<{ name?: string | symbol | null }>
  const primaryChildName = matchedRecords[1]?.name
  const normalizedName =
    typeof primaryChildName === 'string' ? primaryChildName : String(route.name ?? '')
  return authRouteNames.has(normalizedName) || normalizedName === 'indexDirect'
    ? 'page-fade'
    : undefined
}

const getViewTransitionKey = (route: RouteLocationNormalizedLoaded) => {
  const matchedRecords = route.matched as Array<{ name?: string | symbol | null }>
  const primaryChildName = matchedRecords[1]?.name
  return String(primaryChildName ?? route.name ?? '')
}

onMounted(async () => {
  authEventBus.on('USER_LOGGED_OUT', () => {
    waterMarkTextStore.clearText()
  })
})

onBeforeUnmount(() => {
  heartbeatService.stop()
})
</script>

<style scoped>
.theme-switch {
  --el-switch-on-color: #409eff;
}

:global(.page-fade-enter-active),
:global(.page-fade-leave-active),
:global(.page-fade-appear-active) {
  transition:
    opacity 280ms ease,
    transform 280ms ease;
}

:global(.page-fade-enter-from),
:global(.page-fade-leave-to),
:global(.page-fade-appear-from) {
  opacity: 0;
  transform: translateY(8px);
}

:global(.page-fade-enter-to),
:global(.page-fade-leave-from),
:global(.page-fade-appear-to) {
  opacity: 1;
  transform: translateY(0);
}
</style>
