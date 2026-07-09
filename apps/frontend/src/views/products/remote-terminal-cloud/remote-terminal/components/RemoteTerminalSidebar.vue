<template>
  <el-col :xs="24" :lg="8" :xl="7">
    <el-card shadow="never" class="page-card sidebar-card">
      <template #header>
        <div class="page-header toolbar-row">
          <div class="header-left">
            <el-icon :size="24" class="header-icon">
              <Monitor />
            </el-icon>
            <div>
              <h1 class="page-title">{{ i18ns.t('nav.remoteTerminal') }}</h1>
              <p class="page-subtitle">{{ i18ns.t('remoteTerminal.description') }}</p>
            </div>
          </div>
          <el-button :icon="Refresh" :loading="loading" @click="refreshAll">
            {{ i18ns.t('refresh') }}
          </el-button>
        </div>
      </template>

      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        :closable="false"
        show-icon
        class="section-block"
      />

      <div class="section-block">
        <div class="section-label">{{ i18ns.t('remoteTerminal.devices') }}</div>
        <el-empty
          v-if="!loading && devices.length === 0"
          :description="i18ns.t('remoteTerminal.noDevices')"
          :image-size="96"
        />

        <div v-else class="device-list">
          <button
            v-for="device in devices"
            :key="device.deviceId"
            type="button"
            class="device-card"
            :class="{ active: currentTab?.deviceId === device.deviceId }"
            @click="selectDeviceForCurrentTab(device.deviceId)"
          >
            <div class="device-card-top">
              <div>
                <div class="device-name">{{ device.hostname }}</div>
                <div class="device-meta">{{ device.platform }} · {{ device.arch }}</div>
              </div>
              <el-tag :type="device.online ? 'success' : 'info'" round size="small">
                {{
                  device.online
                    ? i18ns.t('remoteTerminal.online')
                    : i18ns.t('remoteTerminal.offline')
                }}
              </el-tag>
            </div>
            <div class="device-time">
              {{ i18ns.t('remoteTerminal.lastSeenAt') }}:
              {{ formatDateTime(device.lastSeenAt) }}
            </div>
          </button>
        </div>
      </div>

      <div class="action-panel">
        <div class="quota-panel">
          <div class="quota-grid">
            <div class="quota-card">
              <div class="quota-card-label">{{ i18ns.t('remoteTerminal.terminalQuota') }}</div>
              <div class="quota-card-value">
                {{ usageSummary.activeSessionCount }}/{{ usageSummary.totalTerminalLimit }}
              </div>
            </div>
            <div class="quota-card">
              <div class="quota-card-label">{{ i18ns.t('remoteTerminal.deviceQuota') }}</div>
              <div class="quota-card-value">
                {{ usageSummary.activeDeviceCount }}/{{ usageSummary.totalDeviceLimit }}
              </div>
            </div>
          </div>
          <div v-if="connectBlockedReason" class="quota-warning">
            {{ connectBlockedReason }}
          </div>
        </div>
        <div class="action-row action-row-top">
          <el-select
            v-model="currentShellType"
            class="shell-select"
            :disabled="
              !currentSelectedDevice ||
              availableShellOptions.length === 0 ||
              currentSessionConnecting
            "
          >
            <el-option
              v-for="shellType in availableShellOptions"
              :key="shellType"
              :label="getShellTypeLabel(shellType)"
              :value="shellType"
            />
          </el-select>
        </div>
        <div class="action-row action-row-bottom">
          <el-button
            type="primary"
            class="action-button"
            :disabled="!currentSelectedOnlineDeviceId || currentSessionConnecting || connectBlocked"
            :loading="currentSessionConnecting"
            @click="connectCurrentTerminal"
          >
            {{ i18ns.t('remoteTerminal.connect') }}
          </el-button>
          <el-button
            :icon="RefreshRight"
            class="action-button"
            :disabled="!currentCanReconnect || currentSessionConnecting"
            @click="reconnectCurrentTerminal"
          >
            {{ i18ns.t('remoteTerminal.reconnect') }}
          </el-button>
          <el-button
            class="action-button"
            :disabled="!currentSocketConnected"
            @click="disconnectCurrentTerminal()"
          >
            {{ i18ns.t('remoteTerminal.disconnect') }}
          </el-button>
        </div>
      </div>

      <div class="section-block working-directory-panel">
        <div class="section-label section-label-row">
          <span>{{ i18ns.t('remoteTerminal.openLocation') }}</span>
          <el-tag v-if="defaultWorkingDirectory" size="small" type="info" round>
            {{ i18ns.t('remoteTerminal.locationRememberedTag') }}
          </el-tag>
        </div>
        <div class="working-directory-value">
          {{ currentWorkingDirectoryDisplay }}
        </div>
        <div class="working-directory-hint">
          {{ i18ns.t('remoteTerminal.openLocationHint') }}
        </div>
        <div class="action-row working-directory-actions">
          <el-button class="action-button" @click="openWorkingDirectoryDialog">
            {{ i18ns.t('remoteTerminal.changeOpenLocation') }}
          </el-button>
          <el-button class="action-button" @click="resetRememberedWorkingDirectory">
            {{ i18ns.t('remoteTerminal.resetLocationMemory') }}
          </el-button>
        </div>
      </div>

      <div v-if="currentSelectedDevice && availableShellOptions.length === 0" class="section-hint">
        {{ i18ns.t('remoteTerminal.shellTypeUnavailable') }}
      </div>

      <div class="section-block status-panel">
        <div class="section-label">{{ i18ns.t('status') }}</div>
        <div class="status-text">{{ currentDisplayStatusText }}</div>
        <div v-if="currentRetryCountdownSeconds !== null" class="retry-hint">
          {{ i18ns.t('remoteTerminal.retryHint') }}
        </div>
      </div>

      <div class="section-block retry-policy-panel">
        <div class="retry-policy-header">
          <div class="section-label retry-policy-title">
            {{ i18ns.t('remoteTerminal.retryPolicy') }}
          </div>
          <el-button
            text
            type="warning"
            :disabled="!currentAutoReconnectPending"
            @click="cancelCurrentAutoReconnect"
          >
            {{ i18ns.t('remoteTerminal.cancelRetry') }}
          </el-button>
        </div>
        <div class="retry-policy-grid">
          <label class="retry-policy-item">
            <span class="retry-policy-label">{{ i18ns.t('remoteTerminal.retryMaxAttempts') }}</span>
            <el-input-number v-model="currentRetryMaxAttempts" :min="1" :max="10" />
          </label>
          <label class="retry-policy-item">
            <span class="retry-policy-label">{{ i18ns.t('remoteTerminal.retryDelaySeconds') }}</span>
            <el-input-number v-model="currentRetryDelaySeconds" :min="1" :max="60" />
          </label>
        </div>
      </div>

      <div class="section-block">
        <div class="section-label">{{ i18ns.t('remoteTerminal.recentSessions') }}</div>
        <el-table :data="paginatedSessions" size="small" stripe>
          <el-table-column
            prop="deviceId"
            :label="i18ns.t('remoteTerminal.deviceId')"
            min-width="120"
          />
          <el-table-column prop="status" :label="i18ns.t('status')" width="110" />
          <el-table-column :label="i18ns.t('remoteTerminal.createdAt')" min-width="160">
            <template #default="scope">
              {{ formatDateTime(scope.row.createdAt) }}
            </template>
          </el-table-column>
        </el-table>
        <div v-if="sortedSessions.length > sessionPageSize" class="sessions-pagination">
          <el-pagination
            size="small"
            background
            layout="prev, pager, next"
            :current-page="sessionPage"
            :page-size="sessionPageSize"
            :total="sortedSessions.length"
            @current-change="handleSessionPageChange"
          />
        </div>
      </div>
    </el-card>
  </el-col>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRemoteTerminalManagementContext } from '../context'

const state = useRemoteTerminalManagementContext()

const {
  Monitor,
  Refresh,
  availableShellOptions,
  cancelCurrentAutoReconnect,
  connectBlocked,
  connectBlockedReason,
  connectCurrentTerminal,
  currentAutoReconnectPending,
  currentCanReconnect,
  currentDisplayStatusText,
  currentRetryCountdownSeconds,
  currentRetryDelaySeconds,
  currentRetryMaxAttempts,
  currentSelectedDevice,
  currentSelectedOnlineDeviceId,
  currentSessionConnecting,
  currentShellType,
  currentSocketConnected,
  currentTab,
  currentWorkingDirectoryDisplay,
  defaultWorkingDirectory,
  devices,
  disconnectCurrentTerminal,
  errorMessage,
  formatDateTime,
  getShellTypeLabel,
  loading,
  openWorkingDirectoryDialog,
  paginatedSessions,
  reconnectCurrentTerminal,
  refreshAll,
  resetRememberedWorkingDirectory,
  selectDeviceForCurrentTab,
  sessionPage,
  sessionPageSize,
  sortedSessions,
  usageSummary,
  handleSessionPageChange,
  RefreshRight,
} = state
</script>
