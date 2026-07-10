<script setup lang="ts">
import { computed } from 'vue'
import { useRemoteTerminalProductManagementContext } from '../context'

const state = useRemoteTerminalProductManagementContext()
const userOptions = computed(() => state.userOptions.value)
</script>

<template>
  <div class="toolbar-row">
    <el-select
      v-model="state.entitlementFilter.userId"
      class="toolbar-user-select"
      clearable
      filterable
      remote
      reserve-keyword
      :remote-method="state.handleUserSearch"
      :loading="state.userOptionsLoading"
      :placeholder="$t('remoteTerminalProduct.selectUser')"
    >
      <el-option
        v-for="user in userOptions"
        :key="user.id"
        :label="user.username"
        :value="user.id"
      />
    </el-select>
    <el-select
      v-model="state.entitlementFilter.templateId"
      class="toolbar-select"
      clearable
      :placeholder="$t('remoteTerminalProduct.selectTemplate')"
    >
      <el-option
        v-for="template in state.filterOptions.templates"
        :key="template.id"
        :label="template.name"
        :value="template.id"
      />
    </el-select>
    <el-select
      v-model="state.entitlementFilter.status"
      class="toolbar-select"
      clearable
      :placeholder="$t('common.status')"
    >
      <el-option
        v-for="option in state.filterOptions.assignmentStatusOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
    <div style="flex: 1" />
    <el-button v-if="state.canWriteAssignment" type="primary" @click="state.openAssignEntitlementDialog">
      {{ $t('remoteTerminalProduct.assignEntitlement') }}
    </el-button>
  </div>

  <el-table :data="state.entitlements" border stripe>
    <el-table-column prop="username" :label="$t('common.user')" min-width="150" />
    <el-table-column prop="name" :label="$t('remoteTerminalProduct.entitlementName')" min-width="180" />
    <el-table-column prop="templateName" :label="$t('remoteTerminalProduct.templateName')" min-width="160" />
    <el-table-column :label="$t('remoteTerminalProduct.quota')" min-width="220">
      <template #default="{ row }">
        <div class="entitlement-mix">
          <span>{{ $t('remoteTerminalProduct.deviceQuota') }}: {{ row.deviceLimit }}</span>
          <span>{{ $t('remoteTerminalProduct.terminalQuota') }}: {{ row.terminalLimit }}</span>
        </div>
      </template>
    </el-table-column>
    <el-table-column :label="$t('remoteTerminalProduct.registrationToken')" min-width="220">
      <template #default="{ row }">
        <div v-if="row.registrationToken" class="token-stack">
          <span>{{ row.registrationToken.label || '-' }}</span>
          <span class="secondary-text">{{ state.formatDateTime(row.registrationToken.expiresAt) }}</span>
        </div>
        <span v-else class="secondary-text">-</span>
      </template>
    </el-table-column>
    <el-table-column :label="$t('remoteTerminalProduct.validity')" min-width="220">
      <template #default="{ row }">
        <div>{{ state.formatDateTime(row.startAt) }}</div>
        <div>{{ state.formatDateTime(row.endAt) }}</div>
      </template>
    </el-table-column>
    <el-table-column :label="$t('common.status')" width="120">
      <template #default="{ row }">
        <el-tag :type="row.status === 1 ? 'success' : 'info'">
          {{ row.statusLabel || row.status }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column :label="$t('common.actions')" fixed="right" width="300">
      <template #default="{ row }">
        <div class="token-actions">
          <el-button link type="primary" @click="state.openEditEntitlementDialog(row)">
            {{ $t('common.edit') }}
          </el-button>
          <el-button
            v-if="state.canWriteToken && state.hasDeviceQuota(row.deviceLimit)"
            link
            type="warning"
            @click="state.openRotateTokenDialog(row)"
          >
            {{ $t('remoteTerminalProduct.rotateToken') }}
          </el-button>
          <el-button
            v-if="state.canWriteAssignment"
            link
            type="success"
            @click="state.openLimitAdjustDialog(row)"
          >
            {{ $t('remoteTerminalProduct.adjustQuota') }}
          </el-button>
          <el-button
            v-if="state.canWriteAssignment"
            link
            type="danger"
            @click="state.handleDeleteEntitlement(row.id)"
          >
            {{ $t('common.delete') }}
          </el-button>
        </div>
      </template>
    </el-table-column>
  </el-table>
</template>
