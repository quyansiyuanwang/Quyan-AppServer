<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { useRemoteTerminalProductManagementContext } from '../context'
import RemoteTerminalProductTemplatesTab from './RemoteTerminalProductTemplatesTab.vue'
import RemoteTerminalProductEntitlementsTab from './RemoteTerminalProductEntitlementsTab.vue'
import RemoteTerminalProductDevicesTab from './RemoteTerminalProductDevicesTab.vue'

const state = useRemoteTerminalProductManagementContext()
const t = i18ns.t
const canView = state.canView
const activeTab = state.activeTab
const visibleTabs = computed(() => state.visibleTabs.value)
</script>

<template>
  <el-empty v-if="!canView" class="permission-empty" :description="t('common.noPermission')" />

  <el-tabs v-else v-model="activeTab">
    <el-tab-pane
      v-if="visibleTabs.includes('templates')"
      name="templates"
      :label="t('remoteTerminalProduct.templateManagement')"
    >
      <RemoteTerminalProductTemplatesTab />
    </el-tab-pane>
    <el-tab-pane
      v-if="visibleTabs.includes('entitlements')"
      name="entitlements"
      :label="t('remoteTerminalProduct.entitlementManagement')"
    >
      <RemoteTerminalProductEntitlementsTab />
    </el-tab-pane>
    <el-tab-pane
      v-if="visibleTabs.includes('devices')"
      name="devices"
      :label="t('remoteTerminalProduct.deviceManagement')"
    >
      <RemoteTerminalProductDevicesTab />
    </el-tab-pane>
  </el-tabs>
</template>
