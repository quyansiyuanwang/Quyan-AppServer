<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="business-logs-container">
      <el-card v-loading="loading" class="logs-card page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('BusinessLogs.title') }}</span>
            <el-button type="primary" :icon="Refresh" @click="loadLogs" :loading="loading">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <!-- Filters -->
        <div class="filters-container">
          <el-form :inline="true" :model="filters" class="toolbar-row">
            <el-form-item :label="i18ns.t('BusinessLogs.operationType')">
              <el-select
                v-model="filters.operationType"
                :placeholder="i18ns.t('BusinessLogs.filterByType')"
                clearable
                :style="isDesktop ? { width: '240px' } : { width: '100%' }"
                @change="handleFilterChange"
              >
                <el-option
                  v-for="option in businessLogFilterOptions.operationTypes"
                  :key="option"
                  :label="option"
                  :value="option"
                />
              </el-select>
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.operationCategory')">
              <el-select
                v-model="filters.operationCategory"
                :placeholder="i18ns.t('BusinessLogs.filterByCategory')"
                clearable
                :style="isDesktop ? { width: '220px' } : { width: '100%' }"
                @change="handleFilterChange"
              >
                <el-option
                  v-for="option in businessLogFilterOptions.operationCategories"
                  :key="option"
                  :label="option"
                  :value="option"
                />
              </el-select>
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.actor')">
              <el-input
                v-model="filters.actor"
                :placeholder="i18ns.t('BusinessLogs.filterByActor')"
                clearable
                style="width: 100%; max-width: 200px"
                @change="handleFilterChange"
              />
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.target')">
              <el-input
                v-model="filters.target"
                :placeholder="i18ns.t('BusinessLogs.filterByTarget')"
                clearable
                style="width: 100%; max-width: 200px"
                @change="handleFilterChange"
              />
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.status')">
              <el-select
                v-model="filters.success"
                :placeholder="i18ns.t('BusinessLogs.filterByStatus')"
                clearable
                :style="isDesktop ? { width: '160px' } : { width: '100%' }"
                @change="handleFilterChange"
              >
                <el-option :label="i18ns.t('BusinessLogs.success')" :value="true" />
                <el-option :label="i18ns.t('BusinessLogs.failed')" :value="false" />
              </el-select>
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.ipAddress')">
              <el-input
                v-model="filters.ip"
                :placeholder="i18ns.t('BusinessLogs.filterByIp')"
                clearable
                style="width: 100%; max-width: 200px"
                @change="handleFilterChange"
              />
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.dateRange')">
              <el-date-picker
                v-model="dateRange"
                type="datetimerange"
                :start-placeholder="i18ns.t('BusinessLogs.startDate')"
                :end-placeholder="i18ns.t('BusinessLogs.endDate')"
                :unlink-panels="true"
                style="width: 100%; max-width: 360px"
                @change="handleDateRangeChange"
              />
            </el-form-item>
          </el-form>
        </div>

        <div class="stats-section" v-loading="statsLoading">
          <el-row :gutter="16" class="summary-grid">
            <el-col v-for="item in summaryCards" :key="item.key" :xs="24" :sm="12" :lg="6">
              <el-card class="summary-card" shadow="hover">
                <div class="summary-label">{{ item.label }}</div>
                <div class="summary-value">{{ item.value }}</div>
                <div class="summary-hint">{{ item.hint }}</div>
              </el-card>
            </el-col>
          </el-row>

          <el-row :gutter="16" class="chart-grid">
            <el-col :xs="24" :lg="14">
              <el-card class="chart-card" shadow="never">
                <template #header>
                  <div class="card-header">
                    <span class="card-title">{{ i18ns.t('BusinessLogs.dailyTrend') }}</span>
                  </div>
                </template>
                <AsyncVChart class="chart" autoresize :option="dailyTrendOption" />
              </el-card>
            </el-col>
            <el-col :xs="24" :lg="10">
              <el-card class="chart-card" shadow="never">
                <template #header>
                  <div class="card-header">
                    <span class="card-title">{{
                      i18ns.t('BusinessLogs.operationTypeDistribution')
                    }}</span>
                  </div>
                </template>
                <AsyncVChart class="chart" autoresize :option="typePieOption" />
              </el-card>
            </el-col>
          </el-row>

          <el-row :gutter="16" class="chart-grid">
            <el-col :xs="24" :lg="12">
              <el-card class="chart-card" shadow="never">
                <template #header>
                  <div class="card-header">
                    <span class="card-title">{{
                      i18ns.t('BusinessLogs.categoryDistribution')
                    }}</span>
                  </div>
                </template>
                <AsyncVChart class="chart" autoresize :option="categoryBarOption" />
              </el-card>
            </el-col>
            <el-col :xs="24" :lg="12">
              <el-card class="chart-card" shadow="never">
                <template #header>
                  <div class="card-header">
                    <span class="card-title">{{ i18ns.t('BusinessLogs.statusDistribution') }}</span>
                  </div>
                </template>
                <AsyncVChart class="chart" autoresize :option="statusPieOption" />
              </el-card>
            </el-col>
          </el-row>
        </div>

        <el-table
          :data="logs"
          style="width: 100%"
          :expand-row-keys="expandedRows"
          row-key="id"
          @expand-change="handleExpandChange"
        >
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="expand-content">
                <div v-if="row.changes" class="expand-item">
                  <strong>{{ i18ns.t('BusinessLogs.changes') }}:</strong>
                  <pre>{{ formatJson(row.changes) }}</pre>
                </div>

                <div v-if="row.metadata" class="expand-item">
                  <strong>{{ i18ns.t('BusinessLogs.metadata') }}:</strong>
                  <pre>{{ formatJson(row.metadata) }}</pre>
                </div>

                <div v-if="row.errorMessage" class="expand-item">
                  <strong>{{ i18ns.t('BusinessLogs.errorMessage') }}:</strong>
                  <el-alert type="error" :closable="false">
                    {{ row.errorMessage }}
                  </el-alert>
                </div>

                <div v-if="row.requestId" class="expand-item">
                  <strong>{{ i18ns.t('BusinessLogs.requestId') }}:</strong>
                  <span>{{ row.requestId }}</span>
                </div>

                <div class="expand-item">
                  <strong>{{ i18ns.t('BusinessLogs.ipAddress') }}:</strong>
                  <span>{{ row.ipAddress }}</span>
                </div>

                <div v-if="row.userAgent" class="expand-item">
                  <strong>{{ i18ns.t('BusinessLogs.userAgent') }}:</strong>
                  <span>{{ row.userAgent }}</span>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column :label="i18ns.t('BusinessLogs.timestamp')" width="180">
            <template #default="{ row }">
              {{ formatTimestamp(row.createTime) }}
            </template>
          </el-table-column>

          <el-table-column
            :label="i18ns.t('BusinessLogs.operationType')"
            width="180"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              <el-tag size="small">
                {{ row.operationType }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column
            :label="i18ns.t('BusinessLogs.operationCategory')"
            width="150"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              <el-tag :type="getCategoryType(row.operationCategory)" size="small">
                {{ row.operationCategory }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column
            :label="i18ns.t('BusinessLogs.actor')"
            width="150"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              <el-tag v-if="row.actorUsername === null" type="info" size="small">
                {{ i18ns.t('BusinessLogs.system') }}
              </el-tag>
              <span v-else>{{ row.actorUsername }}</span>
            </template>
          </el-table-column>

          <el-table-column
            :label="i18ns.t('BusinessLogs.target')"
            width="200"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              <div v-if="row.targetUserId || row.targetUsername">
                <div v-if="row.targetUsername">{{ row.targetUsername }}</div>
                <div v-if="row.targetUserId" style="font-size: 12px; color: #909399">
                  ID: {{ row.targetUserId }}
                </div>
              </div>
              <div v-else-if="row.targetResourceId">
                {{ row.targetResourceType }}: {{ row.targetResourceId }}
              </div>
              <el-tag v-else type="info" size="small">-</el-tag>
            </template>
          </el-table-column>

          <el-table-column :label="i18ns.t('BusinessLogs.description')" min-width="300">
            <template #default="{ row }">
              {{ row.description }}
            </template>
          </el-table-column>

          <el-table-column :label="i18ns.t('BusinessLogs.status')" width="100">
            <template #default="{ row }">
              <el-tag :type="row.success ? 'success' : 'danger'" size="small">
                {{ row.success ? i18ns.t('BusinessLogs.success') : i18ns.t('BusinessLogs.failed') }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column
            :label="i18ns.t('BusinessLogs.ipAddress')"
            width="150"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              {{ row.ipAddress }}
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
          style="margin-top: 20px; justify-content: center"
        />
      </el-card>
    </div>
  </div>
  <div v-else class="mobile-page business-logs-mobile-adapter">
    <div class="business-logs-container">
      <el-card v-loading="loading" class="logs-card mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('BusinessLogs.title') }}</span>
            <el-button type="primary" :icon="Refresh" @click="loadLogs" :loading="loading">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <!-- Filters -->
        <div class="filters-container">
          <el-form :inline="true" :model="filters" class="toolbar-row">
            <el-form-item :label="i18ns.t('BusinessLogs.operationType')">
              <el-select
                v-model="filters.operationType"
                :placeholder="i18ns.t('BusinessLogs.filterByType')"
                clearable
                :style="isDesktop ? { width: '240px' } : { width: '100%' }"
                @change="handleFilterChange"
              >
                <el-option
                  v-for="option in businessLogFilterOptions.operationTypes"
                  :key="option"
                  :label="option"
                  :value="option"
                />
              </el-select>
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.operationCategory')">
              <el-select
                v-model="filters.operationCategory"
                :placeholder="i18ns.t('BusinessLogs.filterByCategory')"
                clearable
                :style="isDesktop ? { width: '220px' } : { width: '100%' }"
                @change="handleFilterChange"
              >
                <el-option
                  v-for="option in businessLogFilterOptions.operationCategories"
                  :key="option"
                  :label="option"
                  :value="option"
                />
              </el-select>
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.actor')">
              <el-input
                v-model="filters.actor"
                :placeholder="i18ns.t('BusinessLogs.filterByActor')"
                clearable
                style="width: 100%; max-width: 200px"
                @change="handleFilterChange"
              />
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.target')">
              <el-input
                v-model="filters.target"
                :placeholder="i18ns.t('BusinessLogs.filterByTarget')"
                clearable
                style="width: 100%; max-width: 200px"
                @change="handleFilterChange"
              />
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.status')">
              <el-select
                v-model="filters.success"
                :placeholder="i18ns.t('BusinessLogs.filterByStatus')"
                clearable
                :style="isDesktop ? { width: '160px' } : { width: '100%' }"
                @change="handleFilterChange"
              >
                <el-option :label="i18ns.t('BusinessLogs.success')" :value="true" />
                <el-option :label="i18ns.t('BusinessLogs.failed')" :value="false" />
              </el-select>
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.ipAddress')">
              <el-input
                v-model="filters.ip"
                :placeholder="i18ns.t('BusinessLogs.filterByIp')"
                clearable
                style="width: 100%; max-width: 200px"
                @change="handleFilterChange"
              />
            </el-form-item>

            <el-form-item :label="i18ns.t('BusinessLogs.dateRange')">
              <el-date-picker
                v-model="dateRange"
                type="datetimerange"
                :start-placeholder="i18ns.t('BusinessLogs.startDate')"
                :end-placeholder="i18ns.t('BusinessLogs.endDate')"
                :unlink-panels="true"
                style="width: 100%; max-width: 100%"
                @change="handleDateRangeChange"
              />
            </el-form-item>
          </el-form>
        </div>

        <el-skeleton :loading="loading" :rows="5" animated>
          <div v-if="logs.length" class="log-card-list">
            <el-card v-for="row in logs" :key="row.id" class="log-card mobile-card" shadow="never">
              <div class="log-head">
                <el-tag size="small">{{ row.operationType }}</el-tag>
                <el-tag :type="row.success ? 'success' : 'danger'" size="small">
                  {{
                    row.success ? i18ns.t('BusinessLogs.success') : i18ns.t('BusinessLogs.failed')
                  }}
                </el-tag>
              </div>

              <div class="log-meta">
                <div>
                  {{ i18ns.t('BusinessLogs.timestamp') }}: {{ formatTimestamp(row.createTime) }}
                </div>
                <div>
                  {{ i18ns.t('BusinessLogs.operationCategory') }}:
                  {{ row.operationCategory || '-' }}
                </div>
                <div>
                  {{ i18ns.t('BusinessLogs.actor') }}:
                  {{ row.actorUsername || i18ns.t('BusinessLogs.system') }}
                </div>
                <div>{{ i18ns.t('BusinessLogs.target') }}: {{ formatTarget(row) }}</div>
                <div>{{ i18ns.t('BusinessLogs.ipAddress') }}: {{ row.ipAddress || '-' }}</div>
                <div>{{ i18ns.t('BusinessLogs.description') }}: {{ row.description || '-' }}</div>
              </div>

              <el-collapse class="log-details" accordion>
                <el-collapse-item
                  :title="i18ns.t('BusinessLogs.changes')"
                  :name="`biz-log-${row.id}`"
                >
                  <div v-if="row.changes" class="expand-item">
                    <strong>{{ i18ns.t('BusinessLogs.changes') }}:</strong>
                    <pre>{{ formatJson(row.changes) }}</pre>
                  </div>
                  <div v-if="row.metadata" class="expand-item">
                    <strong>{{ i18ns.t('BusinessLogs.metadata') }}:</strong>
                    <pre>{{ formatJson(row.metadata) }}</pre>
                  </div>
                  <div v-if="row.errorMessage" class="expand-item">
                    <strong>{{ i18ns.t('BusinessLogs.errorMessage') }}:</strong>
                    <el-alert type="error" :closable="false">{{ row.errorMessage }}</el-alert>
                  </div>
                  <div v-if="row.requestId" class="expand-item">
                    <strong>{{ i18ns.t('BusinessLogs.requestId') }}:</strong>
                    <span>{{ row.requestId }}</span>
                  </div>
                  <div class="expand-item">
                    <strong>{{ i18ns.t('BusinessLogs.userAgent') }}:</strong>
                    <span>{{ row.userAgent || '-' }}</span>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </el-card>
          </div>
          <el-empty v-else />
        </el-skeleton>

        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="prev, pager, next"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
          class="pager-wrap"
        />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { usePagination } from '@/composables/usePagination'
import { isRequestCanceled } from '@/utils/error-utils'
import { computed, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import systemService from '@/service/systemService'
import { i18ns } from '@/locales'
import { AsyncVChart } from '@/utils/asyncChart'
import type {
  BusinessLogControllerGetBusinessLogsData,
  BusinessLogDto,
  BusinessLogFilterOptionsResponse,
} from '@/client/types.gen'

interface BusinessLogStatsSummary {
  totalLogs: number
  successLogs: number
  failedLogs: number
  uniqueActors: number
  systemTriggeredLogs: number
  uniqueTargets: number
  uniqueIPs: number
}

interface BusinessLogStatsBreakdown {
  key: string
  label: string
  count: number
  share: number
}

interface BusinessLogStatsDaily {
  date: string
  totalLogs: number
  successLogs: number
  failedLogs: number
}

interface BusinessLogStatsResponse {
  range: {
    startDate: string
    endDate: string
    days: number
  }
  summary: BusinessLogStatsSummary
  daily: BusinessLogStatsDaily[]
  byOperationType: BusinessLogStatsBreakdown[]
  byOperationCategory: BusinessLogStatsBreakdown[]
  bySuccess: BusinessLogStatsBreakdown[]
  operationTypeDailyDistribution: Array<{ date: string; key: string; label: string; count: number }>
  categoryDailyDistribution: Array<{ date: string; key: string; label: string; count: number }>
  generatedAt: string
}

const emptyStats = (): BusinessLogStatsResponse => ({
  range: {
    startDate: new Date().toISOString(),
    endDate: new Date().toISOString(),
    days: 1,
  },
  summary: {
    totalLogs: 0,
    successLogs: 0,
    failedLogs: 0,
    uniqueActors: 0,
    systemTriggeredLogs: 0,
    uniqueTargets: 0,
    uniqueIPs: 0,
  },
  daily: [],
  byOperationType: [],
  byOperationCategory: [],
  bySuccess: [],
  operationTypeDailyDistribution: [],
  categoryDailyDistribution: [],
  generatedAt: new Date().toISOString(),
})

type BusinessLogFilters = Omit<
  NonNullable<BusinessLogControllerGetBusinessLogsData['query']>,
  'page' | 'pageSize' | 'actorUserId' | 'targetUserId'
>
type CategoryTagType = 'success' | 'primary' | 'warning' | 'danger' | 'info'

const CATEGORY_TAG_TYPES: Record<string, CategoryTagType> = {
  AUTH: 'primary',
  USER_MANAGEMENT: 'success',
  PERMISSION: 'warning',
  GROUP_MANAGEMENT: 'info',
  SYSTEM: 'danger',
  RELAY: 'warning',
  BILLING: 'success',
  OJ_SUBMITTER: 'primary',
  SECURITY: 'danger',
  JSON_ENDPOINT: 'info',
  ARTICLE: 'success',
}

const BUSINESS_LOG_MAX_RANGE_DAYS = 30
const BUSINESS_LOG_MAX_RANGE_MS = BUSINESS_LOG_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000

const logs = ref<BusinessLogDto[]>([])
const stats = ref<BusinessLogStatsResponse>(emptyStats())
const statsLoading = ref(false)
let latestStatsRequestId = 0
let activeStatsController: AbortController | null = null
const dateRange = ref<[Date, Date] | null>(null)
const lastValidDateRange = ref<[Date, Date] | null>(null)
const expandedRows = ref<string[]>([])
const businessLogFilterOptions = ref<BusinessLogFilterOptionsResponse>({
  operationTypes: [],
  operationCategories: [],
})

const filters = ref<BusinessLogFilters>({
  operationType: undefined,
  operationCategory: undefined,
  actor: undefined,
  target: undefined,
  success: undefined,
  ip: undefined,
})

const {
  loading,
  page: currentPage,
  pageSize,
  total,
  resetToFirstPage,
  setPage,
  setPageSize,
  applyResult,
  beginRequest,
  isRequestCurrent,
  finalizeRequest,
} = usePagination({
  initialPage: 1,
  initialPageSize: 10,
  bounds: {
    pageSizeMax: 100,
    pageSizeDefault: 10,
  },
})

const formatTimestamp = (timestamp: string) => {
  return new Date(timestamp).toLocaleString()
}

const formatNumber = (value: number) => new Intl.NumberFormat().format(value)

const summaryCards = computed(() => [
  {
    key: 'totalLogs',
    label: i18ns.t('BusinessLogs.totalLogs'),
    value: formatNumber(stats.value.summary.totalLogs),
    hint: `${i18ns.t('BusinessLogs.uniqueActors')}: ${formatNumber(stats.value.summary.uniqueActors)}`,
  },
  {
    key: 'successLogs',
    label: i18ns.t('BusinessLogs.successLogs'),
    value: formatNumber(stats.value.summary.successLogs),
    hint: `${i18ns.t('BusinessLogs.failedLogs')}: ${formatNumber(stats.value.summary.failedLogs)}`,
  },
  {
    key: 'uniqueTargets',
    label: i18ns.t('BusinessLogs.uniqueTargets'),
    value: formatNumber(stats.value.summary.uniqueTargets),
    hint: `${i18ns.t('BusinessLogs.systemTriggeredLogs')}: ${formatNumber(stats.value.summary.systemTriggeredLogs)}`,
  },
  {
    key: 'uniqueIPs',
    label: i18ns.t('BusinessLogs.uniqueIps'),
    value: formatNumber(stats.value.summary.uniqueIPs),
    hint: `${i18ns.t('BusinessLogs.dateSpanDays', { days: stats.value.range.days })}`,
  },
])

const dailyTrendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { bottom: 0 },
  grid: { left: 36, right: 16, top: 24, bottom: 42 },
  xAxis: { type: 'category', data: stats.value.daily.map((item) => item.date) },
  yAxis: { type: 'value' },
  series: [
    {
      name: i18ns.t('BusinessLogs.totalLogs'),
      type: 'line',
      smooth: true,
      data: stats.value.daily.map((item) => item.totalLogs),
    },
    {
      name: i18ns.t('BusinessLogs.failedLogs'),
      type: 'line',
      smooth: true,
      data: stats.value.daily.map((item) => item.failedLogs),
    },
  ],
}))

const typePieOption = computed(() => ({
  tooltip: { trigger: 'item' },
  legend: { bottom: 0 },
  series: [
    {
      type: 'pie',
      radius: ['35%', '70%'],
      data: stats.value.byOperationType.map((item) => ({ name: item.label, value: item.count })),
    },
  ],
}))

const categoryBarOption = computed(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  grid: { left: 36, right: 16, top: 24, bottom: 60 },
  xAxis: {
    type: 'category',
    axisLabel: { rotate: 25 },
    data: stats.value.byOperationCategory.map((item) => item.label),
  },
  yAxis: { type: 'value' },
  series: [
    {
      type: 'bar',
      data: stats.value.byOperationCategory.map((item) => item.count),
    },
  ],
}))

const statusPieOption = computed(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (params: { name: string; value: number }) =>
      `${params.name}: ${formatNumber(params.value)}`,
  },
  legend: { bottom: 0 },
  series: [
    {
      type: 'pie',
      radius: ['35%', '70%'],
      data: stats.value.bySuccess.map((item) => ({
        name:
          item.key === 'success' ? i18ns.t('BusinessLogs.success') : i18ns.t('BusinessLogs.failed'),
        value: item.count,
      })),
    },
  ],
}))

const formatJson = (data: unknown) => {
  if (data === null || data === undefined) {
    return 'null'
  }
  try {
    let parsed = data
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data)
      } catch {
        parsed = data
      }
    }
    return JSON.stringify(parsed, null, 2)
  } catch {
    return String(data)
  }
}

const formatTarget = (row: BusinessLogDto) => {
  if (row.targetUserId || row.targetUsername) {
    if (row.targetUsername && row.targetUserId) {
      return `${row.targetUsername} (ID: ${row.targetUserId})`
    }
    return row.targetUsername || row.targetUserId || '-'
  }
  if (row.targetResourceId) {
    return `${row.targetResourceType || 'Resource'}: ${row.targetResourceId}`
  }
  return '-'
}

const getCategoryType = (category: string) => {
  return CATEGORY_TAG_TYPES[category] || 'info'
}

const handleExpandChange = (row: BusinessLogDto, expandedRowsData: BusinessLogDto[]) => {
  // Only allow one row to be expanded at a time
  if (expandedRowsData.length > 0) {
    expandedRows.value = [row.id]
  } else {
    expandedRows.value = []
  }
}

const loadLogs = async () => {
  const requestContext = beginRequest()

  try {
    const filterParams: BusinessLogFilters = {
      operationType: filters.value.operationType || undefined,
      operationCategory: filters.value.operationCategory || undefined,
      actor: filters.value.actor || undefined,
      target: filters.value.target || undefined,
      startDate: filters.value.startDate || undefined,
      endDate: filters.value.endDate || undefined,
      success: filters.value.success,
      ip: filters.value.ip || undefined,
    }

    const data = await systemService.getBusinessLogs(
      currentPage.value,
      pageSize.value,
      filterParams,
      requestContext.signal,
    )

    if (!isRequestCurrent(requestContext.requestId)) return

    logs.value = data.logs
    applyResult(data)
  } catch (error) {
    if (!isRequestCurrent(requestContext.requestId) || isRequestCanceled(error)) return

    ElMessage.error(i18ns.t('BusinessLogs.loadFailed'))
    console.error('Failed to load business logs:', error)
  } finally {
    if (!isRequestCurrent(requestContext.requestId)) return
    finalizeRequest(requestContext)
  }
}

const loadStats = async () => {
  const requestId = ++latestStatsRequestId
  activeStatsController?.abort()
  const controller = new AbortController()
  activeStatsController = controller

  try {
    const filterParams: BusinessLogFilters = {
      operationType: filters.value.operationType || undefined,
      operationCategory: filters.value.operationCategory || undefined,
      actor: filters.value.actor || undefined,
      target: filters.value.target || undefined,
      startDate: filters.value.startDate || undefined,
      endDate: filters.value.endDate || undefined,
      success: filters.value.success,
      ip: filters.value.ip || undefined,
    }

    statsLoading.value = true
    const data = (await systemService.getBusinessLogStats(
      filterParams,
      controller.signal,
    )) as BusinessLogStatsResponse

    if (requestId !== latestStatsRequestId) return
    stats.value = data
  } catch (error) {
    if (requestId !== latestStatsRequestId || isRequestCanceled(error)) return
    ElMessage.error(i18ns.t('BusinessLogs.loadStatsFailed'))
    console.error('Failed to load business log stats:', error)
  } finally {
    if (requestId !== latestStatsRequestId) return
    if (activeStatsController === controller) activeStatsController = null
    statsLoading.value = false
  }
}

const loadFilterOptions = async () => {
  try {
    businessLogFilterOptions.value = await systemService.getBusinessLogFilterOptions()
  } catch (error) {
    ElMessage.error(i18ns.t('BusinessLogs.loadOptionsFailed'))
    console.error('Failed to load business log filter options:', error)
  }
}

const handleFilterChange = () => {
  resetToFirstPage()
  void Promise.all([loadLogs(), loadStats()])
}

const handleDateRangeChange = (value: [Date, Date] | null) => {
  if (value) {
    const start = value[0].getTime()
    const end = value[1].getTime()

    if (end < start || end - start > BUSINESS_LOG_MAX_RANGE_MS) {
      ElMessage.warning(
        i18ns.t('BusinessLogs.dateRangeLimit', { days: BUSINESS_LOG_MAX_RANGE_DAYS }),
      )
      dateRange.value = lastValidDateRange.value
        ? [new Date(lastValidDateRange.value[0]), new Date(lastValidDateRange.value[1])]
        : null
      return
    }

    lastValidDateRange.value = [new Date(value[0]), new Date(value[1])]
    filters.value.startDate = value[0].toISOString()
    filters.value.endDate = value[1].toISOString()
  } else {
    lastValidDateRange.value = null
    filters.value.startDate = undefined
    filters.value.endDate = undefined
  }

  handleFilterChange()
}

const handlePageChange = (page: number) => {
  setPage(page)
  loadLogs()
}

const handleSizeChange = (size: number) => {
  setPageSize(size)
  resetToFirstPage()
  loadLogs()
}

onMounted(async () => {
  await Promise.allSettled([loadFilterOptions(), loadLogs(), loadStats()])
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.business-logs-container {
  padding: 20px;
}

.logs-card {
  border-radius: 8px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 18px;
  font-weight: 600;
}

.filters-container {
  margin-bottom: 20px;
  padding: 15px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.stats-section {
  margin-bottom: 20px;
}

.summary-grid,
.chart-grid {
  margin-bottom: 16px;
}

.summary-card,
.chart-card {
  border-radius: 10px;
}

.summary-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.summary-value {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 700;
}

.summary-hint {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.chart {
  height: 320px;
}

.expand-content {
  padding: 8px 10px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.expand-item {
  margin-bottom: 6px;
}

.expand-item:last-child {
  margin-bottom: 0;
}

.expand-item strong {
  display: block;
  margin-bottom: 3px;
  color: #606266;
  line-height: 1.25;
}

.expand-item pre {
  background-color: #fff;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.35;
  margin: 0;
}

/* 暗色模式适配 */
html.dark .filters-container {
  background-color: #1a1a1a;
}

html.dark .expand-content {
  background-color: #1a1a1a;
}

html.dark .expand-item strong {
  color: #e5e7eb;
}

html.dark .expand-item pre {
  background-color: #262626;
  border-color: #404040;
  color: #e5e7eb;
}

@media (max-width: 768px) {
  .business-logs-container {
    padding: 10px;
  }

  .filters-container {
    padding: 10px;
  }

  :deep(.hide-on-mobile) {
    display: none;
  }
}

@media (max-width: 480px) {
  .filters-container .el-form--inline {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .filters-container .el-form-item {
    margin-right: 0;
    margin-bottom: 12px;
    width: 100%;
  }
  .filters-container .el-form-item__content,
  .filters-container .el-select,
  .filters-container .el-input {
    width: 100% !important;
  }
}
</style>

<style scoped>
.business-logs-mobile-adapter {
  padding: 8px 6px 16px;
  overflow-x: hidden;
}

.business-logs-mobile-adapter :deep(.hide-on-mobile),
.business-logs-mobile-adapter :deep(.el-scrollbar__bar.is-horizontal) {
  display: none !important;
}

.business-logs-mobile-adapter :deep(.el-form--inline),
.business-logs-mobile-adapter :deep(.card-header),
.business-logs-mobile-adapter :deep(.tab-header) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.business-logs-mobile-adapter :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 10px;
}

.business-logs-mobile-adapter :deep(.el-form-item__label) {
  float: none;
  display: block;
  text-align: left;
  padding: 0 0 6px;
}

.business-logs-mobile-adapter :deep(.el-form-item__content) {
  margin-left: 0 !important;
}

.business-logs-mobile-adapter :deep(.el-input),
.business-logs-mobile-adapter :deep(.el-select),
.business-logs-mobile-adapter :deep(.el-date-editor),
.business-logs-mobile-adapter :deep(.el-input-number),
.business-logs-mobile-adapter :deep(.el-textarea),
.business-logs-mobile-adapter :deep(.el-button) {
  width: 100%;
}

.log-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.log-card {
  border: 1px solid var(--el-border-color-lighter);
}

.log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.log-meta {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.log-details {
  margin-top: 6px;
}

.log-details :deep(.el-collapse-item__header) {
  min-height: 34px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  padding: 0 8px;
  background: var(--el-fill-color-light);
}

.business-logs-mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.business-logs-mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.pager-wrap {
  margin-top: 12px;
}

.business-logs-mobile-adapter :deep(.el-pagination) {
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
