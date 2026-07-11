<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { useRemoteTerminalProductManagementContext } from '../context'

const state = useRemoteTerminalProductManagementContext()
const t = i18ns.t as (key: string, params?: Record<string, unknown>) => string
const userOptions = computed(() => state.userOptions.value)
const entitlements = computed(() => state.entitlements.value)
</script>

<template>
  <div class="toolbar-row">
    <el-select
      v-model="state.deviceFilter.userId"
      class="toolbar-user-select"
      clearable
      filterable
      remote
      reserve-keyword
      :remote-method="state.handleUserSearch"
      :loading="state.userOptionsLoading"
      :placeholder="t('remoteTerminalProduct.selectUser')"
    >
      <el-option
        v-for="user in userOptions"
        :key="user.id"
        :label="user.username"
        :value="user.id"
      />
    </el-select>
    <el-select
      v-model="state.deviceFilter.entitlementId"
      class="toolbar-select"
      clearable
      :placeholder="t('remoteTerminalProduct.selectEntitlement')"
    >
      <el-option
        v-for="entitlement in entitlements"
        :key="entitlement.id"
        :label="entitlement.name || entitlement.id"
        :value="entitlement.id"
      />
    </el-select>
    <el-select
      v-model="state.deviceFilter.status"
      class="toolbar-select"
      clearable
      :placeholder="t('common.status')"
    >
      <el-option
        v-for="option in state.filterOptions.deviceStatusOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
  </div>

  <el-table :data="state.devices" border stripe>
    <el-table-column prop="username" :label="t('common.user')" min-width="140" />
    <el-table-column
      prop="deviceName"
      :label="t('remoteTerminalProduct.deviceName')"
      min-width="180"
    />
    <el-table-column
      prop="entitlementName"
      :label="t('remoteTerminalProduct.entitlementName')"
      min-width="180"
    />
    <el-table-column
      prop="clientDeviceId"
      :label="t('remoteTerminalProduct.clientDeviceId')"
      min-width="180"
    />
    <el-table-column prop="bindingStatusLabel" :label="t('common.status')" width="120" />
    <el-table-column :label="t('remoteTerminalProduct.lastSeenAt')" min-width="180">
      <template #default="{ row }">
        {{ state.formatDateTime(row.lastSeenAt) }}
      </template>
    </el-table-column>
    <el-table-column :label="t('common.actions')" fixed="right" width="140">
      <template #default="{ row }">
        <el-button
          v-if="state.canWriteDevice"
          link
          type="danger"
          @click="state.handleRevokeDevice(row.id)"
        >
          {{ t('remoteTerminalProduct.revokeBinding') }}
        </el-button>
      </template>
    </el-table-column>
  </el-table>
</template>
