<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { useRemoteTerminalProductManagementContext } from '../context'

const state = useRemoteTerminalProductManagementContext()
const t = i18ns.t
const userOptions = computed(() => state.userOptions.value)
const entitlements = computed(() => state.entitlements.value)
const userOptionsLoading = state.userOptionsLoading
const deviceFilter = state.deviceFilter
const deviceStatusOptions = computed(() => state.filterOptions.deviceStatusOptions)
const handleUserSearch = state.handleUserSearch
const devices = computed(() => state.devices.value)
const formatDateTime = state.formatDateTime
const canWriteDevice = state.canWriteDevice
const handleRevokeDevice = state.handleRevokeDevice
</script>

<template>
  <div class="toolbar-row">
    <el-select
      v-model="deviceFilter.userId"
      class="toolbar-user-select"
      clearable
      filterable
      remote
      reserve-keyword
      :remote-method="handleUserSearch"
      :loading="userOptionsLoading"
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
      v-model="deviceFilter.entitlementId"
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
      v-model="deviceFilter.status"
      class="toolbar-select"
      clearable
      :placeholder="t('common.status')"
    >
      <el-option
        v-for="option in deviceStatusOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
  </div>

  <el-table :data="devices" border stripe>
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
        {{ formatDateTime(row.lastSeenAt) }}
      </template>
    </el-table-column>
    <el-table-column :label="t('common.actions')" fixed="right" width="140">
      <template #default="{ row }">
        <el-button v-if="canWriteDevice" link type="danger" @click="handleRevokeDevice(row.id)">
          {{ t('remoteTerminalProduct.revokeBinding') }}
        </el-button>
      </template>
    </el-table-column>
  </el-table>
</template>
