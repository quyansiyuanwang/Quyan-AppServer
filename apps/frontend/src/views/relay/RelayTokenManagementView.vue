<template>
  <div class="relay-token-management">
    <RelayTokenPageDesktop v-if="isDesktop" />
    <RelayTokenPageMobile v-else />

    <RelayTokenEditDrawer />

    <el-dialog
      v-model="showTokenImportDialog"
      :title="i18ns.t('relay.tokenImportDialogTitle')"
      width="min(680px, calc(100vw - 32px))"
      append-to-body
      class="relay-token-dialog"
    >
      <el-input
        v-model="tokenImportText"
        type="textarea"
        :rows="12"
        :placeholder="i18ns.t('relay.tokenImportPlaceholder')"
      />
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showTokenImportDialog = false">
            {{ i18ns.t('cancel') }}
          </el-button>
          <el-button type="primary" @click="state.handleImportTokens">
            {{ i18ns.t('relay.importTokens') }}
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showTokenChannelImportDialog"
      :title="i18ns.t('relay.tokenChannelImportDialogTitle')"
      width="min(680px, calc(100vw - 32px))"
      append-to-body
      class="relay-token-dialog"
    >
      <el-input
        v-model="tokenChannelImportText"
        type="textarea"
        :rows="12"
        :placeholder="i18ns.t('relay.tokenChannelImportPlaceholder')"
      />
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showTokenChannelImportDialog = false">
            {{ i18ns.t('cancel') }}
          </el-button>
          <el-button type="primary" @click="state.handleImportTokenChannelConfigs">
            {{ i18ns.t('relay.importChannels') }}
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showSwitchLogDialog"
      :title="i18ns.t('relay.switchLogsTitle', { token: currentSwitchLogTokenName })"
      :width="isDesktop ? '78%' : '92%'"
      class="relay-token-dialog switch-log-dialog"
    >
      <div class="switch-log-toolbar">
        <el-button :loading="loadingSwitchLogs" @click="state.loadSwitchLogs()">
          {{ i18ns.t('refresh') }}
        </el-button>
      </div>
      <el-table v-if="switchLogs.length" :data="switchLogs" border stripe max-height="420">
        <el-table-column prop="createTime" :label="i18ns.t('relay.createTime')" min-width="170">
          <template #default="{ row }">
            {{ state.formatDateTime(row.createTime) }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.fromChannel')" min-width="120">
          <template #default="{ row }">
            {{ row.fromChannelName || state.getChannelName(row.fromChannelId) }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.toChannel')" min-width="120">
          <template #default="{ row }">
            {{ row.toChannelName || state.getChannelName(row.toChannelId) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="triggerStatusCode"
          :label="i18ns.t('relay.statusCode')"
          width="100"
        />
        <el-table-column prop="attemptNumber" :label="i18ns.t('relay.attemptNumber')" width="100" />
        <el-table-column prop="method" :label="i18ns.t('relay.method')" width="90" />
        <el-table-column
          prop="requestPath"
          :label="i18ns.t('relay.path')"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column
          prop="modelName"
          :label="i18ns.t('relay.modelName')"
          min-width="120"
          show-overflow-tooltip
        />
        <el-table-column
          prop="triggerError"
          :label="i18ns.t('relay.triggerError')"
          min-width="180"
          show-overflow-tooltip
        />
      </el-table>
      <el-empty v-else :description="i18ns.t('relay.noSwitchLogs')" />
    </el-dialog>

    <BalanceScriptDialogV2
      v-model="showBalanceScriptDialog"
      :token="currentBalanceScriptToken"
      @switch-to-v1="state.switchToV1BalanceScriptDialog"
    />

    <BalanceScriptDialogV1
      v-model="showV1BalanceScriptDialog"
      :token="currentV1BalanceScriptToken"
    />

    <el-drawer
      v-model="showQuotaWindowDetailDialog"
      :title="quotaWindowDetailDialogTitle"
      :direction="isDesktop ? 'rtl' : 'btt'"
      :size="isDesktop ? '440px' : '78%'"
      class="relay-token-dialog quota-window-detail-drawer"
    >
      <div class="quota-window-detail-drawer__body">
        <div v-if="currentQuotaWindowDetailToken" class="quota-window-detail-drawer__token">
          <span class="meta-label">{{ i18ns.t('relay.tokenName') }}</span>
          <span class="quota-window-detail-drawer__token-name">
            {{ currentQuotaWindowDetailToken.name || i18ns.t('relay.unnamedToken') }}
          </span>
        </div>

        <div class="quota-window-detail-drawer__list">
          <div
            v-for="(quotaWindow, quotaWindowIndex) in currentQuotaWindowDetailWindows"
            :key="`quota-window-detail-${quotaWindow.id || quotaWindowIndex}`"
            class="quota-window-usage-item"
          >
            <div class="quota-window-usage-item__header">
              <span class="quota-window-chip">
                {{ state.formatQuotaWindowRule(quotaWindow) }}
              </span>
              <span
                v-if="quotaWindow.quotaUsagePercent != null"
                class="quota-window-usage-item__percent"
                :class="{ 'quota-window-usage-item__percent--danger': quotaWindow.isQuotaExceeded }"
              >
                {{ state.formatQuotaPercent(quotaWindow.quotaUsagePercent) }}
              </span>
            </div>
            <el-progress
              v-if="quotaWindow.quotaUsagePercent != null"
              :percentage="state.getQuotaProgressPercentage(quotaWindow.quotaUsagePercent)"
              :status="state.getQuotaProgressStatus(quotaWindow.quotaUsagePercent)"
              :stroke-width="6"
              :show-text="false"
              class="quota-window-usage-item__progress"
            />
            <div
              class="quota-window-usage-item__summary"
              :class="{ 'quota-window-usage-item__summary--danger': quotaWindow.isQuotaExceeded }"
            >
              {{ state.formatQuotaWindowCompactSummary(quotaWindow) }}
            </div>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import BalanceScriptDialogV1 from '@/components/relay/BalanceScriptDialogV1.vue'
import BalanceScriptDialogV2 from '@/components/relay/BalanceScriptDialogV2.vue'
import { i18ns } from '@/locales'
import RelayTokenEditDrawer from './relay-token-management/components/RelayTokenEditDrawer.vue'
import RelayTokenPageDesktop from './relay-token-management/components/RelayTokenPageDesktop.vue'
import RelayTokenPageMobile from './relay-token-management/components/RelayTokenPageMobile.vue'
import { relayTokenManagementContextKey } from './relay-token-management/context'
import { useRelayTokenManagement } from './relay-token-management/useRelayTokenManagement'
import './relay-token-management/relay-token-management.scss'

const state = useRelayTokenManagement()

const {
  isDesktop,
  showTokenImportDialog,
  tokenImportText,
  showTokenChannelImportDialog,
  tokenChannelImportText,
  showSwitchLogDialog,
  loadingSwitchLogs,
  currentSwitchLogTokenName,
  switchLogs,
  showBalanceScriptDialog,
  currentBalanceScriptToken,
  showV1BalanceScriptDialog,
  currentV1BalanceScriptToken,
  showQuotaWindowDetailDialog,
  quotaWindowDetailDialogTitle,
  currentQuotaWindowDetailToken,
  currentQuotaWindowDetailWindows,
} = state

provide(relayTokenManagementContextKey, state)

defineExpose(state)
</script>
