<script setup lang="ts">
import { provide } from 'vue'
import SystemLogsTabs from './system-logs/components/SystemLogsTabs.vue'
import { systemLogsContextKey } from './system-logs/context'
import { useSystemLogs } from './system-logs/useSystemLogs'
import './system-logs/system-logs.scss'

const state = useSystemLogs()

provide(systemLogsContextKey, state)
</script>

<template>
  <div :class="['system-logs-page', { 'system-logs-mobile-adapter': !state.isDesktop.value }]">
    <div class="system-logs-container">
      <el-card class="logs-card page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ state.i18ns.t('SystemLogs.title') }}</span>
            <el-button
              type="primary"
              :icon="state.Refresh"
              :loading="state.activeLoading"
              @click="state.handleRefresh"
            >
              {{ state.i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <SystemLogsTabs />
      </el-card>
    </div>
  </div>
</template>
