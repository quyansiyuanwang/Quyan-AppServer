<template>
  <el-menu-item
    v-if="overviewRoute && router.hasRoute(overviewRoute)"
    :index="overviewRoute"
    @click="nav(overviewRoute, $event)"
    @contextmenu.prevent="openRouteMenu(overviewRoute, $event)"
  >
    <el-icon><HomeFilled /></el-icon>
    <template #title>{{ i18ns.t('nav.overviewTitle') }}</template>
  </el-menu-item>

  <template v-for="node in homeMenuNodes" :key="node.id">
    <el-menu-item
      :index="node.route!"
      @click="nav(node.route!, $event)"
      @contextmenu.prevent="openRouteMenu(node.route!, $event)"
    >
      <el-icon><component :is="node.icon" /></el-icon>
      <template #title>{{ i18ns.t(node.labelKey as any) }}</template>
    </el-menu-item>
  </template>

  <template v-if="showPinnedSection && hasPinnedSlot">
    <li v-if="homeMenuNodes.length" class="menu-divider" />
    <slot name="pinned" />
    <li v-if="navigationMenuNodes.length" class="menu-divider" />
  </template>

  <template v-for="(node, index) in navigationMenuNodes" :key="node.id">
    <li v-if="node.dividerBefore && index > 0" class="menu-divider" />
    <el-sub-menu v-if="node.children?.length" :index="node.id">
      <template #title>
        <el-icon><component :is="node.icon" /></el-icon>
        <span>{{ i18ns.t(node.labelKey as any) }}</span>
      </template>
      <template v-for="child in node.children" :key="child.id">
        <el-sub-menu v-if="child.children?.length" :index="child.id">
          <template #title>
            <el-icon><component :is="child.icon" /></el-icon>
            <span>{{ i18ns.t(child.labelKey as any) }}</span>
          </template>
          <el-menu-item
            v-for="entry in child.children"
            :key="entry.id"
            :index="entry.route!"
            @click="nav(entry.route!, $event)"
            @contextmenu.prevent="openRouteMenu(entry.route!, $event)"
          >
            <el-icon><component :is="entry.icon" /></el-icon>
            <template #title>{{ i18ns.t(entry.labelKey as any) }}</template>
          </el-menu-item>
        </el-sub-menu>
        <el-menu-item
          v-else
          :index="child.route!"
          @click="nav(child.route!, $event)"
          @contextmenu.prevent="openRouteMenu(child.route!, $event)"
        >
          <el-icon><component :is="child.icon" /></el-icon>
          <template #title>{{ i18ns.t(child.labelKey as any) }}</template>
        </el-menu-item>
      </template>
    </el-sub-menu>
    <el-menu-item
      v-else
      :index="node.route!"
      @click="nav(node.route!, $event)"
      @contextmenu.prevent="openRouteMenu(node.route!, $event)"
    >
      <el-icon><component :is="node.icon" /></el-icon>
      <template #title>{{ i18ns.t(node.labelKey as any) }}</template>
    </el-menu-item>
  </template>

  <li v-if="visibleMenuNodes.length && hasTrailingNavigation" class="menu-divider" />
  <div v-if="showSpacer" class="menu-spacer" />

  <el-menu-item
    v-if="isDebugVisible"
    index="debug"
    class="item-muted"
    @click="nav('debug', $event)"
    @contextmenu.prevent="openRouteMenu('debug', $event)"
  >
    <el-icon><Operation /></el-icon>
    <template #title>{{ i18ns.t('nav.debug') }}</template>
  </el-menu-item>

  <slot name="before-logout" />

  <el-menu-item v-if="showLogout" index="logout" class="item-logout" @click="logout">
    <el-icon><LogoutIcon :size="16" /></el-icon>
    <template #title>{{ i18ns.t('logout') }}</template>
  </el-menu-item>
</template>

<script lang="ts" setup>
import { HomeFilled, Operation } from '@element-plus/icons-vue'
import { computed, useSlots } from 'vue'
import { i18ns } from '@/locales'
import LogoutIcon from '@/components/icons/LogoutIcon.vue'
import router from '@/router'
import { currentSiteProfile } from '@/router'
import { authorizationService } from '@/service/authorizationService'
import { usePermissionStore } from '@/stores/permissionStore'
import {
  debugNavigationNode,
  filterNavigationNodes,
  navigationMenuDefinition,
  overviewRouteByProfile,
} from '@/config/navigation-catalog'
import type { RouteName } from '@/types/route-types.gen'

const props = withDefaults(
  defineProps<{
    showSpacer?: boolean
    showLogout?: boolean
    showPinnedSection?: boolean
    onRouteNavigate?: (name: RouteName, event?: MouseEvent) => void
    onRouteContextMenu?: (name: RouteName, event: MouseEvent) => void
  }>(),
  { showSpacer: false, showLogout: false, showPinnedSection: false },
)

const permissionStore = usePermissionStore()
const slots = useSlots()
const hasPinnedSlot = computed(() => Boolean(slots.pinned))
const overviewRoute = computed(() =>
  currentSiteProfile.id === 'rejected' ? undefined : overviewRouteByProfile[currentSiteProfile.id],
)
const visibleMenuNodes = computed(() =>
  filterNavigationNodes(navigationMenuDefinition, permissionStore.effectivePermissions, (route) =>
    router.hasRoute(route),
  ),
)
const homeMenuNodes = computed(() => visibleMenuNodes.value.filter((node) => node.route === 'home'))
const navigationMenuNodes = computed(() =>
  visibleMenuNodes.value.filter((node) => node.route !== 'home'),
)
const isDebugVisible = computed(
  () =>
    router.hasRoute('debug') &&
    filterNavigationNodes([debugNavigationNode], permissionStore.effectivePermissions, (route) =>
      router.hasRoute(route),
    ).length > 0,
)
const hasTrailingNavigation = computed(() => props.showLogout || isDebugVisible.value)

const nav = (name: RouteName, event?: MouseEvent) => {
  props.onRouteNavigate?.(name, event)
  if (!props.onRouteNavigate) router.push({ name } as any)
}

const openRouteMenu = (name: RouteName, event: MouseEvent) =>
  props.onRouteContextMenu?.(name, event)
const logout = () => authorizationService.logout()
</script>

<style scoped>
.menu-divider {
  height: 1px;
  margin: 4px 12px;
  background: var(--el-border-color-lighter);
  list-style: none;
  flex-shrink: 0;
}
.menu-spacer {
  flex: 1;
  min-height: 12px;
}
.item-muted {
  opacity: 0.55;
  font-size: 12px;
}
.item-muted:hover {
  opacity: 0.8;
}
.item-logout {
  color: var(--el-color-danger) !important;
}
.item-logout :deep(.el-icon) {
  color: var(--el-color-danger) !important;
}
.item-logout:hover {
  background: var(--el-color-danger-light-9) !important;
}
</style>
