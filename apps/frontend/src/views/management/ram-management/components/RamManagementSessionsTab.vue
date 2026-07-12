<template>
  <el-tab-pane :label="i18ns.t('RamManagement.sessions')" name="sessions">
    <div v-if="canReadSessions" class="section-toolbar">
      <el-button :icon="Refresh" @click="loadSessions">{{ i18ns.t('refresh') }}</el-button>
    </div>

    <el-table v-if="canReadSessions" v-loading="loading.sessions" :data="sessions" border stripe>
      <el-table-column
        prop="sessionName"
        :label="i18ns.t('RamManagement.sessionName')"
        min-width="170"
      />
      <el-table-column prop="roleName" :label="i18ns.t('RamManagement.roleName')" min-width="150" />
      <el-table-column
        prop="subjectUserId"
        :label="i18ns.t('RamManagement.subjectUserId')"
        min-width="220"
        show-overflow-tooltip
      />
      <el-table-column :label="i18ns.t('RamManagement.expiresAt')" min-width="200">
        <template #default="{ row }">
          <el-tooltip :content="formatDate(row.expiresAt)" placement="top">
            <span>{{ formatRelativeTime(row.expiresAt) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('actions')" fixed="right" width="120">
        <template #default="{ row }">
          <el-button v-if="canRevokeSessions" link type="danger" @click="revokeSession(row)">
            {{ i18ns.t('RamManagement.revoke') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-else :description="i18ns.t('message.error.forbidden')" />
  </el-tab-pane>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  Refresh,
  canReadSessions,
  canRevokeSessions,
  formatDate,
  formatRelativeTime,
  loadSessions,
  loading,
  revokeSession,
  sessions,
} = useRamManagementContext()
</script>
