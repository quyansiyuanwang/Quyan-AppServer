<template>
  <div class="ram-management desktop-page">
    <el-card class="page-card">
      <template #header>
        <RamManagementHeader :section="section" />
      </template>

      <RamManagementOverview v-if="section === 'overview'" />
      <component v-else :is="sectionComponent" />
    </el-card>

    <RamManagementDialogs />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, provide } from 'vue'
import { useRoute } from 'vue-router'
import router from '@/router'
import RamManagementDialogs from './ram-management/components/RamManagementDialogs.vue'
import RamManagementHeader from './ram-management/components/RamManagementHeader.vue'
import RamManagementOverview from './ram-management/components/RamManagementOverview.vue'
import { ramManagementContextKey } from './ram-management/context'
import { type RamManagementSection, useRamManagement } from './ram-management/useRamManagement'
import './ram-management/ram-management.scss'

const props = withDefaults(defineProps<{ section?: RamManagementSection }>(), {
  section: 'users',
})

const route = useRoute()
const state = useRamManagement(props.section)

const sectionComponents = {
  users: defineAsyncComponent(
    () => import('./ram-management/components/RamManagementUsersTab.vue'),
  ),
  roles: defineAsyncComponent(
    () => import('./ram-management/components/RamManagementRolesTab.vue'),
  ),
  bindings: defineAsyncComponent(
    () => import('./ram-management/components/RamManagementBindingsTab.vue'),
  ),
  policies: defineAsyncComponent(
    () => import('./ram-management/components/RamManagementPoliciesTab.vue'),
  ),
  authorization: defineAsyncComponent(
    () => import('./ram-management/components/RamManagementAuthorizationTab.vue'),
  ),
  sessions: defineAsyncComponent(
    () => import('./ram-management/components/RamManagementSessionsTab.vue'),
  ),
} as const

const sectionComponent = computed(() =>
  props.section === 'overview' ? undefined : sectionComponents[props.section],
)

provide(ramManagementContextKey, state)

const legacyTabRoutes = {
  roles: 'ramRoles',
  bindings: 'ramBindings',
  policies: 'ramPolicies',
  authorization: 'ramAuthorization',
  sessions: 'ramSessions',
} as const

onMounted(() => {
  const legacyTab = String(route.query.tab ?? '') as keyof typeof legacyTabRoutes
  const targetRoute = legacyTabRoutes[legacyTab]
  if (props.section !== 'users' || !targetRoute) return

  const { tab: _tab, ...query } = route.query
  void router.replace({ name: targetRoute, query, hash: route.hash } as any)
})
</script>
