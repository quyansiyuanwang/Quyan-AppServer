<template>
  <el-tab-pane :label="i18ns.t('remoteTerminalProduct.myDevices')">
    <el-empty
      v-if="!loading && devices.length === 0"
      :description="i18ns.t('remoteTerminalProduct.emptyDevices')"
    />
    <el-table v-else :data="devices" v-loading="loading" stripe>
      <el-table-column
        prop="hostname"
        :label="i18ns.t('remoteTerminalProduct.hostname')"
        min-width="160"
      />
      <el-table-column
        prop="deviceId"
        :label="i18ns.t('remoteTerminal.deviceId')"
        min-width="160"
      />
      <el-table-column
        prop="entitlementName"
        :label="i18ns.t('remoteTerminalProduct.entitlementsTab')"
        min-width="160"
      />
      <el-table-column :label="i18ns.t('remoteTerminalProduct.platform')" width="120">
        <template #default="{ row }">{{ row.platform }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('remoteTerminalProduct.lastSeenAt')" min-width="160">
        <template #default="{ row }">{{ formatDateTime(row.lastSeenAt) }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('actions')" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="goConsole()">
            {{ i18ns.t('remoteTerminalProduct.connectDevice') }}
          </el-button>
          <el-button
            link
            type="danger"
            :loading="revokingDeviceId === row.id"
            @click="handleRevokeMyDevice(row.id)"
          >
            {{ i18ns.t('remoteTerminalProduct.revokeDevice') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-tab-pane>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useMyRemoteTerminalProductsContext } from '../context'

const { devices, formatDateTime, goConsole, handleRevokeMyDevice, loading, revokingDeviceId } =
  useMyRemoteTerminalProductsContext()
</script>
