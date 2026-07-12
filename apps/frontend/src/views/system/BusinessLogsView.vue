<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="business-logs-container">
      <el-card v-loading="loading" class="logs-card page-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span class="card-title">{{ i18ns.t('BusinessLogs.title') }}</span>
            <el-button type="primary" :icon="Refresh" :loading="loading" @click="loadLogs">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <BusinessLogsFilters
          :is-desktop="isDesktop"
          :filters="filters"
          :date-range="dateRange"
          :business-log-filter-options="businessLogFilterOptions"
          @filter-change="handleFilterChange"
          @date-range-change="handleDateRangeChange"
          @update:filters="updateFilters"
          @update:date-range="updateDateRange"
        />

        <BusinessLogsStatsSection
          :loading="statsLoading"
          :summary-cards="summaryCards"
          :daily-trend-option="dailyTrendOption"
          :type-pie-option="typePieOption"
          :category-bar-option="categoryBarOption"
          :status-pie-option="statusPieOption"
        />

        <BusinessLogsDesktopTable
          :logs="logs"
          :expanded-rows="expandedRows"
          :current-page="currentPage"
          :page-size="pageSize"
          :total="total"
          :format-timestamp="formatTimestamp"
          :format-json="formatJson"
          :get-category-type="getCategoryType"
          @expand-change="handleExpandChange"
          @page-change="handlePageChange"
          @size-change="handleSizeChange"
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
            <el-button type="primary" :icon="Refresh" :loading="loading" @click="loadLogs">
              {{ i18ns.t('refresh') }}
            </el-button>
          </div>
        </template>

        <BusinessLogsFilters
          :is-desktop="isDesktop"
          :filters="filters"
          :date-range="dateRange"
          :business-log-filter-options="businessLogFilterOptions"
          @filter-change="handleFilterChange"
          @date-range-change="handleDateRangeChange"
          @update:filters="updateFilters"
          @update:date-range="updateDateRange"
        />

        <BusinessLogsMobileList
          :logs="logs"
          :loading="loading"
          :current-page="currentPage"
          :page-size="pageSize"
          :total="total"
          :format-timestamp="formatTimestamp"
          :format-target="formatTarget"
          :format-json="formatJson"
          @page-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { usePageDevice } from '@/composables/usePageDevice'
import { usePagination } from '@/composables/usePagination'
import { i18ns } from '@/locales'
import systemService from '@/service/systemService'
import { isRequestCanceled } from '@/utils/error-utils'
import BusinessLogsDesktopTable from './business-logs/components/BusinessLogsDesktopTable.vue'
import BusinessLogsFilters from './business-logs/components/BusinessLogsFilters.vue'
import BusinessLogsMobileList from './business-logs/components/BusinessLogsMobileList.vue'
import BusinessLogsStatsSection from './business-logs/components/BusinessLogsStatsSection.vue'
import type {
  BusinessLogDateRange,
  BusinessLogDto,
  BusinessLogFilterOptionsResponse,
  BusinessLogFilters,
  BusinessLogStatsResponse,
  BusinessLogSummaryCard,
  CategoryTagType,
} from './business-logs/types'

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

const { isDesktop } = usePageDevice()

const logs = ref<BusinessLogDto[]>([])
const stats = ref<BusinessLogStatsResponse>(emptyStats())
const statsLoading = ref(false)
let latestStatsRequestId = 0
let activeStatsController: AbortController | null = null
const dateRange = ref<BusinessLogDateRange>(null)
const lastValidDateRange = ref<BusinessLogDateRange>(null)
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

const formatTimestamp = (timestamp: string) => new Date(timestamp).toLocaleString()
const formatNumber = (value: number) => new Intl.NumberFormat().format(value)

const summaryCards = computed<BusinessLogSummaryCard[]>(() => [
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

const getCategoryType = (category: string) => CATEGORY_TAG_TYPES[category] || 'info'

const handleExpandChange = (row: BusinessLogDto, expandedRowsData: BusinessLogDto[]) => {
  expandedRows.value = expandedRowsData.length > 0 ? [row.id] : []
}

function updateFilters(value: BusinessLogFilters) {
  filters.value = value
}

function updateDateRange(value: BusinessLogDateRange) {
  dateRange.value = value
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

const handleDateRangeChange = (value: BusinessLogDateRange) => {
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
  void loadLogs()
}

const handleSizeChange = (size: number) => {
  setPageSize(size)
  resetToFirstPage()
  void loadLogs()
}

onMounted(async () => {
  await Promise.allSettled([loadFilterOptions(), loadLogs(), loadStats()])
})
</script>

<style scoped>
.business-logs-container {
  width: 100%;
  min-width: 0;
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

@media (max-width: 768px) {
  .business-logs-container {
    padding: 10px;
  }

  :deep(.hide-on-mobile) {
    display: none;
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

.business-logs-mobile-adapter :deep(.el-pagination) {
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
