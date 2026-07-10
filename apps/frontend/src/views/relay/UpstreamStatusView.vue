<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="upstream-status-page">
      <el-card v-loading="loading" shadow="never" class="status-card page-card">
        <!-- Header -->
        <template #header>
          <div class="page-header toolbar-row">
            <div class="header-left">
              <el-icon :size="24" class="header-icon">
                <Monitor />
              </el-icon>
              <h1 class="page-title">{{ i18ns.t('nav.upstreamStatus') }}</h1>
            </div>
            <el-button type="primary" :icon="Refresh" @click="loadUptimeStatus" :loading="loading">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <!-- Overall Status -->
        <div v-if="!loading && uptimeData.length > 0" class="overall-status">
          <el-icon
            :size="20"
            class="status-icon"
            :class="allServicesUp ? 'status-success' : 'status-warning'"
          >
            <CircleCheck v-if="allServicesUp" />
            <Warning v-else />
          </el-icon>
          <span class="status-text">
            {{
              allServicesUp
                ? i18ns.t('relay.allServicesOperational')
                : i18ns.t('relay.someServicesDown')
            }}
          </span>
        </div>

        <!-- Error Alert -->
        <el-alert v-if="error" type="error" :closable="false" show-icon class="error-alert">
          {{ error }}
        </el-alert>

        <!-- Empty State -->
        <el-empty
          v-else-if="!loading && uptimeData.length === 0"
          :description="i18ns.t('relay.noUptimeData')"
          :image-size="120"
        />

        <!-- Monitors List -->
        <div v-else class="mobile-page monitors-container">
          <div v-for="category in uptimeData" :key="category.categoryName" class="category-section">
            <h2 class="section-title">{{ category.categoryName }}</h2>

            <div v-for="monitor in category.monitors" :key="monitor.id" class="monitor-item">
              <div class="monitor-header">
                <div class="monitor-info">
                  <span class="monitor-name">{{ monitor.name }}</span>
                  <el-tag
                    :type="getUptimeTagType(monitor.uptime)"
                    size="small"
                    class="uptime-badge"
                    round
                  >
                    {{ (monitor.uptime * 100).toFixed(2) }}%
                  </el-tag>
                </div>
              </div>

              <!-- Heartbeat Chart -->
              <div
                v-if="monitor.heartbeats && monitor.heartbeats.length > 0"
                class="heartbeat-chart"
              >
                <div class="chart-container">
                  <el-tooltip
                    v-for="(beat, index) in monitor.heartbeats"
                    :key="index"
                    placement="top"
                    effect="light"
                    :show-after="80"
                    popper-class="heartbeat-tooltip-popper"
                  >
                    <template #content>
                      <div class="heartbeat-tooltip-content">
                        <div
                          class="tooltip-status"
                          :class="beat.status === HEARTBEAT_STATUS.UP ? 'status-up' : 'status-down'"
                        >
                          {{ getHeartbeatStatusText(beat.status) }}
                        </div>
                        <div class="tooltip-time">{{ formatHeartbeatTime(beat.time) }}</div>
                        <div class="tooltip-ping">
                          {{ i18ns.t('relay.upstreamPing') }}: {{ formatHeartbeatPing(beat.ping) }}
                        </div>
                        <div class="tooltip-ping">
                          {{ i18ns.t('relay.userToServerPing') }}:
                          {{ formatClientPing(userToServerPing) }}
                        </div>
                      </div>
                    </template>
                    <div
                      class="heartbeat-bar"
                      :class="beat.status === HEARTBEAT_STATUS.UP ? 'bar-success' : 'bar-danger'"
                    />
                  </el-tooltip>
                </div>
                <div class="chart-labels">
                  <span class="label-start">{{ getStartTime(monitor.heartbeats) }}</span>
                  <span class="label-end">{{ i18ns.t('relay.now') }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
  <div v-else class="mobile-page mobile-adapter">
    <div class="upstream-status-page">
      <el-card v-loading="loading" shadow="never" class="status-card mobile-card">
        <!-- Header -->
        <template #header>
          <div class="page-header toolbar-row">
            <div class="header-left">
              <el-icon :size="24" class="header-icon">
                <Monitor />
              </el-icon>
              <h1 class="page-title">{{ i18ns.t('nav.upstreamStatus') }}</h1>
            </div>
            <el-button type="primary" :icon="Refresh" @click="loadUptimeStatus" :loading="loading">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <!-- Overall Status -->
        <div v-if="!loading && uptimeData.length > 0" class="overall-status">
          <el-icon
            :size="20"
            class="status-icon"
            :class="allServicesUp ? 'status-success' : 'status-warning'"
          >
            <CircleCheck v-if="allServicesUp" />
            <Warning v-else />
          </el-icon>
          <span class="status-text">
            {{
              allServicesUp
                ? i18ns.t('relay.allServicesOperational')
                : i18ns.t('relay.someServicesDown')
            }}
          </span>
        </div>

        <!-- Error Alert -->
        <el-alert v-if="error" type="error" :closable="false" show-icon class="error-alert">
          {{ error }}
        </el-alert>

        <!-- Empty State -->
        <el-empty
          v-else-if="!loading && uptimeData.length === 0"
          :description="i18ns.t('relay.noUptimeData')"
          :image-size="120"
        />

        <!-- Monitors List -->
        <div v-else class="mobile-page monitors-container">
          <div v-for="category in uptimeData" :key="category.categoryName" class="category-section">
            <h2 class="section-title">{{ category.categoryName }}</h2>

            <div v-for="monitor in category.monitors" :key="monitor.id" class="monitor-item">
              <div class="monitor-header">
                <div class="monitor-info">
                  <span class="monitor-name">{{ monitor.name }}</span>
                  <el-tag
                    :type="getUptimeTagType(monitor.uptime)"
                    size="small"
                    class="uptime-badge"
                    round
                  >
                    {{ (monitor.uptime * 100).toFixed(2) }}%
                  </el-tag>
                </div>
              </div>

              <!-- Heartbeat Chart -->
              <div
                v-if="monitor.heartbeats && monitor.heartbeats.length > 0"
                class="heartbeat-chart"
              >
                <div class="chart-container">
                  <el-tooltip
                    v-for="(beat, index) in monitor.heartbeats"
                    :key="index"
                    placement="top"
                    effect="light"
                    :show-after="80"
                    popper-class="heartbeat-tooltip-popper"
                  >
                    <template #content>
                      <div class="heartbeat-tooltip-content">
                        <div
                          class="tooltip-status"
                          :class="beat.status === HEARTBEAT_STATUS.UP ? 'status-up' : 'status-down'"
                        >
                          {{ getHeartbeatStatusText(beat.status) }}
                        </div>
                        <div class="tooltip-time">{{ formatHeartbeatTime(beat.time) }}</div>
                        <div class="tooltip-ping">
                          {{ i18ns.t('relay.upstreamPing') }}: {{ formatHeartbeatPing(beat.ping) }}
                        </div>
                        <div class="tooltip-ping">
                          {{ i18ns.t('relay.userToServerPing') }}:
                          {{ formatClientPing(userToServerPing) }}
                        </div>
                      </div>
                    </template>
                    <div
                      class="heartbeat-bar"
                      :class="beat.status === HEARTBEAT_STATUS.UP ? 'bar-success' : 'bar-danger'"
                    />
                  </el-tooltip>
                </div>
                <div class="chart-labels">
                  <span class="label-start">{{ getStartTime(monitor.heartbeats) }}</span>
                  <span class="label-end">{{ i18ns.t('relay.now') }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, onMounted, computed } from 'vue'
import { i18ns } from '@/locales'
import { relayConfigService } from '@/service/relayConfigService'
import type { UptimeCategory } from '@/client/types.gen'
import { HEARTBEAT_STATUS } from '@/constant/status'
import { Monitor, Refresh, CircleCheck, Warning } from '@element-plus/icons-vue'

const loading = ref(false)
const uptimeData = ref<UptimeCategory[]>([])
const error = ref('')
const userToServerPing = ref<number | null>(null)

const readLatestPingNetworkTime = (windowStart: number, windowEnd: number): number | null => {
  const resourceEntries = performance.getEntriesByType('resource')
  const pingEntry = [...resourceEntries].reverse().find((entry) => {
    if (!(entry instanceof PerformanceResourceTiming)) return false
    if (!entry.name.includes('/ping')) return false
    return entry.startTime >= windowStart - 100 && entry.responseEnd <= windowEnd + 100
  }) as PerformanceResourceTiming | undefined

  if (!pingEntry) return null
  const networkMs = pingEntry.responseEnd - pingEntry.startTime
  if (!Number.isFinite(networkMs) || networkMs <= 0) return null
  return Math.round(networkMs)
}

const measureUserToServerPing = async (): Promise<void> => {
  const requestStart = performance.now()
  try {
    await relayConfigService.pingServer()
    const requestEnd = performance.now()
    const networkPing = readLatestPingNetworkTime(requestStart, requestEnd)
    const fallbackPing = Math.max(1, Math.round(requestEnd - requestStart))
    userToServerPing.value = networkPing ?? fallbackPing
  } catch {
    userToServerPing.value = null
  }
}

const allServicesUp = computed(() => {
  return uptimeData.value.every((category) =>
    category.monitors.every((monitor) => monitor.status === HEARTBEAT_STATUS.UP),
  )
})

const loadUptimeStatus = async () => {
  loading.value = true
  error.value = ''
  await measureUserToServerPing()
  try {
    const response = await relayConfigService.getUptimeStatus()
    if (response.success) {
      uptimeData.value = response.data
    } else {
      error.value = response.message || i18ns.t('relay.loadUptimeFailed')
    }
  } catch (err: any) {
    console.error('Failed to load uptime status:', err)
    error.value = err.message || i18ns.t('relay.loadUptimeFailed')
  } finally {
    loading.value = false
  }
}

const getUptimeTagType = (uptime: number): string => {
  if (uptime >= 0.95) return 'success'
  if (uptime >= 0.8) return 'warning'
  return 'danger'
}

const getStartTime = (heartbeats: any[]): string => {
  if (!heartbeats || heartbeats.length === 0) return ''
  const firstBeat = heartbeats[0]
  if (!firstBeat.time) return ''

  // Extract time portion (e.g., "14:34" from "2026-03-12 14:34:09")
  const timePart = firstBeat.time.split(' ')[1]
  if (!timePart) return firstBeat.time

  return timePart.substring(0, 5) // Return "HH:mm"
}

const getHeartbeatStatusText = (status: number): string => {
  return status === HEARTBEAT_STATUS.UP
    ? i18ns.t('relay.heartbeatNormal')
    : i18ns.t('relay.heartbeatAbnormal')
}

const formatHeartbeatTime = (time?: string): string => {
  return time || '--'
}

const formatHeartbeatPing = (ping?: number | null): string => {
  return ping === null || ping === undefined ? 'N/A' : `${ping}ms`
}

const formatClientPing = (ping?: number | null): string => {
  return ping === null || ping === undefined ? 'N/A' : `${ping}ms`
}

onMounted(() => {
  loadUptimeStatus()
})

const { isDesktop } = usePageDevice()

if (!isDesktop.value) {
  useMobileTableCardLabels('.mobile-adapter')
}
</script>

<style scoped>
.upstream-status-page {
  width: 100%;
  min-width: 0;
}

.status-card {
  border-radius: 8px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  color: var(--el-color-primary);
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.overall-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  margin-bottom: 24px;
}

.status-icon {
  flex-shrink: 0;
}

.status-icon.status-success {
  color: #67c23a;
}

.status-icon.status-warning {
  color: #e6a23c;
}

.status-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.error-alert {
  margin-bottom: 20px;
}

.monitors-container {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.category-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  padding-bottom: 12px;
  border-bottom: 2px solid var(--el-border-color-lighter);
}

.monitor-item {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 20px;
  transition: all 0.3s ease;
}

.monitor-item:hover {
  border-color: var(--el-color-primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.monitor-header {
  margin-bottom: 16px;
}

.monitor-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.monitor-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.uptime-badge {
  font-weight: 600;
  font-size: 13px;
  padding: 4px 12px;
}

.heartbeat-chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chart-container {
  display: flex;
  gap: 2px;
  height: 40px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
  padding: 4px;
  overflow-x: auto;
}

.heartbeat-bar {
  flex: 1;
  min-width: 4px;
  height: 100%;
  border-radius: 2px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.heartbeat-bar:hover {
  transform: scaleY(1.1);
  opacity: 0.8;
}

.bar-success {
  background: #67c23a;
}

.bar-danger {
  background: #f56c6c;
}

:deep(.heartbeat-tooltip-popper) {
  border-radius: 8px;
  border: 1px solid var(--el-border-color-light);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
  padding: 0;
}

.heartbeat-tooltip-content {
  min-width: 160px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tooltip-status {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}

.tooltip-status.status-up {
  color: #67c23a;
}

.tooltip-status.status-down {
  color: #f56c6c;
}

.tooltip-time,
.tooltip-ping {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.3;
}

.chart-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 0 4px;
}

@media (max-width: 768px) {
  .upstream-status-page {
    padding: 12px;
  }

  .page-title {
    font-size: 18px;
  }

  .monitor-item {
    padding: 16px;
  }
}
</style>

<style scoped>
.mobile-adapter {
  padding: 8px 6px 16px;
  overflow-x: hidden;
}

.mobile-adapter :deep(.hide-on-mobile),
.mobile-adapter :deep(.el-table__header-wrapper),
.mobile-adapter :deep(.el-scrollbar__bar.is-horizontal),
.mobile-adapter :deep(.el-table__body colgroup),
.mobile-adapter :deep(.el-table__header colgroup) {
  display: none !important;
}

.mobile-adapter :deep(.el-form--inline) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.mobile-adapter :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 10px;
}

.mobile-adapter :deep(.el-form-item__label) {
  float: none;
  display: block;
  text-align: left;
  padding: 0 0 6px;
}

.mobile-adapter :deep(.el-form-item__content) {
  margin-left: 0 !important;
}

.mobile-adapter :deep(.el-input),
.mobile-adapter :deep(.el-select),
.mobile-adapter :deep(.el-date-editor),
.mobile-adapter :deep(.el-input-number),
.mobile-adapter :deep(.el-textarea),
.mobile-adapter :deep(.el-button) {
  width: 100%;
}

.mobile-adapter :deep(.el-table__inner-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__wrap),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__view) {
  overflow-x: hidden !important;
}

.mobile-adapter :deep(.el-table__body-wrapper) {
  overflow-y: visible !important;
  padding: 4px 0 10px;
}

.mobile-adapter :deep(.el-table__body tbody) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mobile-adapter :deep(.el-table__body tr) {
  display: block;
  width: 100% !important;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
}

.mobile-adapter :deep(.el-table__body td) {
  display: block;
  border: none !important;
  padding: 5px 0;
}

.mobile-adapter :deep(.el-table__body td::before) {
  content: attr(data-label);
  display: block;
  margin-bottom: 2px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}

.mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.mobile-adapter :deep(.el-drawer) {
  max-height: 92vh;
}

.mobile-adapter :deep(.el-pagination) {
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
