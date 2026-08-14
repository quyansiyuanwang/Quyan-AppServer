<template>
  <div class="ram-overview">
    <section v-for="group in visibleGroups" :key="group.key" class="ram-overview__group">
      <h2>{{ i18ns.t(group.titleKey as I18nENAvailableKeys) }}</h2>
      <div class="ram-overview__grid">
        <button
          v-for="entry in group.entries"
          :key="entry.route"
          type="button"
          class="ram-overview__entry"
          @click="router.push({ name: entry.route } as any)"
        >
          <el-icon><component :is="entry.icon" /></el-icon>
          <span>
            <strong>{{ i18ns.t(entry.labelKey as I18nENAvailableKeys) }}</strong>
            <small>{{ i18ns.t(entry.descriptionKey as I18nENAvailableKeys) }}</small>
          </span>
          <el-icon><ArrowRight /></el-icon>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowRight,
  DataAnalysis,
  Document,
  Key,
  Monitor,
  User,
  UserFilled,
} from '@element-plus/icons-vue'
import type { Component } from 'vue'
import { computed } from 'vue'
import { Permission } from '@/constant/permission'
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import router from '@/router'
import { usePermissionStore } from '@/stores/permissionStore'
import type { RouteName } from '@/types/route-types.gen'

type RamEntry = {
  route: RouteName
  labelKey: I18nENAvailableKeys
  descriptionKey: I18nENAvailableKeys
  icon: Component
  permission: Permission
}

const permissionStore = usePermissionStore()

const groups: readonly {
  key: string
  titleKey: I18nENAvailableKeys
  entries: readonly RamEntry[]
}[] = [
  {
    key: 'identity',
    titleKey: 'nav.iamIdentityManagement',
    entries: [
      {
        route: 'ramManagement',
        labelKey: 'RamManagement.users',
        descriptionKey: 'RamManagement.usersDescription',
        icon: User,
        permission: Permission.RAM_USER_READ,
      },
      {
        route: 'ramRoles',
        labelKey: 'RamManagement.roles',
        descriptionKey: 'RamManagement.rolesDescription',
        icon: UserFilled,
        permission: Permission.RAM_ROLE_READ,
      },
    ],
  },
  {
    key: 'permissions',
    titleKey: 'nav.iamPermissionManagement',
    entries: [
      {
        route: 'ramBindings',
        labelKey: 'RamManagement.bindings',
        descriptionKey: 'RamManagement.bindingsDescription',
        icon: Key,
        permission: Permission.RAM_BINDING_READ,
      },
      {
        route: 'ramPolicies',
        labelKey: 'RamManagement.policies',
        descriptionKey: 'RamManagement.policiesDescription',
        icon: Document,
        permission: Permission.RAM_POLICY_READ,
      },
      {
        route: 'ramAuthorization',
        labelKey: 'RamManagement.authorization',
        descriptionKey: 'RamManagement.authorizationDescription',
        icon: DataAnalysis,
        permission: Permission.RAM_USER_READ,
      },
    ],
  },
  {
    key: 'sessions',
    titleKey: 'RamManagement.sessions',
    entries: [
      {
        route: 'ramSessions',
        labelKey: 'RamManagement.sessions',
        descriptionKey: 'RamManagement.sessionsDescription',
        icon: Monitor,
        permission: Permission.RAM_SESSION_READ,
      },
    ],
  },
]

const visibleGroups = computed(() =>
  groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => permissionStore.hasPermission(entry.permission)),
    }))
    .filter((group) => group.entries.length > 0),
)
</script>
