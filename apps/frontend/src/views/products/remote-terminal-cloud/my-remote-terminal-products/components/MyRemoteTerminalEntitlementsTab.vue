<template>
  <el-tab-pane :label="i18ns.t('remoteTerminalProduct.myEntitlements')">
    <el-empty
      v-if="!loading && entitlements.length === 0"
      :description="i18ns.t('remoteTerminalProduct.emptyEntitlements')"
    />
    <el-table v-else :data="entitlements" v-loading="loading" stripe>
      <el-table-column prop="name" :label="i18ns.t('remoteTerminalProduct.planName')" min-width="80" />
      <el-table-column
        prop="templateName"
        :label="i18ns.t('remoteTerminalProduct.templatesTab')"
        min-width="80"
      />
      <el-table-column :label="i18ns.t('remoteTerminalProduct.validPeriod')" min-width="120">
        <template #default="{ row }">
          <div>{{ formatDateTime(row.startAt) }}</div>
          <div class="secondary-text">{{ formatDateTime(row.endAt) }}</div>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('remoteTerminalProduct.durationDays')" width="120">
        <template #default="{ row }">{{ row.durationDays }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('remoteTerminalProduct.deviceLimit')" width="100">
        <template #default="{ row }">{{ row.registeredDeviceCount }} / {{ row.deviceLimit }}</template>
      </el-table-column>
      <el-table-column
        prop="terminalLimit"
        :label="i18ns.t('remoteTerminalProduct.terminalLimit')"
        width="180"
      />
      <el-table-column :label="i18ns.t('remoteTerminalProduct.registrationToken')" min-width="120">
        <template #default="{ row }">
          <div class="token-stack">
            <span>{{ row.registrationToken?.maskedToken || i18ns.t('remoteTerminalProduct.noToken') }}</span>
            <span v-if="!hasDeviceQuota(row.deviceLimit)" class="secondary-text">
              {{ i18ns.t('remoteTerminalProduct.tokenUnavailableForTerminalOnly') }}
            </span>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('status')" width="100">
        <template #default="{ row }">
          <el-tag :type="statusTagType(entitlementStatus(row))" size="small">
            {{ i18ns.t(statusTextKey(entitlementStatus(row))) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('actions')" min-width="240" fixed="right">
        <template #default="{ row }">
          <div class="token-actions">
            <el-button
              v-if="row.registrationToken?.token"
              link
              type="primary"
              @click="copyToken(row.registrationToken.token)"
            >
              {{ i18ns.t('remoteTerminalProduct.copyToken') }}
            </el-button>
            <el-button
              v-if="hasDeviceQuota(row.deviceLimit)"
              link
              type="warning"
              :loading="rotatingEntitlementId === row.id"
              @click="handleRotateMyToken(row)"
            >
              {{ i18ns.t('remoteTerminalProduct.rotateToken') }}
            </el-button>
            <el-button link type="primary" @click="goConsole()">
              {{ i18ns.t('remoteTerminalProduct.connectDevice') }}
            </el-button>
            <el-button link type="success" @click="openInstallDialog(row)">
              {{ i18ns.t('remoteTerminalProduct.installAgent') }}
            </el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </el-tab-pane>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useMyRemoteTerminalProductsContext } from '../context'

const {
  copyToken,
  entitlementStatus,
  entitlements,
  formatDateTime,
  goConsole,
  handleRotateMyToken,
  hasDeviceQuota,
  loading,
  openInstallDialog,
  rotatingEntitlementId,
  statusTagType,
  statusTextKey,
} = useMyRemoteTerminalProductsContext()
</script>
