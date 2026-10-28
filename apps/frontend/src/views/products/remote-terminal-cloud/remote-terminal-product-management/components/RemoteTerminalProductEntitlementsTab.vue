<script setup lang="ts">
import RemoteTerminalUserSelect from './RemoteTerminalUserSelect.vue'
import RemoteTerminalManagementPagination from './RemoteTerminalManagementPagination.vue'
import RemoteTerminalTemplateSelect from './RemoteTerminalTemplateSelect.vue'
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { useRemoteTerminalProductManagementContext } from '../context'

const state = useRemoteTerminalProductManagementContext()
const t = i18ns.t
const entitlementFilter = state.entitlementFilter
const assignmentStatusOptions = computed(() => state.filterOptions.assignmentStatusOptions)
const canWriteAssignment = state.canWriteAssignment
const canWriteToken = state.canWriteToken
const openAssignEntitlementDialog = state.openAssignEntitlementDialog
const entitlements = computed(() => state.entitlements.value)
const formatDateTime = state.formatDateTime
const openEditEntitlementDialog = state.openEditEntitlementDialog
const hasDeviceQuota = state.hasDeviceQuota
const openRotateTokenDialog = state.openRotateTokenDialog
const openLimitAdjustDialog = state.openLimitAdjustDialog
const handleDeleteEntitlement = state.handleDeleteEntitlement
</script>

<template>
  <div class="toolbar-row">
    <RemoteTerminalUserSelect v-model="entitlementFilter.userId" class="toolbar-user-select" />
    <RemoteTerminalTemplateSelect v-model="entitlementFilter.templateId" class="toolbar-select" />
    <el-select
      v-model="entitlementFilter.status"
      class="toolbar-select"
      clearable
      :placeholder="t('common.status')"
    >
      <el-option
        v-for="option in assignmentStatusOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
    <div style="flex: 1" />
    <el-button v-if="canWriteAssignment" type="primary" @click="openAssignEntitlementDialog">
      {{ t('remoteTerminalProduct.assignEntitlement') }}
    </el-button>
  </div>

  <el-table v-loading="state.entitlementList.loading.value" :data="entitlements" border stripe>
    <el-table-column prop="username" :label="t('common.user')" min-width="150" />
    <el-table-column
      prop="name"
      :label="t('remoteTerminalProduct.entitlementName')"
      min-width="180"
    />
    <el-table-column
      prop="templateName"
      :label="t('remoteTerminalProduct.templateName')"
      min-width="160"
    />
    <el-table-column :label="t('remoteTerminalProduct.quota')" min-width="220">
      <template #default="{ row }">
        <div class="entitlement-mix">
          <span>{{ t('remoteTerminalProduct.deviceQuota') }}: {{ row.deviceLimit }}</span>
          <span>{{ t('remoteTerminalProduct.terminalQuota') }}: {{ row.terminalLimit }}</span>
        </div>
      </template>
    </el-table-column>
    <el-table-column :label="t('remoteTerminalProduct.registrationToken')" min-width="220">
      <template #default="{ row }">
        <div v-if="row.registrationToken" class="token-stack">
          <span>{{ row.registrationToken.label || '-' }}</span>
          <span class="secondary-text">{{ formatDateTime(row.registrationToken.expiresAt) }}</span>
        </div>
        <span v-else class="secondary-text">-</span>
      </template>
    </el-table-column>
    <el-table-column :label="t('remoteTerminalProduct.validity')" min-width="220">
      <template #default="{ row }">
        <div>{{ formatDateTime(row.startAt) }}</div>
        <div>{{ formatDateTime(row.endAt) }}</div>
      </template>
    </el-table-column>
    <el-table-column :label="t('common.status')" width="120">
      <template #default="{ row }">
        <el-tag :type="row.status === 1 ? 'success' : 'info'">
          {{ row.statusLabel || row.status }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column :label="t('common.actions')" fixed="right" width="300">
      <template #default="{ row }">
        <div class="token-actions">
          <el-button link type="primary" @click="openEditEntitlementDialog(row)">
            {{ t('common.edit') }}
          </el-button>
          <el-button
            v-if="canWriteToken && hasDeviceQuota(row.deviceLimit)"
            link
            type="warning"
            @click="openRotateTokenDialog(row)"
          >
            {{ t('remoteTerminalProduct.rotateToken') }}
          </el-button>
          <el-button
            v-if="canWriteAssignment"
            link
            type="success"
            @click="openLimitAdjustDialog(row)"
          >
            {{ t('remoteTerminalProduct.adjustQuota') }}
          </el-button>
          <el-button
            v-if="canWriteAssignment"
            link
            type="danger"
            @click="handleDeleteEntitlement(row.id)"
          >
            {{ t('common.delete') }}
          </el-button>
        </div>
      </template>
    </el-table-column>
  </el-table>
  <RemoteTerminalManagementPagination section="entitlements" />
</template>
