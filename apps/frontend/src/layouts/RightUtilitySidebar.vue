<template>
  <aside class="utility-sidebar">
    <div class="utility-sidebar__actions">
      <el-tooltip
        v-for="action in visibleActions"
        :key="action.key"
        :content="i18ns.t(action.labelKey as any)"
        placement="left"
        :show-after="250"
      >
        <button
          type="button"
          class="utility-sidebar__action"
          :aria-label="i18ns.t(action.labelKey as any)"
          @click="action.open"
        >
          <el-icon><component :is="action.icon" /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip
        :content="i18ns.t('nav.collapseUtilitySidebar')"
        placement="left"
        :show-after="250"
      >
        <button
          type="button"
          class="utility-sidebar__action utility-sidebar__toggle"
          :aria-label="i18ns.t('nav.collapseUtilitySidebar')"
          @click="emit('update:collapsed', true)"
        >
          <el-icon><ArrowRight /></el-icon>
        </button>
      </el-tooltip>
    </div>
  </aside>

  <el-dialog
    v-model="showPreferences"
    :title="i18ns.t('nav.preferences')"
    width="min(360px, calc(100vw - 40px))"
    append-to-body
    class="utility-preferences-dialog"
  >
    <section class="utility-preferences">
      <div class="utility-preferences__row">
        <div>
          <strong>{{ i18ns.t('SettingsView.themeLabel') }}</strong>
          <small>{{ themeButtonTitle }}</small>
        </div>
        <el-tooltip :content="themeButtonTitle" placement="top">
          <el-button circle :aria-label="themeButtonTitle" @click="toggleTheme">
            <el-icon><component :is="themeIcon" /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
      <div class="utility-preferences__row">
        <div>
          <strong>{{ i18ns.t('localeName.zhCN') }} / {{ i18ns.t('localeName.en') }}</strong>
          <small>{{ i18ns.t('SettingsView.themeLanguageTitle') }}</small>
        </div>
        <LanguageSwitcher />
      </div>
      <div class="utility-preferences__row">
        <div>
          <strong>{{ i18ns.t('SettingsView.siteOpenInNewTab') }}</strong>
          <small>{{ i18ns.t('SettingsView.siteOpenInNewTabDesc') }}</small>
        </div>
        <el-switch
          :model-value="siteOpenInNewTab"
          :aria-label="i18ns.t('SettingsView.siteOpenInNewTab')"
          @update:model-value="siteNavigationStore.setOpenInNewTab"
        />
      </div>
    </section>
    <template #footer>
      <el-button @click="showPreferences = false">{{ i18ns.t('close') }}</el-button>
      <el-button type="primary" @click="openFullPreferences">
        {{ i18ns.t('nav.preferences') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import {
  ArrowRight,
  Document,
  Moon,
  QuestionFilled,
  Setting,
  Sunny,
  Top,
} from '@element-plus/icons-vue'
import type { Component } from 'vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute } from 'vue-router'
import { i18ns } from '@/locales'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import { currentSiteProfile } from '@/router'
import router from '@/router'
import { resolveCanonicalRouteUrl } from '@/router/routes'
import { assignDocument } from '@/service/navigationService'
import { useThemeToggleStore } from '@/stores/themeToggleStore'
import { useFloatingWorkspaceStore } from '@/stores/floatingWorkspaceStore'
import { useSiteNavigationStore } from '@/stores/siteNavigationStore'

type UtilityAction = {
  key: string
  labelKey: string
  icon: Component
  open: () => void
}

type ScrollContainer = HTMLElement | { $el?: Element | null }

const props = withDefaults(
  defineProps<{
    collapsed?: boolean
    scrollContainer?: ScrollContainer | null
  }>(),
  { collapsed: false, scrollContainer: null },
)
const emit = defineEmits<{ 'update:collapsed': [collapsed: boolean] }>()
const route = useRoute()
const themeToggleStore = useThemeToggleStore()
const floatingWorkspaceStore = useFloatingWorkspaceStore()
const siteNavigationStore = useSiteNavigationStore()
const isDark = themeToggleStore.useIsDark()
const showPreferences = ref(false)
const siteOpenInNewTab = computed(() => siteNavigationStore.openInNewTab)

const themeIcon = computed(() => (isDark.value ? Sunny : Moon))
const themeButtonTitle = computed(() =>
  isDark.value
    ? i18ns.t('floatingOverlay.switchToLightTheme')
    : i18ns.t('floatingOverlay.switchToDarkTheme'),
)
const toggleTheme = () => themeToggleStore.toggleTheme()
const openDocs = () => {
  const routeName = typeof route.name === 'string' ? route.name : undefined
  floatingWorkspaceStore.openDocs(routeName)
}
const openSupport = () => floatingWorkspaceStore.openSupport()
const openPreferences = () => (showPreferences.value = true)

let scrollAnimationFrame: number | undefined

const resolveScrollContainer = (): HTMLElement | null => {
  const candidate = props.scrollContainer
  if (candidate instanceof HTMLElement) return candidate
  if (candidate?.$el instanceof HTMLElement) return candidate.$el

  return document.querySelector<HTMLElement>('.common-layout .main')
}

const animateScrollToTop = (container: HTMLElement) => {
  const initialScrollTop = container.scrollTop
  if (initialScrollTop <= 0) return

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion || typeof window.requestAnimationFrame !== 'function') {
    container.scrollTop = 0
    return
  }

  if (scrollAnimationFrame !== undefined) {
    window.cancelAnimationFrame(scrollAnimationFrame)
  }

  const duration = Math.min(460, Math.max(220, initialScrollTop * 0.18))
  let startTime: number | undefined
  const step = (timestamp: number) => {
    startTime ??= timestamp
    const progress = Math.min((timestamp - startTime) / duration, 1)
    const easedProgress = 1 - Math.pow(1 - progress, 3)
    container.scrollTop = Math.round(initialScrollTop * (1 - easedProgress))

    if (progress < 1) {
      scrollAnimationFrame = window.requestAnimationFrame(step)
      return
    }

    scrollAnimationFrame = undefined
  }

  scrollAnimationFrame = window.requestAnimationFrame(step)
}

const scrollToTop = () => {
  const container = resolveScrollContainer()
  if (container) {
    animateScrollToTop(container)
    return
  }

  if (document.scrollingElement instanceof HTMLElement) {
    animateScrollToTop(document.scrollingElement)
  }
}

const openFullPreferences = () => {
  showPreferences.value = false
  if (router.hasRoute('settingsPreferences')) {
    void router.push({ name: 'settingsPreferences' })
    return
  }

  if (currentSiteProfile.id === 'rejected') return
  const targetUrl = resolveCanonicalRouteUrl('settingsPreferences', currentSiteProfile)
  if (targetUrl) assignDocument(targetUrl)
}

const visibleActions = computed<UtilityAction[]>(() => [
  { key: 'docs', labelKey: 'nav.docs', icon: Document, open: openDocs },
  { key: 'help', labelKey: 'nav.helpCenter', icon: QuestionFilled, open: openSupport },
  { key: 'preferences', labelKey: 'nav.preferences', icon: Setting, open: openPreferences },
  { key: 'top', labelKey: 'nav.backToTop', icon: Top, open: scrollToTop },
])

onBeforeUnmount(() => {
  if (scrollAnimationFrame !== undefined) {
    window.cancelAnimationFrame(scrollAnimationFrame)
  }
})
</script>

<style scoped>
.utility-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--el-bg-color);
}

.utility-sidebar__actions {
  display: grid;
  gap: 4px;
  margin-top: auto;
  padding: 12px 0 calc(12px + env(safe-area-inset-bottom));
}

.utility-sidebar__action {
  display: inline-grid;
  place-items: center;
  width: 48px;
  height: 40px;
  padding: 0;
  color: var(--el-text-color-secondary);
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.utility-sidebar__action:hover,
.utility-sidebar__action:focus-visible {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  outline: none;
}

.utility-preferences {
  display: grid;
  gap: 12px;
}

.utility-preferences__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.utility-preferences__row > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.utility-preferences__row strong {
  font-size: 14px;
}

.utility-preferences__row small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
