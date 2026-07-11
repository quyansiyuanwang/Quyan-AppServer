<template>
  <div v-if="isDesktop" class="desktop-page system-stats-page">
    <!-- Toolbar outside any card -->
    <div class="stats-toolbar">
      <div class="toolbar-left">
        <span class="page-title">{{ i18ns.t('SystemStats.title') }}</span>
      </div>
      <div class="toolbar-right">
        <div class="auto-refresh-box">
          <el-tag v-if="autoRefreshTimer" type="success" size="small" effect="light">
            {{ i18ns.t('SystemStats.autoRefreshActive') }}
          </el-tag>
          <span class="auto-refresh-label">{{ i18ns.t('SystemStats.autoRefresh') }}</span>
          <el-input-number
            v-model="autoRefreshInterval"
            :min="0"
            :max="3600"
            :step="3"
            :placeholder="i18ns.t('SystemStats.autoRefreshPlaceholder')"
            size="small"
            style="width: 120px"
            @change="onAutoRefreshChange"
          />
          <span class="auto-refresh-unit">{{ i18ns.t('SystemStats.seconds') }}</span>
        </div>
        <el-button type="primary" :icon="Refresh" :loading="isAnyLoading" @click="loadAll">
          {{ i18ns.t('SystemStats.refreshAll') }}
        </el-button>
      </div>
    </div>

    <div class="system-stats-container">
      <!-- Server Timing + App Stats Card -->
      <el-card v-loading="loadingMap.server" class="stats-card">
        <template #header>
          <div class="card-header">
            <span class="card-title"
              >{{ i18ns.t('SystemStats.serverTiming') }} /
              {{ i18ns.t('SystemStats.applicationStats') }}</span
            >
          </div>
        </template>

        <div class="section-title">{{ i18ns.t('SystemStats.serverTiming') }}</div>
        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.uptime')"
              :value="0"
              :formatter="() => stats.server.uptimeFormatted"
            >
              <template #prefix
                ><el-icon><Clock /></el-icon
              ></template>
            </el-statistic>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.startedAt')"
              :value="stats.server.startedAt"
              :formatter="(v: number) => formatDateTime(v)"
            >
              <template #prefix
                ><el-icon><Calendar /></el-icon
              ></template>
            </el-statistic>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.currentTime')"
              :value="stats.server.currentTime"
              :formatter="(v: number) => formatDateTime(v)"
            >
              <template #prefix
                ><el-icon><Timer /></el-icon
              ></template>
            </el-statistic>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.uptimeSeconds')"
              :value="stats.server.uptimeSeconds"
              suffix="s"
            >
              <template #prefix
                ><el-icon><Stopwatch /></el-icon
              ></template>
            </el-statistic>
          </el-col>
        </el-row>

        <el-divider />

        <div class="section-title">{{ i18ns.t('SystemStats.applicationStats') }}</div>
        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic :title="i18ns.t('SystemStats.userCount')" :value="stats.userCount">
              <template #prefix
                ><el-icon><User /></el-icon
              ></template>
            </el-statistic>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic :title="i18ns.t('SystemStats.groupCount')" :value="stats.groupCount">
              <template #prefix
                ><el-icon><UserFilled /></el-icon
              ></template>
            </el-statistic>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.permissionCount')"
              :value="stats.permissionCount"
            >
              <template #prefix
                ><el-icon><Key /></el-icon
              ></template>
            </el-statistic>
          </el-col>
        </el-row>
      </el-card>

      <!-- Memory & CPU Card -->
      <el-card v-loading="loadingMap.resource" class="stats-card">
        <template #header>
          <div class="card-header">
            <span class="card-title">{{ i18ns.t('SystemStats.resourceUsage') }}</span>
          </div>
        </template>

        <div class="section-title">{{ i18ns.t('SystemStats.memory') }}</div>
        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.heapUsed')"
              :value="stats.memory.heapUsed"
              :formatter="(v: number) => formatBytes(v)"
            >
              <template #prefix
                ><el-icon><Coin /></el-icon
              ></template>
            </el-statistic>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.heapTotal')"
              :value="stats.memory.heapTotal"
              :formatter="(v: number) => formatBytes(v)"
            >
              <template #prefix
                ><el-icon><Coin /></el-icon
              ></template>
            </el-statistic>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.heapUsagePercent')"
              :value="stats.memory.heapUsagePercent"
              :precision="1"
              suffix="%"
            >
              <template #prefix
                ><el-icon><PieChart /></el-icon
              ></template>
            </el-statistic>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.rss')"
              :value="stats.memory.rss"
              :formatter="(v: number) => formatBytes(v)"
            >
              <template #prefix
                ><el-icon><DataAnalysis /></el-icon
              ></template>
            </el-statistic>
          </el-col>
        </el-row>

        <el-divider />

        <div class="section-title">{{ i18ns.t('SystemStats.cpu') }}</div>
        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.cpuUser')"
              :value="stats.cpu.user"
              :formatter="(v: number) => formatMicroseconds(v)"
            >
              <template #prefix
                ><el-icon><Cpu /></el-icon
              ></template>
            </el-statistic>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <el-statistic
              :title="i18ns.t('SystemStats.cpuSystem')"
              :value="stats.cpu.system"
              :formatter="(v: number) => formatMicroseconds(v)"
            >
              <template #prefix
                ><el-icon><Cpu /></el-icon
              ></template>
            </el-statistic>
          </el-col>
        </el-row>
      </el-card>

      <!-- Runtime Info Card -->
      <el-card v-loading="loadingMap.runtime" class="stats-card">
        <template #header>
          <div class="card-header">
            <span class="card-title">{{ i18ns.t('SystemStats.runtimeInfo') }}</span>
          </div>
        </template>

        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.nodeVersion') }}</span>
              <span class="info-value">{{ stats.runtime.nodeVersion }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.v8Version') }}</span>
              <span class="info-value">{{ stats.runtime.v8Version }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.platform') }}</span>
              <span class="info-value"
                >{{ stats.runtime.platform }} / {{ stats.runtime.arch }}</span
              >
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.pid') }}</span>
              <span class="info-value">{{ stats.runtime.pid }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.cpuCores') }}</span>
              <span class="info-value">{{ stats.runtime.cpuCores }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.hostname') }}</span>
              <span class="info-value">{{ stats.runtime.hostname }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.osTotalMemory') }}</span>
              <span class="info-value">{{ formatBytes(stats.runtime.osTotalMemory) }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.osFreeMemory') }}</span>
              <span class="info-value">{{ formatBytes(stats.runtime.osFreeMemory) }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.osUptime') }}</span>
              <span class="info-value">{{ formatSeconds(stats.runtime.osUptime) }}</span>
            </div>
          </el-col>
        </el-row>
      </el-card>

      <!-- Infrastructure & Config Card -->
      <el-card v-loading="loadingMap.infra" class="stats-card">
        <template #header>
          <div class="card-header">
            <span class="card-title">{{ i18ns.t('SystemStats.infrastructure') }}</span>
          </div>
        </template>

        <div class="section-title">{{ i18ns.t('SystemStats.redis') }}</div>
        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="6">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.redisStatus') }}</span>
              <el-tag :type="stats.redis.available ? 'success' : 'danger'">
                {{
                  stats.redis.available
                    ? i18ns.t('SystemStats.available')
                    : i18ns.t('SystemStats.unavailable')
                }}
              </el-tag>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="6">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.circuitState') }}</span>
              <el-tag :type="getCircuitStateType(stats.redis.circuitState)">
                {{ stats.redis.circuitState }}
              </el-tag>
            </div>
          </el-col>
        </el-row>

        <el-divider />

        <div class="section-title">{{ i18ns.t('SystemStats.configuration') }}</div>
        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.nodeEnv') }}</span>
              <el-tag :type="stats.config.nodeEnv === 'production' ? 'success' : 'warning'">
                {{ stats.config.nodeEnv }}
              </el-tag>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.port') }}</span>
              <span class="info-value">{{ stats.config.port }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.database') }}</span>
              <span class="info-value code">{{
                formatDatabaseDisplay(stats.config.database)
              }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.redisHost') }}</span>
              <span class="info-value"
                >{{ stats.config.redisHost }}:{{ stats.config.redisPort }}</span
              >
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.captchaStatus') }}</span>
              <el-tag :type="stats.config.captchaEnabled ? 'success' : 'info'">
                {{
                  stats.config.captchaEnabled
                    ? i18ns.t('SystemStats.enabled')
                    : i18ns.t('SystemStats.disabled')
                }}
              </el-tag>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.captchaProvider') }}</span>
              <span class="info-value">{{ stats.config.captchaProvider }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.jwtExpiry') }}</span>
              <span class="info-value"
                >{{ stats.config.jwtAccessExpiresIn }}s /
                {{ stats.config.jwtRefreshExpiresIn }}s</span
              >
            </div>
          </el-col>
        </el-row>
      </el-card>

      <!-- Build Info Card -->
      <el-card v-loading="loadingMap.build" class="stats-card">
        <template #header>
          <div class="card-header">
            <span class="card-title">{{ i18ns.t('SystemStats.buildInfo') }}</span>
          </div>
        </template>

        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.version') }}</span>
              <span class="info-value">{{ stats.buildInfo.version }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.branch') }}</span>
              <span class="info-value">{{ stats.buildInfo.branch }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.commitHash') }}</span>
              <span class="info-value code">{{ stats.buildInfo.commitHashShort }}</span>
            </div>
          </el-col>
          <el-col :xs="24">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.commitMessage') }}</span>
              <span class="info-value">{{ stats.buildInfo.commitMessage }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.commitTime') }}</span>
              <span class="info-value">{{ stats.buildInfo.commitTime }}</span>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12">
            <div class="info-item">
              <span class="info-label">{{ i18ns.t('SystemStats.buildTime') }}</span>
              <span class="info-value">{{ stats.buildInfo.buildTime }}</span>
            </div>
          </el-col>
        </el-row>
      </el-card>
    </div>
  </div>

  <!-- Mobile View -->
  <div v-else class="mobile-page system-stats-mobile-adapter">
    <div class="mobile-toolbar">
      <div class="auto-refresh-box">
        <el-input-number
          v-model="autoRefreshInterval"
          :min="0"
          :max="3600"
          :step="10"
          :placeholder="i18ns.t('SystemStats.autoRefreshPlaceholder')"
          size="small"
          style="width: 100px"
          @change="onAutoRefreshChange"
        />
        <span class="auto-refresh-unit">{{ i18ns.t('SystemStats.seconds') }}</span>
        <el-tag v-if="autoRefreshTimer" type="success" size="small" effect="light">Auto</el-tag>
      </div>
      <el-button
        type="primary"
        :icon="Refresh"
        :loading="isAnyLoading"
        size="small"
        @click="loadAll"
      >
        {{ i18ns.t('SystemStats.refreshAll') }}
      </el-button>
    </div>

    <div class="system-stats-container">
      <el-card v-loading="isAnyLoading" class="stats-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('SystemStats.title') }}</span>
          </div>
        </template>

        <el-collapse v-model="activeCollapse" accordion>
          <el-collapse-item :title="i18ns.t('SystemStats.serverTiming')" name="server">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item :label="i18ns.t('SystemStats.uptime')">
                {{ stats.server.uptimeFormatted }}
              </el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('SystemStats.startedAt')">
                {{ formatDateTime(stats.server.startedAt) }}
              </el-descriptions-item>
            </el-descriptions>
          </el-collapse-item>

          <el-collapse-item :title="i18ns.t('SystemStats.applicationStats')" name="app">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item :label="i18ns.t('SystemStats.userCount')">
                {{ stats.userCount }}
              </el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('SystemStats.groupCount')">
                {{ stats.groupCount }}
              </el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('SystemStats.permissionCount')">
                {{ stats.permissionCount }}
              </el-descriptions-item>
            </el-descriptions>
          </el-collapse-item>

          <el-collapse-item :title="i18ns.t('SystemStats.resourceUsage')" name="resources">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item :label="i18ns.t('SystemStats.heapUsed')">
                {{ formatBytes(stats.memory.heapUsed) }}
              </el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('SystemStats.heapUsagePercent')">
                {{ stats.memory.heapUsagePercent }}%
              </el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('SystemStats.rss')">
                {{ formatBytes(stats.memory.rss) }}
              </el-descriptions-item>
            </el-descriptions>
          </el-collapse-item>

          <el-collapse-item :title="i18ns.t('SystemStats.infrastructure')" name="infra">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item :label="i18ns.t('SystemStats.redisStatus')">
                <el-tag :type="stats.redis.available ? 'success' : 'danger'" size="small">
                  {{
                    stats.redis.available
                      ? i18ns.t('SystemStats.available')
                      : i18ns.t('SystemStats.unavailable')
                  }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item :label="i18ns.t('SystemStats.circuitState')">
                <el-tag :type="getCircuitStateType(stats.redis.circuitState)" size="small">
                  {{ stats.redis.circuitState }}
                </el-tag>
              </el-descriptions-item>
            </el-descriptions>
          </el-collapse-item>
        </el-collapse>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Clock,
  User,
  UserFilled,
  Key,
  Refresh,
  Calendar,
  Timer,
  Stopwatch,
  Coin,
  PieChart,
  DataAnalysis,
  Cpu,
} from '@element-plus/icons-vue'
import systemService from '@/service/systemService'
import { i18ns } from '@/locales'

interface SystemStats {
  server: {
    startedAt: number
    currentTime: number
    uptimeSeconds: number
    uptimeFormatted: string
  }
  buildInfo: {
    version: string
    commitHash: string
    commitHashShort: string
    branch: string
    commitMessage: string
    commitTime: string
    buildTime: string
  }
  runtime: {
    nodeVersion: string
    v8Version: string
    platform: string
    arch: string
    pid: number
    processTitle: string
    cwd: string
    cpuCores: number
    cpuModel: string
    osTotalMemory: number
    osFreeMemory: number
    osUptime: number
    hostname: string
  }
  memory: {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
    arrayBuffers: number
    heapUsagePercent: number
  }
  cpu: {
    user: number
    system: number
  }
  redis: {
    available: boolean
    circuitState: string
  }
  userCount: number
  groupCount: number
  permissionCount: number
  config: {
    nodeEnv: string
    port: number
    database: string
    redisHost: string
    redisPort: number
    redisDb: number
    captchaEnabled: boolean
    captchaProvider: string
    captchaFallbackProvider: string
    jwtAccessExpiresIn: string
    jwtRefreshExpiresIn: string
    corsAllowedOrigins: string
  }
  upTime: number
}

// Per-card loading states (all share the same API call, but shown independently)
const loadingMap = ref({
  server: false,
  resource: false,
  runtime: false,
  infra: false,
  build: false,
})

const isAnyLoading = computed(() => Object.values(loadingMap.value).some(Boolean))

const autoRefreshInterval = ref<number>(0)
const autoRefreshTimer = ref<ReturnType<typeof setInterval> | null>(null)

const stats = ref<SystemStats>({
  server: {
    startedAt: 0,
    currentTime: 0,
    uptimeSeconds: 0,
    uptimeFormatted: '0s',
  },
  buildInfo: {
    version: '',
    commitHash: '',
    commitHashShort: '',
    branch: '',
    commitMessage: '',
    commitTime: '',
    buildTime: '',
  },
  runtime: {
    nodeVersion: '',
    v8Version: '',
    platform: '',
    arch: '',
    pid: 0,
    processTitle: '',
    cwd: '',
    cpuCores: 0,
    cpuModel: '',
    osTotalMemory: 0,
    osFreeMemory: 0,
    osUptime: 0,
    hostname: '',
  },
  memory: {
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0,
    arrayBuffers: 0,
    heapUsagePercent: 0,
  },
  cpu: {
    user: 0,
    system: 0,
  },
  redis: {
    available: false,
    circuitState: 'unknown',
  },
  userCount: 0,
  groupCount: 0,
  permissionCount: 0,
  config: {
    nodeEnv: '',
    port: 0,
    database: '',
    redisHost: '',
    redisPort: 0,
    redisDb: 0,
    captchaEnabled: false,
    captchaProvider: 'none',
    captchaFallbackProvider: 'none',
    jwtAccessExpiresIn: '',
    jwtRefreshExpiresIn: '',
    corsAllowedOrigins: '',
  },
  upTime: 0,
})

const activeCollapse = ref('server')

const setAllLoading = (value: boolean) => {
  loadingMap.value.server = value
  loadingMap.value.resource = value
  loadingMap.value.runtime = value
  loadingMap.value.infra = value
  loadingMap.value.build = value
}

const loadStats = async (silent = false) => {
  if (!silent) {
    setAllLoading(true)
  }
  try {
    const data = await systemService.getSystemStats(silent)
    stats.value = data as SystemStats
  } catch (error) {
    if (!silent) {
      ElMessage.error(i18ns.t('SystemStats.loadFailed'))
    }
    console.error('Failed to load system stats:', error)
  } finally {
    if (!silent) {
      setAllLoading(false)
    }
  }
}

const loadAll = () => loadStats(false)

const onAutoRefreshChange = (val: number | null) => {
  if (autoRefreshTimer.value) {
    clearInterval(autoRefreshTimer.value)
    autoRefreshTimer.value = null
  }
  if (val && val > 0) {
    autoRefreshTimer.value = setInterval(() => {
      loadStats(true) // silent mode for auto-refresh
    }, val * 1000)
  }
}

const formatDatabaseDisplay = (url: string): string => {
  const idx = url.indexOf('?')
  return idx !== -1 ? url.slice(idx + 1) : '—'
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

const formatMicroseconds = (microseconds: number): string => {
  const seconds = microseconds / 1000000
  if (seconds < 60) return `${seconds.toFixed(2)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = (seconds % 60).toFixed(0)
  return `${minutes}m ${remainingSeconds}s`
}

const formatSeconds = (seconds: number): string => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const formatDateTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const getCircuitStateType = (state: string): 'success' | 'warning' | 'danger' => {
  if (state === 'closed') return 'success'
  if (state === 'half-open') return 'warning'
  return 'danger'
}

onMounted(() => {
  loadStats()
})

onUnmounted(() => {
  if (autoRefreshTimer.value) {
    clearInterval(autoRefreshTimer.value)
  }
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.system-stats-page {
  width: 100%;
  min-width: 0;
}

.stats-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  width: 100%;
  margin: 0 0 4px;
  gap: 12px;
  flex-wrap: wrap;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
  justify-content: flex-end;
}

.auto-refresh-box {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 6px 10px;
  min-width: 0;
}

.auto-refresh-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.auto-refresh-unit {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.system-stats-container {
  width: 100%;
  min-width: 0;
  padding: 0 0 20px;
}

.stats-card {
  border-radius: 8px;
  margin-bottom: 16px;
  width: 100%;
  min-width: 0;
}

.stats-card :deep(.el-card__header),
.stats-card :deep(.el-card__body) {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 14px;
  color: var(--el-color-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.el-col {
  margin-bottom: 18px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
}

.info-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.info-value {
  font-size: 14px;
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.info-value.code {
  font-family: 'Courier New', monospace;
  background: var(--el-fill-color);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 13px;
}

/* Mobile */
.mobile-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  gap: 8px;
  flex-wrap: wrap;
}

.system-stats-mobile-adapter {
  padding: 0 6px 16px;
}

.system-stats-mobile-adapter :deep(.el-card) {
  margin-bottom: 8px;
}

.system-stats-mobile-adapter :deep(.el-collapse) {
  border: none;
}

.system-stats-mobile-adapter :deep(.el-collapse-item__header) {
  font-weight: 600;
  font-size: 14px;
}

.system-stats-mobile-adapter :deep(.el-descriptions__label) {
  width: 40%;
  font-size: 13px;
}

.system-stats-mobile-adapter :deep(.el-descriptions__content) {
  width: 60%;
  font-size: 13px;
}
</style>
