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
</template>

<script setup lang="ts">
import { ArrowRight, ChatDotRound, Document } from '@element-plus/icons-vue'
import type { Component } from 'vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { normalizeDocsLocale, resolveDocsUrl } from '@/config/docs'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'
import router, { currentSiteProfile } from '@/router'
import { resolveCanonicalRouteUrl } from '@/router/routes'
import { usePermissionStore } from '@/stores/permissionStore'
import type { RouteName } from '@/types/route-types.gen'

type UtilityAction = {
  key: string
  labelKey: string
  icon: Component
  open: () => void
}

defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ 'update:collapsed': [collapsed: boolean] }>()
const route = useRoute()
const permissionStore = usePermissionStore()

const canUseTickets = computed(() =>
  permissionStore.hasAnyPermission(
    Permission.TICKET_SUBMIT,
    Permission.TICKET_SELF_READ,
    Permission.TICKET_SELF_UPDATE,
    Permission.TICKET_COMMENT,
  ),
)

const navigateToRoute = (routeName: RouteName) => {
  if (currentSiteProfile.id !== 'rejected') {
    const targetUrl = resolveCanonicalRouteUrl(routeName, currentSiteProfile)
    if (targetUrl && new URL(targetUrl).origin !== window.location.origin) {
      window.location.assign(targetUrl)
      return
    }
  }

  void router.push({ name: routeName } as any)
}

const openDocs = () => {
  const routeName = typeof route.name === 'string' ? route.name : undefined
  window.open(
    resolveDocsUrl(routeName, normalizeDocsLocale(i18ns.refer.value)),
    '_blank',
    'noopener,noreferrer',
  )
}

const visibleActions = computed<UtilityAction[]>(() => {
  const actions: UtilityAction[] = []

  if (canUseTickets.value) {
    actions.push({
      key: 'tickets',
      labelKey: 'nav.myTickets',
      icon: ChatDotRound,
      open: () => navigateToRoute('myTickets'),
    })
  }

  actions.push({ key: 'docs', labelKey: 'nav.docs', icon: Document, open: openDocs })
  return actions
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
</style>
