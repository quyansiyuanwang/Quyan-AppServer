import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import type {
  ServerLogContentDto,
  ServerLogFileInfoDto,
  ServerLogType,
  SystemLogServiceDto,
} from '@/client/types.gen'
import { usePageDevice } from '@/composables/usePageDevice'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'
import systemService from '@/service/systemService'
import { usePermissionStore } from '@/stores/permissionStore'
import { AsyncVChart } from '@/utils/asyncChart'

interface SystemLogStatsSummary {
  totalRequests: number
  successRequests: number
  redirectRequests: number
  clientErrorRequests: number
  serverErrorRequests: number
  uniqueUsers: number
  anonymousRequests: number
  uniqueIPs: number
}

interface SystemLogStatsDaily {
  date: string
  totalRequests: number
  successRequests: number
  clientErrorRequests: number
  serverErrorRequests: number
}

interface StatsBreakdownItem {
  key: string
  label: string
  count: number
  share: number
}

interface StatsDailyBreakdownItem {
  date: string
  key: string
  label: string
  count: number
}

interface SystemLogStats {
  range: {
    startDate: string
    endDate: string
    days: number
  }
  summary: SystemLogStatsSummary
  daily: SystemLogStatsDaily[]
  byMethod: StatsBreakdownItem[]
  byStatusCode: StatsBreakdownItem[]
  byPath: StatsBreakdownItem[]
  methodDailyDistribution: StatsDailyBreakdownItem[]
  statusDailyDistribution: StatsDailyBreakdownItem[]
  generatedAt: string
}

const emptyApiStats = (): SystemLogStats => ({
  range: {
    startDate: new Date().toISOString(),
    endDate: new Date().toISOString(),
    days: 1,
  },
  summary: {
    totalRequests: 0,
    successRequests: 0,
    redirectRequests: 0,
    clientErrorRequests: 0,
    serverErrorRequests: 0,
    uniqueUsers: 0,
    anonymousRequests: 0,
    uniqueIPs: 0,
  },
  daily: [],
  byMethod: [],
  byStatusCode: [],
  byPath: [],
  methodDailyDistribution: [],
  statusDailyDistribution: [],
  generatedAt: new Date().toISOString(),
})

export const useSystemLogs = () => {
  const { isDesktop } = usePageDevice()
  const permissionStore = usePermissionStore()

  const activeTab = ref<'api' | 'server'>('api')

  const apiLoading = ref(false)
  const apiStatsLoading = ref(false)
  const logs = ref<SystemLogServiceDto[]>([])
  const apiStats = ref<SystemLogStats>(emptyApiStats())
  const total = ref(0)
  const currentPage = ref(1)
  const pageSize = ref(20)
  const expandedRows = ref<string[]>([])
  const dateRange = ref<[Date, Date] | null>(null)
  const responseCache = ref<Record<string, unknown>>({})
  const responseLoading = ref<Record<string, boolean>>({})
  const requestHeadersCache = ref<Record<string, unknown>>({})
  const responseHeadersCache = ref<Record<string, unknown>>({})
  const requestSizeSourceCache = ref<Record<string, string | null>>({})
  const responseSizeFormattedCache = ref<Record<string, string | null>>({})

  const serverFilesLoading = ref(false)
  const serverContentLoading = ref(false)
  const serverLogType = ref<ServerLogType>('combined')
  const serverLogFiles = ref<ServerLogFileInfoDto[]>([])
  const selectedServerLogFileName = ref<string>('')
  const serverLogContent = ref<ServerLogContentDto | null>(null)
  const serverLines = ref(200)
  const serverSearch = ref('')

  const filters = ref({
    method: [] as string[],
    path: undefined as string | undefined,
    statusCode: [] as number[],
    user: undefined as string | undefined,
    requestID: undefined as string | undefined,
    ip: undefined as string | undefined,
    startDate: undefined as string | undefined,
    endDate: undefined as string | undefined,
  })

  const activeLoading = computed(() =>
    activeTab.value === 'api'
      ? apiLoading.value
      : serverFilesLoading.value || serverContentLoading.value,
  )

  const canViewApiLogs = computed(() =>
    permissionStore.hasAnyPermission(Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ),
  )

  const canViewServerLogs = computed(() =>
    permissionStore.hasPermission(Permission.SYSTEM_SERVER_LOG_READ),
  )

  const canViewAnyLogs = computed(() => canViewApiLogs.value || canViewServerLogs.value)

  const formatTimestamp = (timestamp: string) => new Date(timestamp).toLocaleString()

  const formatBytes = (bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '-'
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / 1024 / 1024).toFixed(2)}MB`
  }

  const formatNumber = (value: number) => new Intl.NumberFormat().format(value)

  const apiSummaryCards = computed(() => [
    {
      key: 'totalRequests',
      label: i18ns.t('SystemLogs.totalRequests'),
      value: formatNumber(apiStats.value.summary.totalRequests),
      hint: `${i18ns.t('SystemLogs.uniqueUsers')}: ${formatNumber(apiStats.value.summary.uniqueUsers)}`,
    },
    {
      key: 'successRequests',
      label: i18ns.t('SystemLogs.successRequests'),
      value: formatNumber(apiStats.value.summary.successRequests),
      hint: `${i18ns.t('SystemLogs.redirectRequests')}: ${formatNumber(apiStats.value.summary.redirectRequests)}`,
    },
    {
      key: 'clientErrorRequests',
      label: i18ns.t('SystemLogs.clientErrors'),
      value: formatNumber(apiStats.value.summary.clientErrorRequests),
      hint: `${i18ns.t('SystemLogs.serverErrors')}: ${formatNumber(apiStats.value.summary.serverErrorRequests)}`,
    },
    {
      key: 'uniqueIPs',
      label: i18ns.t('SystemLogs.uniqueIps'),
      value: formatNumber(apiStats.value.summary.uniqueIPs),
      hint: `${i18ns.t('SystemLogs.anonymousRequests')}: ${formatNumber(apiStats.value.summary.anonymousRequests)}`,
    },
  ])

  const apiDailyTrendOption = computed(() => ({
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { left: 36, right: 16, top: 24, bottom: 42 },
    xAxis: {
      type: 'category',
      data: apiStats.value.daily.map((item) => item.date),
    },
    yAxis: { type: 'value' },
    series: [
      {
        name: i18ns.t('SystemLogs.totalRequests'),
        type: 'line',
        smooth: true,
        data: apiStats.value.daily.map((item) => item.totalRequests),
      },
      {
        name: i18ns.t('SystemLogs.clientErrors'),
        type: 'line',
        smooth: true,
        data: apiStats.value.daily.map((item) => item.clientErrorRequests),
      },
      {
        name: i18ns.t('SystemLogs.serverErrors'),
        type: 'line',
        smooth: true,
        data: apiStats.value.daily.map((item) => item.serverErrorRequests),
      },
    ],
  }))

  const apiMethodPieOption = computed(() => ({
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
        data: apiStats.value.byMethod.map((item) => ({
          name: item.label,
          value: item.count,
        })),
      },
    ],
  }))

  const apiStatusBarOption = computed(() => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    grid: { left: 36, right: 16, top: 24, bottom: 60 },
    xAxis: {
      type: 'category',
      axisLabel: { rotate: 30 },
      data: apiStats.value.byStatusCode.map((item) => item.label),
    },
    yAxis: { type: 'value' },
    series: [
      {
        type: 'bar',
        data: apiStats.value.byStatusCode.map((item) => item.count),
      },
    ],
  }))

  const apiPathBarOption = computed(() => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    grid: { left: 120, right: 24, top: 24, bottom: 20 },
    xAxis: { type: 'value' },
    yAxis: {
      type: 'category',
      data: [...apiStats.value.byPath].reverse().map((item) => item.label),
    },
    series: [
      {
        type: 'bar',
        data: [...apiStats.value.byPath].reverse().map((item) => item.count),
        label: {
          show: true,
          position: 'right',
          formatter: ({ value }: { value: number }) => formatNumber(value),
        },
      },
    ],
  }))

  const maskSensitiveData = (obj: any): any => {
    if (obj === null || obj === undefined) return obj

    if (typeof obj === 'string') {
      if (obj.match(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/)) {
        return '***TOKEN_MASKED***'
      }
      return obj
    }

    if (Array.isArray(obj)) return obj.map(maskSensitiveData)

    if (typeof obj === 'object') {
      const masked: any = {}
      const sensitiveKeys = [
        'password',
        'token',
        'access_token',
        'refresh_token',
        'accessToken',
        'refreshToken',
        'secret',
        'apiKey',
        'api_key',
        'authorization',
      ]

      for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue
        const lowerKey = key.toLowerCase()
        masked[key] = sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))
          ? '***MASKED***'
          : maskSensitiveData(obj[key])
      }

      return masked
    }

    return obj
  }

  const formatJson = (data: unknown) => {
    if (data === null || data === undefined) return 'null'

    try {
      let parsed = data
      if (typeof data === 'string') {
        try {
          parsed = JSON.parse(data)
        } catch {
          parsed = data
        }
      }

      return JSON.stringify(maskSensitiveData(parsed), null, 2)
    } catch {
      return String(data)
    }
  }

  const getMethodType = (method: string) => {
    const methodMap: Record<string, 'success' | 'primary' | 'warning' | 'danger' | 'info'> = {
      GET: 'success',
      POST: 'primary',
      PUT: 'warning',
      DELETE: 'danger',
      PATCH: 'warning',
      OPTIONS: 'info',
      HEAD: 'info',
    }
    return methodMap[method] || 'info'
  }

  const getStatusType = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return 'success'
    if (statusCode >= 300 && statusCode < 400) return 'info'
    if (statusCode >= 400 && statusCode < 500) return 'warning'
    if (statusCode >= 500) return 'danger'
    return 'info'
  }

  const getRequestSizeSourceLabel = (source: string | null | undefined) => {
    if (source === 'content-length') return i18ns.t('SystemLogs.requestSizeFromContentLength')
    if (source === 'body-estimate') return i18ns.t('SystemLogs.requestSizeFromBodyEstimate')
    if (source === 'empty-body') return i18ns.t('SystemLogs.requestSizeEmptyBody')
    return '-'
  }

  const getResponseSizeDisplay = (rowId: string, fallback?: string | null) => {
    return responseSizeFormattedCache.value[rowId] ?? fallback ?? '-'
  }

  const fetchLogDetail = async (rowId: string) => {
    if (responseCache.value[rowId] !== undefined || responseLoading.value[rowId]) return

    responseLoading.value[rowId] = true
    try {
      const detail = await systemService.getSystemLogDetail(rowId)
      responseCache.value[rowId] = detail.response
      requestHeadersCache.value[rowId] = detail.requestHeaders
      responseHeadersCache.value[rowId] = detail.responseHeaders
      requestSizeSourceCache.value[rowId] = detail.requestSizeSource
      responseSizeFormattedCache.value[rowId] = detail.responseSizeFormatted
    } catch (error) {
      console.error('Failed to load log detail:', error)
      responseCache.value[rowId] = null
      requestHeadersCache.value[rowId] = null
      responseHeadersCache.value[rowId] = null
      requestSizeSourceCache.value[rowId] = null
      responseSizeFormattedCache.value[rowId] = null
    } finally {
      responseLoading.value[rowId] = false
    }
  }

  const handleExpandChange = async (
    row: SystemLogServiceDto,
    expandedRowsData: SystemLogServiceDto[],
  ) => {
    if (expandedRowsData.length > 0) {
      expandedRows.value = [row.id]
      await fetchLogDetail(row.id)
    } else {
      expandedRows.value = []
    }
  }

  const ensureLogDetailLoaded = async (row: SystemLogServiceDto) => {
    await fetchLogDetail(row.id)
  }

  const loadLogs = async () => {
    if (!canViewApiLogs.value) {
      logs.value = []
      total.value = 0
      return
    }

    apiLoading.value = true
    expandedRows.value = []
    responseCache.value = {}
    responseLoading.value = {}
    requestHeadersCache.value = {}
    responseHeadersCache.value = {}
    requestSizeSourceCache.value = {}
    responseSizeFormattedCache.value = {}

    try {
      const data = await systemService.getSystemLogs(currentPage.value, pageSize.value, {
        method: filters.value.method.length > 0 ? filters.value.method : undefined,
        path: filters.value.path || undefined,
        statusCode: filters.value.statusCode.length > 0 ? filters.value.statusCode : undefined,
        user: filters.value.user || undefined,
        requestID: filters.value.requestID || undefined,
        ip: filters.value.ip || undefined,
        startDate: filters.value.startDate || undefined,
        endDate: filters.value.endDate || undefined,
      })

      logs.value = data.logs
      total.value = data.total
    } catch (error) {
      ElMessage.error(i18ns.t('SystemLogs.loadFailed'))
      console.error('Failed to load system logs:', error)
    } finally {
      apiLoading.value = false
    }
  }

  const loadApiStats = async () => {
    if (!canViewApiLogs.value) {
      apiStats.value = emptyApiStats()
      return
    }

    apiStatsLoading.value = true
    try {
      apiStats.value = (await systemService.getSystemLogStats(
        {
          method: filters.value.method.length > 0 ? filters.value.method : undefined,
          path: filters.value.path || undefined,
          statusCode: filters.value.statusCode.length > 0 ? filters.value.statusCode : undefined,
          user: filters.value.user || undefined,
          requestID: filters.value.requestID || undefined,
          ip: filters.value.ip || undefined,
          startDate: filters.value.startDate || undefined,
          endDate: filters.value.endDate || undefined,
        },
        true,
      )) as SystemLogStats
    } catch (error) {
      ElMessage.error(i18ns.t('SystemLogs.loadStatsFailed'))
      console.error('Failed to load system log stats:', error)
    } finally {
      apiStatsLoading.value = false
    }
  }

  const loadServerLogFiles = async () => {
    if (!canViewServerLogs.value) {
      serverLogFiles.value = []
      selectedServerLogFileName.value = ''
      serverLogContent.value = null
      return
    }

    serverFilesLoading.value = true
    try {
      const data = await systemService.getServerLogFiles(serverLogType.value)
      serverLogFiles.value = data.files

      if (data.files.length === 0) {
        selectedServerLogFileName.value = ''
        serverLogContent.value = null
        return
      }

      const firstFile = data.files[0]
      if (!firstFile) {
        selectedServerLogFileName.value = ''
        serverLogContent.value = null
        return
      }

      const targetFileName = data.files.some((file) => file.name === selectedServerLogFileName.value)
        ? selectedServerLogFileName.value
        : firstFile.name

      selectedServerLogFileName.value = targetFileName
      await loadServerLogContent(targetFileName)
    } catch (error) {
      ElMessage.error(i18ns.t('SystemLogs.loadServerLogFilesFailed'))
      console.error('Failed to load server log files:', error)
    } finally {
      serverFilesLoading.value = false
    }
  }

  const loadServerLogContent = async (fileName?: string) => {
    if (!canViewServerLogs.value) {
      serverLogContent.value = null
      return
    }

    const targetFileName = fileName || selectedServerLogFileName.value
    if (!targetFileName) {
      serverLogContent.value = null
      return
    }

    serverContentLoading.value = true
    try {
      const data = await systemService.getServerLogContent(
        targetFileName,
        serverLines.value,
        serverSearch.value.trim() || undefined,
      )
      selectedServerLogFileName.value = targetFileName
      serverLogContent.value = data
    } catch (error) {
      ElMessage.error(i18ns.t('SystemLogs.loadServerLogContentFailed'))
      console.error('Failed to load server log content:', error)
    } finally {
      serverContentLoading.value = false
    }
  }

  const loadSelectedServerLogContent = async () => {
    await loadServerLogContent(selectedServerLogFileName.value)
  }

  const selectServerLogFile = async (fileName: string) => {
    if (fileName === selectedServerLogFileName.value && serverLogContent.value) return
    await loadServerLogContent(fileName)
  }

  const handleFilterChange = () => {
    currentPage.value = 1
    void Promise.all([loadLogs(), loadApiStats()])
  }

  const handleDateRangeChange = (value: [Date, Date] | null) => {
    if (value) {
      filters.value.startDate = value[0].toISOString()
      filters.value.endDate = value[1].toISOString()
    } else {
      filters.value.startDate = undefined
      filters.value.endDate = undefined
    }
    handleFilterChange()
  }

  const clearFilters = () => {
    filters.value = {
      method: [],
      path: undefined,
      statusCode: [],
      user: undefined,
      requestID: undefined,
      ip: undefined,
      startDate: undefined,
      endDate: undefined,
    }
    dateRange.value = null
    handleFilterChange()
  }

  const handlePageChange = (page: number) => {
    currentPage.value = page
    void loadLogs()
  }

  const handleSizeChange = (size: number) => {
    pageSize.value = size
    currentPage.value = 1
    void loadLogs()
  }

  const handleServerLogTypeChange = async () => {
    selectedServerLogFileName.value = ''
    serverLogContent.value = null
    await loadServerLogFiles()
  }

  const handleServerContentParamsChange = async () => {
    if (selectedServerLogFileName.value) {
      await loadServerLogContent(selectedServerLogFileName.value)
    }
  }

  const handleRefresh = async () => {
    if (activeTab.value === 'api') {
      await Promise.all([loadLogs(), loadApiStats()])
      return
    }

    await loadServerLogFiles()
  }

  const handleTabChange = async (name: string | number) => {
    if (name === 'server' && serverLogFiles.value.length === 0 && !serverFilesLoading.value) {
      await loadServerLogFiles()
    }
  }

  const normalizeActiveTab = () => {
    if (activeTab.value === 'api' && !canViewApiLogs.value && canViewServerLogs.value) {
      activeTab.value = 'server'
      return
    }

    if (activeTab.value === 'server' && !canViewServerLogs.value && canViewApiLogs.value) {
      activeTab.value = 'api'
    }
  }

  onMounted(async () => {
    normalizeActiveTab()

    const tasks: Promise<unknown>[] = []
    if (canViewApiLogs.value) tasks.push(loadLogs(), loadApiStats())
    if (canViewServerLogs.value) tasks.push(loadServerLogFiles())

    await Promise.all(tasks)
  })

  return {
    Refresh,
    AsyncVChart,
    i18ns,
    isDesktop,
    activeTab,
    apiLoading,
    apiStatsLoading,
    logs,
    apiStats,
    total,
    currentPage,
    pageSize,
    expandedRows,
    dateRange,
    responseCache,
    responseLoading,
    requestHeadersCache,
    responseHeadersCache,
    requestSizeSourceCache,
    responseSizeFormattedCache,
    serverFilesLoading,
    serverContentLoading,
    serverLogType,
    serverLogFiles,
    selectedServerLogFileName,
    serverLogContent,
    serverLines,
    serverSearch,
    filters,
    activeLoading,
    canViewApiLogs,
    canViewServerLogs,
    canViewAnyLogs,
    apiSummaryCards,
    apiDailyTrendOption,
    apiMethodPieOption,
    apiStatusBarOption,
    apiPathBarOption,
    formatTimestamp,
    formatBytes,
    formatJson,
    getMethodType,
    getStatusType,
    getRequestSizeSourceLabel,
    getResponseSizeDisplay,
    handleExpandChange,
    ensureLogDetailLoaded,
    loadSelectedServerLogContent,
    selectServerLogFile,
    handleFilterChange,
    handleDateRangeChange,
    clearFilters,
    handlePageChange,
    handleSizeChange,
    handleServerLogTypeChange,
    handleServerContentParamsChange,
    handleRefresh,
    handleTabChange,
    loadServerLogFiles,
  }
}

export type SystemLogsState = ReturnType<typeof useSystemLogs>
