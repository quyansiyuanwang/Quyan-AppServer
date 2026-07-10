<script setup lang="ts">
import SystemLogsApiTab from './SystemLogsApiTab.vue'
import SystemLogsServerTab from './SystemLogsServerTab.vue'
import { useSystemLogsContext } from '../context'

const state = useSystemLogsContext()
const i18ns = state.i18ns
const activeTab = state.activeTab
const canViewAnyLogs = state.canViewAnyLogs
const canViewApiLogs = state.canViewApiLogs
const canViewServerLogs = state.canViewServerLogs
</script>

<template>
  <el-tabs v-if="canViewAnyLogs" v-model="activeTab" class="logs-tabs" @tab-change="state.handleTabChange">
    <el-tab-pane v-if="canViewApiLogs" :label="i18ns.t('SystemLogs.apiLogsTab')" name="api">
      <SystemLogsApiTab />
    </el-tab-pane>

    <el-tab-pane v-if="canViewServerLogs" :label="i18ns.t('SystemLogs.serverLogsTab')" name="server">
      <SystemLogsServerTab />
    </el-tab-pane>
  </el-tabs>

  <el-empty v-else :description="i18ns.t('permissionText.noPermissions')" />
</template>
