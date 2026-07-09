import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import { ipMonitoringService } from '@/service/ipMonitoringService'
import { ipBlacklistService } from '@/service/ipBlacklistService'
import { ipWhitelistService } from '@/service/ipWhitelistService'
import { ElMessageBox } from 'element-plus'
import { message } from '@/utils/message'
import type { FormInstance, FormRules } from 'element-plus'
import { i18ns } from '@/locales'
import systemService from '@/service/systemService'
import { normalizeIp } from '@/utils/ipaddr'
import type { IpErrorStatusResponse } from '@/client/types.gen'

interface DashboardData {
  activeBans: {
    total: number
    byLevel: { level1: number; level2: number; level3: number }
    byType: { auto: number; manual: number }
    recentBans: any[]
  }
  recentActivity: {
    last24Hours: number
    last7Days: number
    timeline: Array<{ date: string; count: number }>
  }
  topBannedIPs: Array<{
    ipAddress: string
    banCount: number
    lastBanTime: string
    currentStatus: 'banned' | 'unbanned'
  }>
}

interface IPBlacklistItem {
  id: string
  ipAddress: string
  expireTime: string
  banLevel: number
  banReason: string
  bannedBy?: string | null
  errorCount: number
  metadata?: any
  status: number
  createTime: string
  updateTime: string
}

interface IPWhitelistItem {
  id: string
  ipAddress: string
  reason?: string
  addedBy?: string
  expiresAt?: string
  createTime: string
}

export const useIpMonitoringDashboard = () => {
  const loading = ref(false)
  const dashboardData = ref<DashboardData | null>(null)
  let refreshTimer: number | null = null

  const queryIp = ref('')
  const queryLoading = ref(false)
  const adjustWeight = ref(0)
  const showAdjust = ref(false)
  const actionLoading = ref(false)
  const queryResult = ref<IpErrorStatusResponse | null>(null)
  const weightHistory = ref<Array<{ weight: number; time: number; ip: string }>>([])

  const blacklistData = ref<IPBlacklistItem[]>([])
  const blLoading = ref(false)
  const dialogVisible = ref(false)
  const isEdit = ref(false)
  const submitting = ref(false)
  const searchIP = ref('')
  const currentEditIP = ref('')
  const pagination = reactive({ page: 1, pageSize: 20, total: 0 })
  const formData = reactive({
    ipAddress: '',
    duration: 3600,
    banReason: '',
    expireTime: null as Date | null,
  })
  const formRef = ref<FormInstance>()

  const wlData = ref<IPWhitelistItem[]>([])
  const wlLoading = ref(false)
  const wlDialogVisible = ref(false)
  const wlSubmitting = ref(false)
  const wlPagination = reactive({ page: 1, pageSize: 20, total: 0 })
  const wlFormRef = ref<FormInstance>()
  const wlForm = reactive({ ipAddress: '', reason: '', expiresAt: null as Date | null })

  const { isDesktop } = usePageDevice()

  const formRules: FormRules = {
    ipAddress: [
      { required: true, message: i18ns.t('ipBlacklist.ipRequired'), trigger: 'blur' },
      {
        pattern: /^(\d{1,3}\.){3}\d{1,3}$/,
        message: i18ns.t('ipBlacklist.ipInvalid'),
        trigger: 'blur',
      },
    ],
    duration: [
      { required: true, message: i18ns.t('ipBlacklist.durationRequired'), trigger: 'change' },
    ],
    banReason: [{ max: 500, message: i18ns.t('ipBlacklist.reasonTooLong'), trigger: 'blur' }],
  }

  const wlFormRules: FormRules = {
    ipAddress: [
      { required: true, message: i18ns.t('ipWhitelist.ipRequired'), trigger: 'blur' },
      {
        pattern: /^(\d{1,3}\.){3}\d{1,3}$/,
        message: i18ns.t('ipWhitelist.ipInvalid'),
        trigger: 'blur',
      },
    ],
  }

  const handleQueryIpStatus = async () => {
    if (!queryIp.value.trim()) return
    queryLoading.value = true
    queryResult.value = null
    try {
      queryResult.value = await ipMonitoringService.getIpErrorStatus(queryIp.value.trim())
      if (queryResult.value) {
        const { ipAddress, errorWeight } = queryResult.value
        if (weightHistory.value.length && weightHistory.value[0]?.ip !== ipAddress) {
          weightHistory.value = []
        }
        weightHistory.value.push({ weight: errorWeight, time: Date.now(), ip: ipAddress })
        if (weightHistory.value.length > 10) {
          weightHistory.value.shift()
        }
      }
    } catch (error: any) {
      message.error(error.message || i18ns.t('ipMonitoring.queryFailed'))
    } finally {
      queryLoading.value = false
    }
  }

  const handleResetWeight = async () => {
    if (!queryResult.value) return
    actionLoading.value = true
    try {
      await ipMonitoringService.resetIpErrorWeight(queryResult.value.ipAddress)
      message.success(i18ns.t('ipMonitoring.weightReset'))
      queryResult.value = await ipMonitoringService.getIpErrorStatus(queryResult.value.ipAddress)
    } catch (error: any) {
      message.error(error.message || i18ns.t('ipMonitoring.operationFailed'))
    } finally {
      actionLoading.value = false
    }
  }

  const handleSetWeight = async () => {
    if (!queryResult.value) return
    actionLoading.value = true
    try {
      await ipMonitoringService.setIpErrorWeight(queryResult.value.ipAddress, adjustWeight.value)
      message.success(i18ns.t('ipMonitoring.weightAdjusted'))
      showAdjust.value = false
      queryResult.value = await ipMonitoringService.getIpErrorStatus(queryResult.value.ipAddress)
    } catch (error: any) {
      message.error(error.message || i18ns.t('ipMonitoring.operationFailed'))
    } finally {
      actionLoading.value = false
    }
  }

  const levelTagType = (level: number) => {
    if (level === 3) return 'danger'
    if (level === 2) return 'warning'
    if (level === 1) return ''
    return 'success'
  }

  const nextThreshold = (result: typeof queryResult.value) => {
    if (!result) return null
    if (result.currentLevel === 0) {
      return {
        label: 'Level 1',
        gap: parseFloat((result.thresholds.level1 - result.errorWeight).toFixed(2)),
      }
    }
    if (result.currentLevel === 1) {
      return {
        label: 'Level 2',
        gap: parseFloat((result.thresholds.level2 - result.errorWeight).toFixed(2)),
      }
    }
    if (result.currentLevel === 2) {
      return {
        label: 'Level 3',
        gap: parseFloat((result.thresholds.level3 - result.errorWeight).toFixed(2)),
      }
    }
    return null
  }

  const formatMinutes = (minutes: number) => {
    if (minutes < 60) return `${Math.ceil(minutes)} 分钟`
    if (minutes < 1440) return `${(minutes / 60).toFixed(1)} 小时`
    return `${(minutes / 1440).toFixed(1)} 天`
  }

  const decayEstimates = (result: typeof queryResult.value) => {
    if (!result || result.errorWeight <= 0) return null
    const { enabled, decayRate, minThreshold, interval } = result.decayConfig
    if (!enabled || decayRate <= 0) return null

    const factor = 1 - decayRate / 100
    if (factor <= 0) return { zeroTime: formatMinutes(interval), times: [] }

    const n = Math.ceil(Math.log(minThreshold / result.errorWeight) / Math.log(factor))
    if (n <= 0) return { zeroTime: formatMinutes(interval), times: [] }
    const zeroTime = formatMinutes(n * interval)

    const times: { label: string; time: string }[] = []
    const thresholds = [
      { label: 'Level 3', val: result.thresholds.level3 },
      { label: 'Level 2', val: result.thresholds.level2 },
      { label: 'Level 1', val: result.thresholds.level1 },
    ]
    for (const threshold of thresholds) {
      if (result.errorWeight < threshold.val) continue
      const nThreshold = Math.ceil(
        Math.log(threshold.val / result.errorWeight) / Math.log(factor),
      )
      times.push({ label: threshold.label, time: formatMinutes(nThreshold * interval) })
    }

    return { zeroTime, times }
  }

  const HTTP_STATUS_LABELS: Record<string, string> = {
    '400': 'Bad Request',
    '401': 'Unauthorized',
    '403': 'Forbidden',
    '404': 'Not Found',
    '422': 'Unprocessable Entity',
    '429': 'Too Many Requests',
    '500': 'Internal Server Error',
  }

  const formatBreakdownLabel = (item: {
    type: 'status' | 'custom'
    code: string
    description?: string
  }) => {
    if (item.type === 'status') {
      const description = item.description || HTTP_STATUS_LABELS[item.code]
      return description ? `HTTP ${item.code} ${description}` : `HTTP ${item.code}`
    }
    return `${i18ns.t('ipMonitoring.customLabel')} ${item.code}`
  }

  const getBreakdownTagType = (item: { type: 'status' | 'custom'; code: string }) => {
    if (item.type === 'custom') return 'warning'
    const code = parseInt(item.code, 10)
    if (code >= 500) return 'danger'
    if (code >= 400) return ''
    return 'info'
  }

  const trendEstimate = computed(() => {
    if (!queryResult.value || weightHistory.value.length < 2) return null
    const last = weightHistory.value[weightHistory.value.length - 1]
    const prev = weightHistory.value[weightHistory.value.length - 2]
    if (!last || !prev) return null
    const dt = (last.time - prev.time) / 60000
    if (dt < 0.05) return null
    const rate = (last.weight - prev.weight) / dt
    if (rate <= 0) return null
    const next = nextThreshold(queryResult.value)
    if (!next || next.gap <= 0) return null
    return { level: next.label, time: formatMinutes(next.gap / rate) }
  })

  const loadDashboard = async () => {
    loading.value = true
    try {
      dashboardData.value = await ipMonitoringService.getDashboard()
    } catch (error: any) {
      message.error(error.message || i18ns.t('ipMonitoring.loadFailed'))
    } finally {
      loading.value = false
    }
  }

  const loadBlacklist = async () => {
    blLoading.value = true
    try {
      const result = await ipBlacklistService.getAll(
        pagination.pageSize,
        (pagination.page - 1) * pagination.pageSize,
      )
      blacklistData.value = result.blacklists
      pagination.total = result.total
    } catch (error: any) {
      message.error(error.message || i18ns.t('ipBlacklist.loadFailed'))
    } finally {
      blLoading.value = false
    }
  }

  const handleCreate = () => {
    isEdit.value = false
    dialogVisible.value = true
  }

  const handleEdit = (row: IPBlacklistItem) => {
    isEdit.value = true
    currentEditIP.value = row.ipAddress
    formData.banReason = row.banReason || ''
    formData.expireTime = new Date(row.expireTime)
    dialogVisible.value = true
  }

  const handleUnbanRow = async (row: IPBlacklistItem) => {
    await ElMessageBox.confirm(
      i18ns.t('ipBlacklist.unbanConfirm', { ip: row.ipAddress }),
      i18ns.t('warning'),
      {
        confirmButtonText: i18ns.t('confirm'),
        cancelButtonText: i18ns.t('cancel'),
        type: 'warning',
      },
    )
    await ipBlacklistService.delete(row.ipAddress)
    message.success(i18ns.t('ipBlacklist.unbanSuccess'))
    await loadBlacklist()
  }

  const handleSubmit = async () => {
    if (!formRef.value) return
    try {
      await formRef.value.validate()
      submitting.value = true
      if (isEdit.value) {
        await ipBlacklistService.update(currentEditIP.value, {
          banReason: formData.banReason,
          expireTime: formData.expireTime?.toISOString(),
        })
        message.success(i18ns.t('ipBlacklist.updateSuccess'))
      } else {
        await ipBlacklistService.create({
          ipAddress: formData.ipAddress,
          duration: formData.duration,
          reason: formData.banReason,
        })
        message.success(i18ns.t('ipBlacklist.createSuccess'))
      }
      dialogVisible.value = false
      await loadBlacklist()
    } catch (error: any) {
      message.error(error.message || i18ns.t('ipBlacklist.submitFailed'))
    } finally {
      submitting.value = false
    }
  }

  const resetForm = () => {
    formData.ipAddress = ''
    formData.duration = 3600
    formData.banReason = ''
    formData.expireTime = null
    currentEditIP.value = ''
    formRef.value?.resetFields()
  }

  const handleSearch = () => {
    if (searchIP.value) {
      blacklistData.value = blacklistData.value.filter((item) => item.ipAddress.includes(searchIP.value))
    } else {
      loadBlacklist()
    }
  }

  const getBanLevelType = (level: number) => (level === 1 ? 'warning' : level >= 2 ? 'danger' : 'info')
  const isExpired = (time: string) => new Date(time) < new Date()
  const formatExpireTime = (time: string) =>
    new Date(time).getFullYear() >= 2099
      ? i18ns.t('ipBlacklist.permanent')
      : new Date(time).toLocaleString()

  const loadWhitelist = async () => {
    wlLoading.value = true
    try {
      const result = await ipWhitelistService.getAll(
        wlPagination.pageSize,
        (wlPagination.page - 1) * wlPagination.pageSize,
      )
      wlData.value = result.whitelists
      wlPagination.total = result.total
    } catch (error: any) {
      message.error(error.message || i18ns.t('ipWhitelist.loadFailed'))
    } finally {
      wlLoading.value = false
    }
  }

  const handleWlSubmit = async () => {
    if (!wlFormRef.value) return
    try {
      await wlFormRef.value.validate()
      wlSubmitting.value = true
      await ipWhitelistService.add({
        ipAddress: wlForm.ipAddress,
        reason: wlForm.reason || undefined,
        expiresAt: wlForm.expiresAt?.toISOString(),
      })
      message.success(i18ns.t('ipWhitelist.addSuccess'))
      wlDialogVisible.value = false
      wlForm.ipAddress = ''
      wlForm.reason = ''
      wlForm.expiresAt = null
      await loadWhitelist()
    } catch (error: any) {
      message.error(error.message || i18ns.t('ipWhitelist.submitFailed'))
    } finally {
      wlSubmitting.value = false
    }
  }

  const handleWlRemove = async (row: IPWhitelistItem) => {
    await ElMessageBox.confirm(
      i18ns.t('ipWhitelist.removeConfirm', { ip: row.ipAddress }),
      i18ns.t('warning'),
      {
        confirmButtonText: i18ns.t('confirm'),
        cancelButtonText: i18ns.t('cancel'),
        type: 'warning',
      },
    )
    try {
      await ipWhitelistService.remove(row.ipAddress)
      message.success(i18ns.t('ipWhitelist.removeSuccess'))
      await loadWhitelist()
    } catch (error: any) {
      message.error(error.message || i18ns.t('ipWhitelist.removeFailed'))
    }
  }

  const isWlExpired = (time?: string) => !!time && new Date(time) < new Date()
  const formatWlExpiry = (time?: string) => {
    if (!time) return i18ns.t('ipWhitelist.permanent')
    return isWlExpired(time)
      ? `${i18ns.t('ipWhitelist.expired')} (${new Date(time).toLocaleString()})`
      : new Date(time).toLocaleString()
  }

  onMounted(() => {
    loadDashboard()
    loadBlacklist()
    loadWhitelist()
    refreshTimer = window.setInterval(loadDashboard, 30000)
    if (!isDesktop.value) {
      useMobileTableCardLabels('.ip-monitor-mobile-adapter')
    }
    systemService
      .getClientIp()
      .then((ip) => {
        if (ip) queryIp.value = normalizeIp(ip)
      })
      .catch(() => {})
  })

  onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer)
  })

  return {
    actionLoading,
    adjustWeight,
    blacklistData,
    blLoading,
    dashboardData,
    decayEstimates,
    dialogVisible,
    formData,
    formRef,
    formRules,
    formatBreakdownLabel,
    formatExpireTime,
    formatWlExpiry,
    getBanLevelType,
    getBreakdownTagType,
    handleCreate,
    handleEdit,
    handleQueryIpStatus,
    handleResetWeight,
    handleSearch,
    handleSetWeight,
    handleSubmit,
    handleUnbanRow,
    handleWlRemove,
    handleWlSubmit,
    isDesktop,
    isEdit,
    isExpired,
    isWlExpired,
    levelTagType,
    loadBlacklist,
    loadDashboard,
    loadWhitelist,
    loading,
    nextThreshold,
    pagination,
    queryIp,
    queryLoading,
    queryResult,
    resetForm,
    searchIP,
    showAdjust,
    submitting,
    trendEstimate,
    wlData,
    wlDialogVisible,
    wlForm,
    wlFormRef,
    wlFormRules,
    wlLoading,
    wlPagination,
    wlSubmitting,
  }
}

export type IpMonitoringDashboardState = ReturnType<typeof useIpMonitoringDashboard>
