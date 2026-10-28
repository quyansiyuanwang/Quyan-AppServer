<script setup lang="ts">
import RemoteTerminalUserSelect from './RemoteTerminalUserSelect.vue'
import RemoteTerminalEntitlementSelect from './RemoteTerminalEntitlementSelect.vue'
import RemoteTerminalManagementPagination from './RemoteTerminalManagementPagination.vue'
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { MANAGED_STATUS } from '@/constant/status'
import { useRemoteTerminalProductManagementContext } from '../context'

const state = useRemoteTerminalProductManagementContext()
const t = i18ns.t
const deviceFilter = state.deviceFilter
const deviceStatusOptions = computed(() => state.filterOptions.deviceStatusOptions)
const devices = computed(() => state.devices.value)
const formatDateTime = state.formatDateTime
const canWriteDevice = state.canWriteDevice
const handleRevokeDevice = state.handleRevokeDevice
</script>

<template>
  <div class="toolbar-row">
    <RemoteTerminalUserSelect v-model="deviceFilter.userId" class="toolbar-user-select" />
    <RemoteTerminalEntitlementSelect v-model="deviceFilter.entitlementId" class="toolbar-select" />
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

  <el-table v-loading="state.deviceList.loading.value" :data="devices" border stripe>
    <el-table-column prop="username" :label="t('common.user')" min-width="140" />
    <el-table-column
      prop="hostname"
      :label="t('remoteTerminalProduct.deviceName')"
      min-width="180"
    />
    <el-table-column
      prop="entitlementName"
      :label="t('remoteTerminalProduct.entitlementName')"
      min-width="180"
    />
    <el-table-column
      prop="deviceId"
      :label="t('remoteTerminalProduct.clientDeviceId')"
      min-width="180"
    />
    <el-table-column :label="t('common.status')" width="120">
      <template #default="{ row }">{{
        row.status === MANAGED_STATUS.ENABLED
          ? t('remoteTerminalProduct.active')
          : row.status === MANAGED_STATUS.DISABLED
            ? t('remoteTerminalProduct.disabled')
            : t('remoteTerminalProduct.bindingRevoked')
      }}</template>
    </el-table-column>
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
  <RemoteTerminalManagementPagination section="devices" />
</template>
