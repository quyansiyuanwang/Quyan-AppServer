import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import { monthlyPassService } from '@/service/monthlyPassService'
import { configService } from '@/service/configService'
import { groupService } from '@/service/groupService'
import { modelPricingService } from '@/service/modelPricingService'
import { relayChannelService } from '@/service/relayChannelService'
import { userService } from '@/service/userService'
import { Permission } from '@/constant/permission'
import { MANAGED_STATUS } from '@/constant/status'
import { usePermissionStore } from '@/stores/permissionStore'
import type {
  AssignBatchUserMonthlyPassRequest,
  AssignUserMonthlyPassRequest,
  BatchAssignUserMonthlyPassResponse,
  MonthlyPassAssignmentMode,
  MonthlyPassQuotaWindowDto,
  MonthlyPassQuotaWindowInputDto,
  MonthlyPassTemplateDto,
  MonthlyPassTemplatePublishStatus,
  MonthlyPassUsageDto,
  UpdateMonthlyPassTemplateRequest,
  UpdateUserMonthlyPassRequest,
  UserMonthlyPassDto,
} from '@/client/types.gen'
import { PermissionService } from '@/service/permissionService'

export type TabKey = 'templates' | 'assignments' | 'usages'
export type QuotaUnit = 'amount' | 'request' | 'token'

export interface ChannelOption {
  value: string
  label: string
  name: string
  allowedModels: string[] | null
}

export interface UserOption {
  id: string
  username: string
}

export interface GroupOption {
  id: string
  username: string
  name: string
}

export interface EditableQuotaWindow {
  id: string
  quotaLimit: number | null
  quotaUnit: QuotaUnit
  quotaWindowHours: number | undefined
  days: number
  hours: number
}

export const MAX_AMOUNT_QUOTA = 999999.9999
const MAX_INTEGER_QUOTA = 999999
const MAX_QUOTA_WINDOW_HOURS = 720
const MAX_QUOTA_WINDOW_DAYS = Math.floor(MAX_QUOTA_WINDOW_HOURS / 24)
const MAX_QUOTA_WINDOW_HOUR_PART = 23
const USER_OPTIONS_PAGE_SIZE = 50
const DAY_MS = 24 * 60 * 60 * 1000

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

const round4 = (value: number) => Math.round(value * 10000) / 10000
const round2 = (value: number) => Math.round(value * 100) / 100

export const normalizeQuotaUnit = (value?: string): QuotaUnit => {
  if (value === 'request' || value === 'token') return value
  return 'amount'
}

export const isIntegerQuotaUnit = (value?: string): boolean => {
  const unit = normalizeQuotaUnit(value)
  return unit === 'request' || unit === 'token'
}

export const getQuotaMax = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? MAX_INTEGER_QUOTA : MAX_AMOUNT_QUOTA
}

export const getQuotaMin = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 1 : 0.0001
}

export const getQuotaPrecision = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 0 : 4
}

export const getQuotaStep = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 1 : 0.0001
}

const normalizeOptionalPositiveInteger = (value: unknown): number | undefined => {
  if (value == null || value === '') return undefined
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return Math.floor(numeric)
}

export const normalizeQuotaForSubmit = (value: number, unit?: string): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return numeric
  if (isIntegerQuotaUnit(unit)) return Math.floor(numeric)
  return Number(numeric.toFixed(4))
}

const normalizeQuotaForUnitSwitch = (value: number, unit?: string): number => {
  const normalized = normalizeQuotaForSubmit(value, unit)
  if (!Number.isFinite(normalized)) return normalized

  const clamped = Math.min(getQuotaMax(unit), Math.max(getQuotaMin(unit), normalized))
  return isIntegerQuotaUnit(unit) ? Math.floor(clamped) : Number(clamped.toFixed(4))
}

export const formatDateTime = (value?: string) => {
  if (!value) return '-'
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return value
  return time.toLocaleString()
}

export const formatAmount = (value?: number) => {
  if (value == null) return '-'
  return Number(value).toFixed(4)
}

export const formatPriceValue = (value?: number) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return numeric.toFixed(4)
}

export const formatPercentValue = (value?: number) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return `${numeric.toFixed(2)}%`
}

export const formatRatioValue = (value?: number | null) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return numeric.toFixed(4)
}

export const formatQuotaValue = (value?: number, unit?: string) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  if (isIntegerQuotaUnit(unit)) return String(Math.floor(numeric))
  return numeric.toFixed(4)
}

export const formatDailyQuota = (value?: number, unit?: string) => {
  if (value == null) return i18ns.t('monthlyPass.unlimited')
  return formatQuotaValue(value, unit)
}

export const formatQuotaUnit = (value?: string) => {
  const unit = normalizeQuotaUnit(value)
  if (unit === 'request') return i18ns.t('monthlyPass.quotaUnitRequest')
  if (unit === 'token') return i18ns.t('monthlyPass.quotaUnitToken')
  return i18ns.t('monthlyPass.quotaUnitAmount')
}

const normalizeQuotaWindowHours = (value?: number): number | undefined => {
  if (value == null) return undefined
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return Math.min(Math.floor(numeric), MAX_QUOTA_WINDOW_HOURS)
}

const clampNonNegativeInteger = (value: unknown, max: number): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.min(Math.floor(numeric), max)
}

const splitQuotaWindowParts = (value?: number) => {
  const normalized = normalizeQuotaWindowHours(value)
  if (!normalized) {
    return {
      days: 0,
      hours: 0,
    }
  }

  return {
    days: Math.floor(normalized / 24),
    hours: normalized % 24,
  }
}

const combineQuotaWindowParts = (daysValue: unknown, hoursValue: unknown): number | undefined => {
  const days = clampNonNegativeInteger(daysValue, MAX_QUOTA_WINDOW_DAYS)
  const hours = clampNonNegativeInteger(hoursValue, MAX_QUOTA_WINDOW_HOUR_PART)
  const totalHours = days * 24 + hours
  return normalizeQuotaWindowHours(totalHours)
}

export const formatQuotaWindowLabel = (hours: number) => {
  const normalized = normalizeQuotaWindowHours(hours)
  if (!normalized) return '-'
  const hoursLabel = `${normalized}${i18ns.t('monthlyPass.hoursUnit')}`
  if (normalized % 24 !== 0) return hoursLabel

  const days = normalized / 24
  return `${hoursLabel} (${days}${i18ns.t('monthlyPass.daysUnit')})`
}

export const formatQuotaWindowHours = (value?: number) => {
  const normalized = normalizeQuotaWindowHours(value)
  if (!normalized) return i18ns.t('monthlyPass.unlimited')
  return formatQuotaWindowLabel(normalized)
}

const parseDate = (value?: string): Date | null => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

const toIso = (date: Date): string => date.toISOString()

const getDefaultStartAt = () => new Date().toISOString()
const getDefaultEndAt = () => new Date(Date.now() + 30 * DAY_MS).toISOString()

const statusLabel = (status: number) => {
  if (status === MANAGED_STATUS.ENABLED) return i18ns.t('monthlyPass.enabled')
  return i18ns.t('monthlyPass.disabled')
}

const publishStatusLabel = (status?: MonthlyPassTemplatePublishStatus) => {
  if (status === 'published') return i18ns.t('monthlyPass.published')
  return i18ns.t('monthlyPass.draft')
}

const publishStatusTagType = (status?: MonthlyPassTemplatePublishStatus) => {
  return status === 'published' ? 'success' : 'info'
}

const canPublishTemplate = (row: MonthlyPassTemplateDto) => {
  return row.publishStatus !== 'published' && row.status === MANAGED_STATUS.ENABLED
}

const canUnpublishTemplate = (row: MonthlyPassTemplateDto) => {
  return row.publishStatus === 'published'
}

const formatAllowedModels = (allowedModels?: string[]) => {
  if (!allowedModels || allowedModels.length === 0) return i18ns.t('monthlyPass.allModels')
  return allowedModels.join(', ')
}

export const useMonthlyPassManagement = () => {
  const { isDesktop } = usePageDevice()
  const permissionStore = usePermissionStore()

  const canReadTemplates = computed(() =>
    permissionStore.hasPermission(Permission.MONTHLY_PASS_TEMPLATE_READ),
  )
  const canWriteTemplates = computed(() =>
    permissionStore.hasPermission(Permission.MONTHLY_PASS_TEMPLATE_WRITE),
  )
  const canReadAssignments = computed(() =>
    permissionStore.hasPermission(Permission.MONTHLY_PASS_ASSIGNMENT_READ),
  )
  const canWriteAssignments = computed(() =>
    permissionStore.hasPermission(Permission.MONTHLY_PASS_ASSIGNMENT_WRITE),
  )
  const canReadUsages = computed(() =>
    permissionStore.hasPermission(Permission.MONTHLY_PASS_USAGE_READ),
  )

  const hasAnyReadPermission = computed(
    () => canReadTemplates.value || canReadAssignments.value || canReadUsages.value,
  )

  const activeTab = ref<TabKey>('templates')
  const refreshing = ref(false)

  const loadingTemplates = ref(false)
  const loadingAssignments = ref(false)
  const loadingUsages = ref(false)

  const templates = ref<MonthlyPassTemplateDto[]>([])
  const userPasses = ref<UserMonthlyPassDto[]>([])
  const usageRecords = ref<MonthlyPassUsageDto[]>([])

  const modelOptions = ref<string[]>([])
  const channelOptions = ref<ChannelOption[]>([])
  const groupOptions = ref<GroupOption[]>([])
  const userOptions = ref<UserOption[]>([])
  const templateOptions = ref<MonthlyPassTemplateDto[]>([])
  const userOptionsLoading = ref(false)
  const batchUserOptions = ref<UserOption[]>([])
  const batchUserOptionsLoading = ref(false)
  const batchAssignmentResult = ref<BatchAssignUserMonthlyPassResponse | null>(null)

  const templateFilters = reactive({
    keyword: '',
    status: '' as number | '',
  })

  const assignmentFilters = reactive({
    userId: '',
    templateId: '',
    status: '' as number | '',
  })

  const usageFilters = reactive({
    userId: '',
    templateId: '',
    model: '',
    startTime: '',
    endTime: '',
  })

  const usageDateRange = ref<[string, string] | null>(null)

  const templatePagination = reactive({
    page: 1,
    pageSize: 20,
    total: 0,
  })

  const billingRechargeRatio = ref<number | null>(null)

  const assignmentPagination = reactive({
    page: 1,
    pageSize: 20,
    total: 0,
  })

  const usagePagination = reactive({
    page: 1,
    pageSize: 20,
    total: 0,
  })

  const showTemplateDialog = ref(false)
  const editingTemplateId = ref<string | null>(null)
  const templateDialogMode = ref<'create' | 'edit' | 'copy'>('create')
  const savingTemplate = ref(false)

  const templateForm = reactive({
    name: '',
    description: '',
    originalPrice: 1,
    discountPercent: 100,
    allowBalanceRedemption: true,
    purchaseLimitPerUser: undefined as number | undefined,
    purchaseLimitWindowDays: undefined as number | undefined,
    dailyQuota: undefined as number | undefined,
    rechargeRatioSnapshot: undefined as number | undefined,
    quotaWindows: [] as EditableQuotaWindow[],
    allowedModels: [] as string[],
    allowedChannels: [] as string[],
    status: MANAGED_STATUS.ENABLED as number,
  })

  const showAssignmentDialog = ref(false)
  const editingAssignmentId = ref<string | null>(null)
  const savingAssignment = ref(false)

  const assignmentForm = reactive({
    batchMode: false,
    userId: '',
    userIds: [] as string[],
    assignmentMode: 'create_new' as MonthlyPassAssignmentMode,
    batchKeyword: '',
    batchGroupId: '',
    includeAllVisible: false,
    templateId: '',
    startAt: '',
    endAt: '',
    totalQuota: null as number | null,
    dailyQuota: undefined as number | undefined,
    quotaUnit: 'amount' as QuotaUnit,
    quotaWindows: [] as EditableQuotaWindow[],
    note: '',
    status: MANAGED_STATUS.ENABLED as number,
  })

  const quickDurationDays = ref<number | undefined>(7)
  let editableQuotaWindowSeed = 0

  const userNameById = computed(() => {
    return new Map(userOptions.value.map((item) => [item.id, item.username]))
  })

  const templateDialogTitle = computed(() => {
    if (templateDialogMode.value === 'edit') return i18ns.t('monthlyPass.editTemplate')
    if (templateDialogMode.value === 'copy') return i18ns.t('monthlyPass.copyTemplate')
    return i18ns.t('monthlyPass.createTemplate')
  })

  const channelNameById = computed(() => {
    return new Map(channelOptions.value.map((item) => [item.value, item.name]))
  })

  const availableTemplateModelOptions = computed(() => {
    if (!templateForm.allowedChannels.length) return modelOptions.value

    const selectedChannels = channelOptions.value.filter((item) =>
      templateForm.allowedChannels.includes(item.value),
    )

    if (!selectedChannels.length) return modelOptions.value

    const channelUnionModels = new Set<string>()
    let hasUnrestrictedChannel = false

    selectedChannels.forEach((channel) => {
      if (channel.allowedModels === null) {
        hasUnrestrictedChannel = true
        return
      }

      channel.allowedModels.forEach((model) => channelUnionModels.add(model))
    })

    if (hasUnrestrictedChannel) {
      const ordered = [...modelOptions.value]
      channelUnionModels.forEach((model) => {
        if (!ordered.includes(model)) ordered.push(model)
      })
      return ordered
    }

    const modelOptionsSet = new Set(modelOptions.value)
    const orderedInModelOptions: string[] = []
    modelOptions.value.forEach((model) => {
      if (channelUnionModels.has(model)) orderedInModelOptions.push(model)
    })

    const extras = Array.from(channelUnionModels)
      .filter((model) => !modelOptionsSet.has(model))
      .sort()
    return [...orderedInModelOptions, ...extras]
  })

  const assignableTemplateOptions = computed(() => {
    if (editingAssignmentId.value) return templateOptions.value
    return templateOptions.value.filter((item) => item.status === MANAGED_STATUS.ENABLED)
  })

  const selectedBatchUsers = computed(() => {
    const visibleMap = new Map(batchUserOptions.value.map((item) => [item.id, item]))
    return assignmentForm.userIds.map((userId) => {
      const visible = visibleMap.get(userId)
      return visible || { id: userId, username: userNameById.value.get(userId) || userId }
    })
  })

  const batchSelectionSummary = computed(() => {
    if (assignmentForm.includeAllVisible) {
      return i18ns.t('monthlyPass.batchIncludeAllVisibleSummary', {
        count: batchUserOptions.value.length,
      })
    }
    return i18ns.t('monthlyPass.batchSelectedUsersSummary', {
      count: assignmentForm.userIds.length,
    })
  })

  const templatePricingPreview = computed(() => {
    const originalPrice = Number(templateForm.originalPrice)
    const discountPercent = Number(templateForm.discountPercent)
    const rechargeRatio =
      billingRechargeRatio.value != null
        ? billingRechargeRatio.value
        : templateForm.rechargeRatioSnapshot != null
          ? templateForm.rechargeRatioSnapshot
          : null

    const discountedPrice =
      Number.isFinite(originalPrice) &&
      Number.isFinite(discountPercent) &&
      originalPrice > 0 &&
      discountPercent > 0
        ? round4((originalPrice * discountPercent) / 100)
        : undefined

    const derivedQuota =
      rechargeRatio != null && Number.isFinite(originalPrice) && originalPrice > 0
        ? round4(originalPrice * rechargeRatio)
        : undefined

    return {
      discountedPrice,
      derivedQuota,
      rechargeRatio,
    }
  })

  const parseChannelAllowedModels = (allowedModels?: string | null): string[] | null => {
    if (!allowedModels) return null

    try {
      const parsed = JSON.parse(allowedModels)
      if (!Array.isArray(parsed)) return null
      const cleaned = parsed.map((item) => String(item || '').trim()).filter(Boolean)
      return Array.from(new Set(cleaned))
    } catch {
      return null
    }
  }

  const createEditableQuotaWindow = (
    source?: Partial<MonthlyPassQuotaWindowDto | MonthlyPassQuotaWindowInputDto>,
  ): EditableQuotaWindow => {
    const normalizedHours = normalizeQuotaWindowHours(source?.quotaWindowHours)
    const parts = splitQuotaWindowParts(normalizedHours)
    editableQuotaWindowSeed += 1
    return {
      id: `quota-window-${editableQuotaWindowSeed}`,
      quotaLimit:
        source?.quotaLimit != null
          ? normalizeQuotaForSubmit(source.quotaLimit, source.quotaUnit)
          : null,
      quotaUnit: normalizeQuotaUnit(source?.quotaUnit),
      quotaWindowHours: normalizedHours,
      days: parts.days,
      hours: parts.hours,
    }
  }

  const updateEditableQuotaWindowHours = (window: EditableQuotaWindow) => {
    const normalized = combineQuotaWindowParts(window.days, window.hours)
    window.quotaWindowHours = normalized
    const parts = splitQuotaWindowParts(normalized)
    window.days = parts.days
    window.hours = parts.hours
  }

  const clearEditableQuotaWindow = (window: EditableQuotaWindow) => {
    window.quotaWindowHours = undefined
    window.days = 0
    window.hours = 0
  }

  const getTemplateQuotaWindowSource = (row: MonthlyPassTemplateDto) => {
    if (row.quotaWindows?.length) return row.quotaWindows
    if (row.quotaWindowHours && row.defaultQuota != null) {
      return [
        {
          quotaLimit: row.defaultQuota,
          quotaUnit: normalizeQuotaUnit(row.quotaUnit),
          quotaWindowHours: row.quotaWindowHours,
        },
      ]
    }
    return []
  }

  const getUserPassQuotaWindowSource = (row: UserMonthlyPassDto) => {
    if (row.quotaWindows?.length) return row.quotaWindows
    if (row.quotaWindowHours && row.totalQuota != null) {
      return [
        {
          quotaLimit: row.totalQuota,
          quotaUnit: normalizeQuotaUnit(row.quotaUnit),
          quotaWindowHours: row.quotaWindowHours,
        },
      ]
    }
    return []
  }

  const cloneEditableQuotaWindows = (
    source: Array<MonthlyPassQuotaWindowDto | MonthlyPassQuotaWindowInputDto>,
  ) => source.map((item) => createEditableQuotaWindow(item))

  const addTemplateQuotaWindow = () => {
    templateForm.quotaWindows.push(createEditableQuotaWindow({ quotaUnit: 'amount' }))
  }

  const removeTemplateQuotaWindow = (index: number) => {
    templateForm.quotaWindows.splice(index, 1)
  }

  const addAssignmentQuotaWindow = () => {
    assignmentForm.quotaWindows.push(
      createEditableQuotaWindow({ quotaUnit: assignmentForm.quotaUnit }),
    )
  }

  const removeAssignmentQuotaWindow = (index: number) => {
    assignmentForm.quotaWindows.splice(index, 1)
  }

  const normalizeQuotaWindowsForSubmit = (
    windows: EditableQuotaWindow[],
  ): MonthlyPassQuotaWindowInputDto[] | undefined => {
    const normalizedWindows = windows
      .map((window) => ({
        quotaLimit:
          window.quotaLimit == null
            ? null
            : normalizeQuotaForSubmit(window.quotaLimit, window.quotaUnit),
        quotaUnit: normalizeQuotaUnit(window.quotaUnit),
        quotaWindowHours: normalizeQuotaWindowHours(window.quotaWindowHours),
      }))
      .filter((window) => window.quotaLimit != null || window.quotaWindowHours != null)

    if (!normalizedWindows.length) return undefined

    const uniqueKeys = new Set<string>()
    for (const window of normalizedWindows) {
      if (
        window.quotaLimit == null ||
        !Number.isFinite(window.quotaLimit) ||
        window.quotaLimit <= 0
      ) {
        throw new Error(i18ns.t('monthlyPass.quotaWindowQuotaInvalid'))
      }
      if (!window.quotaWindowHours) {
        throw new Error(i18ns.t('monthlyPass.quotaWindowHoursRequired'))
      }
      if (isIntegerQuotaUnit(window.quotaUnit) && !Number.isInteger(window.quotaLimit)) {
        throw new Error(i18ns.t('monthlyPass.integerQuotaRequired'))
      }
      if (window.quotaLimit > getQuotaMax(window.quotaUnit)) {
        throw new Error(i18ns.t('monthlyPass.quotaExceededMax'))
      }
      const key = `${window.quotaUnit}:${window.quotaWindowHours}`
      if (uniqueKeys.has(key)) {
        throw new Error(i18ns.t('monthlyPass.quotaWindowDuplicate'))
      }
      uniqueKeys.add(key)
    }

    return normalizedWindows as MonthlyPassQuotaWindowInputDto[]
  }

  const formatQuotaWindowRule = (window: {
    quotaLimit?: number | null
    quotaUnit?: string
    quotaWindowHours?: number
  }) => {
    const quotaLabel = formatQuotaValue(window.quotaLimit ?? undefined, window.quotaUnit)
    return `${quotaLabel} ${formatQuotaUnit(window.quotaUnit)} / ${formatQuotaWindowHours(window.quotaWindowHours)}`
  }

  const formatQuotaWindows = (
    windows?: Array<{
      quotaLimit?: number | null
      quotaUnit?: string
      quotaWindowHours?: number
    }> | null,
  ) => {
    if (!windows?.length) return i18ns.t('monthlyPass.unlimited')
    return windows.map((item) => formatQuotaWindowRule(item)).join('；')
  }

  const normalizedQuickDurationDays = computed(() => {
    const numeric = Number(quickDurationDays.value)
    if (!Number.isFinite(numeric) || numeric <= 0) return 1
    return Math.floor(numeric)
  })

  const setAssignmentDurationDays = (days: number) => {
    const start = parseDate(assignmentForm.startAt) || new Date()
    const end = new Date(start.getTime() + days * DAY_MS)
    assignmentForm.startAt = toIso(start)
    assignmentForm.endAt = toIso(end)
  }

  const applyQuickDuration = () => {
    setAssignmentDurationDays(normalizedQuickDurationDays.value)
  }

  const shiftAssignmentEndDays = (days: number) => {
    const start = parseDate(assignmentForm.startAt)
    const end = parseDate(assignmentForm.endAt) || start || new Date()
    const nextEnd = new Date(end.getTime() + days * DAY_MS)

    if (start && nextEnd.getTime() <= start.getTime()) {
      ElMessage.warning(i18ns.t('monthlyPass.timeRangeInvalid'))
      return
    }

    if (!assignmentForm.startAt) assignmentForm.startAt = toIso(start || new Date())
    assignmentForm.endAt = toIso(nextEnd)
  }

  const increaseAssignmentDuration = () => {
    shiftAssignmentEndDays(normalizedQuickDurationDays.value)
  }

  const decreaseAssignmentDuration = () => {
    shiftAssignmentEndDays(-normalizedQuickDurationDays.value)
  }

  const canPublishTemplateRow = (row: MonthlyPassTemplateDto) => canPublishTemplate(row)
  const canUnpublishTemplateRow = (row: MonthlyPassTemplateDto) => canUnpublishTemplate(row)
  const publishStatusLabelForRow = (status?: MonthlyPassTemplatePublishStatus) =>
    publishStatusLabel(status)
  const publishStatusTagTypeForRow = (status?: MonthlyPassTemplatePublishStatus) =>
    publishStatusTagType(status)
  const formatAllowedChannels = (allowedChannels?: string[]) => {
    if (!allowedChannels || allowedChannels.length === 0) return i18ns.t('monthlyPass.allChannels')
    return allowedChannels
      .map((channelId) => channelNameById.value.get(channelId) || channelId)
      .join(', ')
  }

  const formatPurchaseLimit = (row: MonthlyPassTemplateDto) => {
    if (!row.purchaseLimitPerUser || !row.purchaseLimitWindowDays) {
      return i18ns.t('monthlyPass.unlimited')
    }

    return i18ns.t('monthlyPass.purchaseLimitValue', {
      count: row.purchaseLimitPerUser,
      days: row.purchaseLimitWindowDays,
    })
  }

  const loadModelOptions = async () => {
    try {
      const models = await modelPricingService.getModelPricing()
      modelOptions.value = Array.from(
        new Set(models.map((item) => item.model).filter(Boolean)),
      ).sort()
    } catch (_error) {
      modelOptions.value = []
    }
  }

  const loadChannelOptions = async () => {
    try {
      const channels = await relayChannelService.listChannels()
      channelOptions.value = channels
        .map((item) => ({
          value: item.id,
          name: item.name,
          label: item.name ? `${item.name} (${item.id})` : item.id,
          allowedModels: parseChannelAllowedModels(item.allowedModels),
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
    } catch (_error) {
      channelOptions.value = []
    }
  }

  const loadBillingConfig = async () => {
    try {
      const config = await configService.getBillingConfig()
      billingRechargeRatio.value = Number.isFinite(Number(config.rechargeRatio))
        ? Number(config.rechargeRatio)
        : null
    } catch (_error) {
      billingRechargeRatio.value = null
    }
  }

  const loadGroupOptions = async () => {
    try {
      const data = await groupService.getAllGroups()
      const groups = Array.isArray(data) ? data : data.groups
      groupOptions.value = groups
        .map((item: { id: string; username: string; name?: string | null }) => ({
          id: item.id,
          username: item.username,
          name: item.name || item.username,
        }))
        .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
    } catch (_error) {
      groupOptions.value = []
    }
  }

  const handleTemplateAllowedChannelsChange = () => {
    if (!templateForm.allowedModels.length) return

    const availableModelSet = new Set(availableTemplateModelOptions.value)
    templateForm.allowedModels = templateForm.allowedModels.filter((model) =>
      availableModelSet.has(model),
    )
  }

  const ensureUserOption = (userId?: string, username?: string | null) => {
    if (!userId) return
    if (userOptions.value.some((item) => item.id === userId)) return

    userOptions.value = [
      {
        id: userId,
        username: username || userId,
      },
      ...userOptions.value,
    ]
  }

  const loadUserOptions = async (keyword?: string) => {
    userOptionsLoading.value = true
    try {
      const result = await userService.getAllUsers({
        page: 1,
        pageSize: USER_OPTIONS_PAGE_SIZE,
        keyword: keyword?.trim() || undefined,
      })
      const users = Array.isArray(result?.users) ? result.users : []
      userOptions.value = users
        .map((item: { id: string; username?: string }) => ({
          id: item.id,
          username: item.username || item.id,
        }))
        .sort((a, b) => a.username.localeCompare(b.username))
    } catch (_error) {
      userOptions.value = []
    } finally {
      userOptionsLoading.value = false
    }
  }

  const handleUserSearch = (query: string) => {
    void loadUserOptions(query)
  }

  const loadBatchUserOptions = async () => {
    batchUserOptionsLoading.value = true
    try {
      const keyword = assignmentForm.batchKeyword.trim()
      const groupId = assignmentForm.batchGroupId || undefined
      const result = await userService.getAllUsers({
        page: 1,
        pageSize: 100,
        keyword: keyword || undefined,
        groupId,
      })
      const users = Array.isArray(result?.users) ? result.users : []
      batchUserOptions.value = users.map((item: { id: string; username?: string }) => ({
        id: item.id,
        username: item.username || item.id,
      }))
      batchUserOptions.value.forEach((user) => ensureUserOption(user.id, user.username))
    } catch (error) {
      batchUserOptions.value = []
      ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.loadFailed')))
    } finally {
      batchUserOptionsLoading.value = false
    }
  }

  const selectAllVisibleBatchUsers = () => {
    const merged = new Set(assignmentForm.userIds)
    batchUserOptions.value.forEach((user) => merged.add(user.id))
    assignmentForm.userIds = Array.from(merged)
    assignmentForm.includeAllVisible = true
  }

  const clearBatchUserSelection = () => {
    assignmentForm.userIds = []
    assignmentForm.includeAllVisible = false
  }

  const normalizedBatchTargetFilter = computed(() => {
    const keyword = assignmentForm.batchKeyword.trim()
    const groupId = assignmentForm.batchGroupId || undefined

    if (!assignmentForm.includeAllVisible && !keyword && !groupId) return undefined

    return {
      keyword: keyword || undefined,
      groupId,
      includeAllVisible: assignmentForm.includeAllVisible || undefined,
    }
  })

  const loadTemplateOptions = async () => {
    if (!canReadTemplates.value && !canReadAssignments.value && !canReadUsages.value) {
      templateOptions.value = []
      return
    }

    try {
      const records: MonthlyPassTemplateDto[] = []
      const pageSize = 100
      let page = 1
      let total = 0

      do {
        const result = await monthlyPassService.listTemplates({
          page,
          pageSize,
        })

        const pageRecords = result.records || []
        records.push(...pageRecords)
        total = result.total || 0
        page += 1

        if (pageRecords.length === 0) break
      } while (records.length < total)

      templateOptions.value = records
    } catch (_error) {
      templateOptions.value = []
    }
  }

  const loadTemplates = async () => {
    if (!canReadTemplates.value) return

    loadingTemplates.value = true
    try {
      const result = await monthlyPassService.listTemplates({
        page: templatePagination.page,
        pageSize: templatePagination.pageSize,
        keyword: templateFilters.keyword || undefined,
        status: templateFilters.status === '' ? undefined : templateFilters.status,
      })

      templates.value = result.records || []
      templatePagination.total = result.total || 0
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.loadFailed')))
    } finally {
      loadingTemplates.value = false
    }
  }

  const loadAssignments = async () => {
    if (!canReadAssignments.value) return

    loadingAssignments.value = true
    try {
      const result = await monthlyPassService.listUserPasses({
        page: assignmentPagination.page,
        pageSize: assignmentPagination.pageSize,
        userId: assignmentFilters.userId || undefined,
        templateId: assignmentFilters.templateId || undefined,
        status: assignmentFilters.status === '' ? undefined : assignmentFilters.status,
      })

      userPasses.value = result.records || []
      assignmentPagination.total = result.total || 0
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.loadFailed')))
    } finally {
      loadingAssignments.value = false
    }
  }

  const loadUsages = async () => {
    if (!canReadUsages.value) return

    loadingUsages.value = true
    try {
      const result = await monthlyPassService.listUsages({
        page: usagePagination.page,
        pageSize: usagePagination.pageSize,
        userId: usageFilters.userId || undefined,
        templateId: usageFilters.templateId || undefined,
        model: usageFilters.model || undefined,
        startTime: usageFilters.startTime || undefined,
        endTime: usageFilters.endTime || undefined,
      })

      usageRecords.value = result.records || []
      usagePagination.total = result.total || 0
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.loadFailed')))
    } finally {
      loadingUsages.value = false
    }
  }

  const loadByTab = async (tab: TabKey) => {
    if (tab === 'templates') {
      await loadTemplates()
      return
    }

    if (tab === 'assignments') {
      await loadAssignments()
      return
    }

    await loadUsages()
  }

  const initializeActiveTab = () => {
    if (canReadTemplates.value) {
      activeTab.value = 'templates'
      return
    }

    if (canReadAssignments.value) {
      activeTab.value = 'assignments'
      return
    }

    activeTab.value = 'usages'
  }

  const refreshCurrentTab = async () => {
    refreshing.value = true
    try {
      await loadByTab(activeTab.value)
    } finally {
      refreshing.value = false
    }
  }

  const handleTabChange = async (name: string | number) => {
    const normalized = String(name)
    if (normalized !== 'templates' && normalized !== 'assignments' && normalized !== 'usages') return

    await loadByTab(normalized)
  }

  const resetTemplateForm = () => {
    templateForm.name = ''
    templateForm.description = ''
    templateForm.originalPrice = 1
    templateForm.discountPercent = 100
    templateForm.allowBalanceRedemption = true
    templateForm.purchaseLimitPerUser = undefined
    templateForm.purchaseLimitWindowDays = undefined
    templateForm.dailyQuota = undefined
    templateForm.rechargeRatioSnapshot = undefined
    templateForm.quotaWindows = []
    templateForm.allowedModels = []
    templateForm.allowedChannels = []
    templateForm.status = MANAGED_STATUS.ENABLED
  }

  const clearTemplatePurchaseLimit = () => {
    templateForm.purchaseLimitPerUser = undefined
    templateForm.purchaseLimitWindowDays = undefined
  }

  const buildCopiedTemplateName = (name: string) => {
    const baseName = name.trim()
    const suffix = i18ns.t('monthlyPass.copyNameSuffix')
    const maxLength = 100

    if (!baseName) return suffix.trim().slice(0, maxLength)
    if (baseName.endsWith(suffix)) return baseName.slice(0, maxLength)
    if (baseName.length + suffix.length <= maxLength) return `${baseName}${suffix}`

    const truncatedBase = baseName.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd()
    return `${truncatedBase}${suffix}`
  }

  const applyTemplateFormFromRow = (row: MonthlyPassTemplateDto) => {
    templateForm.name = row.name
    templateForm.description = row.description || ''
    templateForm.originalPrice = row.originalPrice != null ? round4(Number(row.originalPrice)) : 1
    templateForm.discountPercent =
      row.discountPercent != null ? round2(Number(row.discountPercent)) : 100
    templateForm.allowBalanceRedemption = row.allowBalanceRedemption ?? true
    templateForm.purchaseLimitPerUser = row.purchaseLimitPerUser ?? undefined
    templateForm.purchaseLimitWindowDays = row.purchaseLimitWindowDays ?? undefined
    templateForm.dailyQuota =
      row.dailyQuota == null ? undefined : normalizeQuotaForSubmit(row.dailyQuota, 'amount')
    templateForm.rechargeRatioSnapshot =
      row.rechargeRatio != null ? Number(row.rechargeRatio) : undefined
    templateForm.quotaWindows = cloneEditableQuotaWindows(getTemplateQuotaWindowSource(row))
    templateForm.allowedModels = row.allowedModels ? [...row.allowedModels] : []
    templateForm.allowedChannels = row.allowedChannels ? [...row.allowedChannels] : []
    templateForm.status = row.status
  }

  const openCreateTemplateDialog = () => {
    templateDialogMode.value = 'create'
    editingTemplateId.value = null
    resetTemplateForm()
    showTemplateDialog.value = true
  }

  const openEditTemplateDialog = (row: MonthlyPassTemplateDto) => {
    templateDialogMode.value = 'edit'
    editingTemplateId.value = row.id
    applyTemplateFormFromRow(row)
    showTemplateDialog.value = true
  }

  const openCopyTemplateDialog = (row: MonthlyPassTemplateDto) => {
    templateDialogMode.value = 'copy'
    editingTemplateId.value = null
    applyTemplateFormFromRow(row)
    templateForm.name = buildCopiedTemplateName(row.name)
    templateForm.status = MANAGED_STATUS.ENABLED
    showTemplateDialog.value = true
  }

  const submitTemplate = async () => {
    const name = templateForm.name.trim()
    if (!name) {
      ElMessage.warning(i18ns.t('monthlyPass.templateNameRequired'))
      return
    }

    const originalPrice = round4(Number(templateForm.originalPrice))
    if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
      ElMessage.warning(i18ns.t('monthlyPass.originalPriceInvalid'))
      return
    }
    if (originalPrice > MAX_AMOUNT_QUOTA) {
      ElMessage.warning(i18ns.t('monthlyPass.quotaExceededMax'))
      return
    }

    const discountPercent = round2(Number(templateForm.discountPercent))
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      ElMessage.warning(i18ns.t('monthlyPass.discountPercentInvalid'))
      return
    }

    const normalizedDailyQuota =
      templateForm.dailyQuota == null
        ? undefined
        : normalizeQuotaForSubmit(templateForm.dailyQuota, 'amount')

    if (normalizedDailyQuota != null) {
      if (!Number.isFinite(normalizedDailyQuota) || normalizedDailyQuota <= 0) {
        ElMessage.warning(i18ns.t('monthlyPass.dailyQuotaInvalid'))
        return
      }
      if (normalizedDailyQuota > MAX_AMOUNT_QUOTA) {
        ElMessage.warning(i18ns.t('monthlyPass.quotaExceededMax'))
        return
      }
      if (
        templatePricingPreview.value.derivedQuota != null &&
        normalizedDailyQuota > templatePricingPreview.value.derivedQuota
      ) {
        ElMessage.warning(i18ns.t('monthlyPass.dailyQuotaInvalid'))
        return
      }
    }

    templateForm.originalPrice = originalPrice
    templateForm.discountPercent = discountPercent
    templateForm.dailyQuota = normalizedDailyQuota

    const purchaseLimitPerUser = normalizeOptionalPositiveInteger(templateForm.purchaseLimitPerUser)
    const purchaseLimitWindowDays = normalizeOptionalPositiveInteger(
      templateForm.purchaseLimitWindowDays,
    )
    const hasPurchaseLimit = purchaseLimitPerUser != null || purchaseLimitWindowDays != null

    if (hasPurchaseLimit && (purchaseLimitPerUser == null || purchaseLimitWindowDays == null)) {
      ElMessage.warning(i18ns.t('monthlyPass.purchaseLimitInvalid'))
      return
    }

    templateForm.purchaseLimitPerUser = purchaseLimitPerUser
    templateForm.purchaseLimitWindowDays = purchaseLimitWindowDays

    savingTemplate.value = true
    try {
      const hasSelectedModels = templateForm.allowedModels.length > 0
      const hasSelectedChannels = templateForm.allowedChannels.length > 0
      const isEditingTemplate = Boolean(editingTemplateId.value)
      const normalizedQuotaWindows = normalizeQuotaWindowsForSubmit(templateForm.quotaWindows)

      const payload: UpdateMonthlyPassTemplateRequest = {
        name,
        description: templateForm.description.trim() || undefined,
        originalPrice,
        discountPercent,
        allowBalanceRedemption: templateForm.allowBalanceRedemption,
        purchaseLimitPerUser: purchaseLimitPerUser ?? (isEditingTemplate ? null : undefined),
        purchaseLimitWindowDays: purchaseLimitWindowDays ?? (isEditingTemplate ? null : undefined),
        dailyQuota:
          normalizedDailyQuota != null ? normalizedDailyQuota : isEditingTemplate ? null : undefined,
        quotaWindowHours: isEditingTemplate ? null : undefined,
        quotaWindows: normalizedQuotaWindows,
        allowedModels: hasSelectedModels
          ? [...templateForm.allowedModels]
          : isEditingTemplate
            ? null
            : undefined,
        allowedChannels: hasSelectedChannels
          ? [...templateForm.allowedChannels]
          : isEditingTemplate
            ? null
            : undefined,
        status: isEditingTemplate ? templateForm.status : undefined,
      }

      if (editingTemplateId.value) {
        await monthlyPassService.updateTemplate(editingTemplateId.value, payload)
      } else {
        await monthlyPassService.createTemplate({
          name,
          description: templateForm.description.trim() || undefined,
          originalPrice,
          discountPercent,
          allowBalanceRedemption: templateForm.allowBalanceRedemption,
          purchaseLimitPerUser,
          purchaseLimitWindowDays,
          dailyQuota: normalizedDailyQuota,
          quotaWindows: normalizedQuotaWindows,
          allowedModels:
            templateForm.allowedModels.length > 0 ? [...templateForm.allowedModels] : undefined,
          allowedChannels:
            templateForm.allowedChannels.length > 0 ? [...templateForm.allowedChannels] : undefined,
        })
      }

      ElMessage.success(i18ns.t('monthlyPass.saveSuccess'))
      showTemplateDialog.value = false
      await Promise.all([loadTemplates(), loadTemplateOptions()])
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.saveFailed')))
    } finally {
      savingTemplate.value = false
    }
  }

  const deleteTemplate = async (row: MonthlyPassTemplateDto) => {
    try {
      await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), {
        type: 'warning',
      })

      await monthlyPassService.deleteTemplate(row.id)
      ElMessage.success(i18ns.t('monthlyPass.deleteSuccess'))
      await Promise.all([loadTemplates(), loadTemplateOptions()])
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.deleteFailed')))
    }
  }

  const publishTemplate = async (row: MonthlyPassTemplateDto) => {
    try {
      await monthlyPassService.publishTemplate(row.id)
      ElMessage.success(i18ns.t('monthlyPass.publishSuccess'))
      await Promise.all([loadTemplates(), loadTemplateOptions()])
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.publishFailed')))
    }
  }

  const unpublishTemplate = async (row: MonthlyPassTemplateDto) => {
    try {
      await monthlyPassService.unpublishTemplate(row.id)
      ElMessage.success(i18ns.t('monthlyPass.unpublishSuccess'))
      await Promise.all([loadTemplates(), loadTemplateOptions()])
    } catch (error) {
      ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.unpublishFailed')))
    }
  }

  const resetAssignmentForm = () => {
    assignmentForm.userId = ''
    assignmentForm.userIds = []
    assignmentForm.batchMode = false
    assignmentForm.assignmentMode = 'create_new'
    assignmentForm.batchKeyword = ''
    assignmentForm.batchGroupId = ''
    assignmentForm.includeAllVisible = false
    assignmentForm.templateId = ''
    assignmentForm.startAt = getDefaultStartAt()
    assignmentForm.endAt = getDefaultEndAt()
    assignmentForm.totalQuota = null
    assignmentForm.dailyQuota = undefined
    assignmentForm.quotaUnit = 'amount'
    assignmentForm.quotaWindows = []
    assignmentForm.note = ''
    assignmentForm.status = MANAGED_STATUS.ENABLED
    quickDurationDays.value = 7
  }

  const openCreateAssignmentDialog = () => {
    editingAssignmentId.value = null
    resetAssignmentForm()
    batchAssignmentResult.value = null
    showAssignmentDialog.value = true
  }

  const openEditAssignmentDialog = (row: UserMonthlyPassDto) => {
    editingAssignmentId.value = row.id
    ensureUserOption(row.userId, row.username)
    assignmentForm.userId = row.userId
    assignmentForm.templateId = row.templateId
    assignmentForm.startAt = row.startAt
    assignmentForm.endAt = row.endAt
    const quotaUnit = normalizeQuotaUnit(row.quotaUnit)
    assignmentForm.totalQuota = normalizeQuotaForSubmit(row.totalQuota, quotaUnit)
    assignmentForm.dailyQuota =
      row.dailyQuota == null ? undefined : normalizeQuotaForSubmit(row.dailyQuota, quotaUnit)
    assignmentForm.quotaUnit = quotaUnit
    assignmentForm.quotaWindows = cloneEditableQuotaWindows(getUserPassQuotaWindowSource(row))
    assignmentForm.note = row.note || ''
    assignmentForm.status = row.status
    assignmentForm.batchMode = false
    batchAssignmentResult.value = null
    showAssignmentDialog.value = true
  }

  const submitAssignment = async () => {
    if (!editingAssignmentId.value && !assignmentForm.batchMode && !assignmentForm.userId) {
      ElMessage.warning(i18ns.t('monthlyPass.userRequired'))
      return
    }

    if (
      !editingAssignmentId.value &&
      assignmentForm.batchMode &&
      !assignmentForm.includeAllVisible &&
      assignmentForm.userIds.length === 0
    ) {
      ElMessage.warning(i18ns.t('monthlyPass.batchTargetsRequired'))
      return
    }

    if (!assignmentForm.templateId) {
      ElMessage.warning(i18ns.t('monthlyPass.templateRequired'))
      return
    }

    if (!assignmentForm.startAt || !assignmentForm.endAt) {
      ElMessage.warning(i18ns.t('monthlyPass.timeRangeInvalid'))
      return
    }

    if (new Date(assignmentForm.endAt).getTime() <= new Date(assignmentForm.startAt).getTime()) {
      ElMessage.warning(i18ns.t('monthlyPass.timeRangeInvalid'))
      return
    }

    const quotaUnit = normalizeQuotaUnit(assignmentForm.quotaUnit)
    const quotaMax = getQuotaMax(quotaUnit)

    const normalizedTotalQuota =
      assignmentForm.totalQuota == null
        ? undefined
        : normalizeQuotaForSubmit(assignmentForm.totalQuota, quotaUnit)
    if (normalizedTotalQuota != null) {
      if (isIntegerQuotaUnit(quotaUnit) && !Number.isInteger(Number(assignmentForm.totalQuota))) {
        ElMessage.warning(i18ns.t('monthlyPass.integerQuotaRequired'))
        return
      }
      if (!Number.isFinite(normalizedTotalQuota) || normalizedTotalQuota <= 0) {
        ElMessage.warning(i18ns.t('monthlyPass.totalQuotaInvalid'))
        return
      }
      if (normalizedTotalQuota > quotaMax) {
        ElMessage.warning(i18ns.t('monthlyPass.quotaExceededMax'))
        return
      }
    }

    const normalizedDailyQuota =
      assignmentForm.dailyQuota == null
        ? undefined
        : normalizeQuotaForSubmit(assignmentForm.dailyQuota, quotaUnit)
    if (normalizedDailyQuota != null) {
      if (isIntegerQuotaUnit(quotaUnit) && !Number.isInteger(Number(assignmentForm.dailyQuota))) {
        ElMessage.warning(i18ns.t('monthlyPass.integerQuotaRequired'))
        return
      }
      if (!Number.isFinite(normalizedDailyQuota) || normalizedDailyQuota <= 0) {
        ElMessage.warning(i18ns.t('monthlyPass.dailyQuotaInvalid'))
        return
      }
      if (normalizedDailyQuota > quotaMax) {
        ElMessage.warning(i18ns.t('monthlyPass.quotaExceededMax'))
        return
      }
      if (normalizedTotalQuota != null && normalizedDailyQuota > normalizedTotalQuota) {
        ElMessage.warning(i18ns.t('monthlyPass.dailyQuotaInvalid'))
        return
      }
    }

    assignmentForm.totalQuota = normalizedTotalQuota ?? null
    assignmentForm.dailyQuota = normalizedDailyQuota

    savingAssignment.value = true
    try {
      const normalizedQuotaWindows = normalizeQuotaWindowsForSubmit(assignmentForm.quotaWindows)

      if (editingAssignmentId.value) {
        const payload: UpdateUserMonthlyPassRequest = {
          startAt: assignmentForm.startAt,
          endAt: assignmentForm.endAt,
          totalQuota: normalizedTotalQuota,
          dailyQuota: normalizedDailyQuota != null ? normalizedDailyQuota : null,
          quotaUnit,
          quotaWindowHours: null,
          quotaWindows: normalizedQuotaWindows,
          note: assignmentForm.note.trim() || undefined,
          status: assignmentForm.status,
        }
        await monthlyPassService.updateUserPass(editingAssignmentId.value, payload)
      } else if (assignmentForm.batchMode) {
        const payload: AssignBatchUserMonthlyPassRequest = {
          userIds: assignmentForm.includeAllVisible ? undefined : [...assignmentForm.userIds],
          targetFilter: normalizedBatchTargetFilter.value,
          templateId: assignmentForm.templateId,
          startAt: assignmentForm.startAt,
          endAt: assignmentForm.endAt,
          totalQuota: normalizedTotalQuota,
          dailyQuota: normalizedDailyQuota,
          quotaUnit,
          quotaWindows: normalizedQuotaWindows,
          note: assignmentForm.note.trim() || undefined,
          assignmentMode: assignmentForm.assignmentMode,
        }
        batchAssignmentResult.value = await monthlyPassService.assignUserPassBatch(payload)
      } else {
        const payload: AssignUserMonthlyPassRequest = {
          userId: assignmentForm.userId,
          templateId: assignmentForm.templateId,
          startAt: assignmentForm.startAt,
          endAt: assignmentForm.endAt,
          totalQuota: normalizedTotalQuota,
          dailyQuota: normalizedDailyQuota,
          quotaUnit,
          quotaWindows: normalizedQuotaWindows,
          note: assignmentForm.note.trim() || undefined,
        }
        await monthlyPassService.assignUserPass(payload)
      }

      ElMessage.success(i18ns.t('monthlyPass.saveSuccess'))
      await loadAssignments()
      if (!assignmentForm.batchMode || editingAssignmentId.value) {
        showAssignmentDialog.value = false
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : toErrorMessage(error, i18ns.t('monthlyPass.saveFailed'))
      ElMessage.error(message)
    } finally {
      savingAssignment.value = false
    }
  }

  const deleteAssignment = async (row: UserMonthlyPassDto) => {
    try {
      await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), {
        type: 'warning',
      })

      await monthlyPassService.deleteUserPass(row.id)
      ElMessage.success(i18ns.t('monthlyPass.deleteSuccess'))
      await loadAssignments()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.deleteFailed')))
    }
  }

  const handleUsageDateRangeChange = (value: [string, string] | null) => {
    if (!value) {
      usageFilters.startTime = ''
      usageFilters.endTime = ''
      return
    }

    usageFilters.startTime = value[0]
    usageFilters.endTime = value[1]
  }

  const searchTemplates = async () => {
    templatePagination.page = 1
    await loadTemplates()
  }

  const searchAssignments = async () => {
    assignmentPagination.page = 1
    await loadAssignments()
  }

  const searchUsages = async () => {
    usagePagination.page = 1
    await loadUsages()
  }

  const normalizeAssignmentQuotaFieldsByUnit = () => {
    const unit = assignmentForm.quotaUnit

    if (assignmentForm.totalQuota != null) {
      assignmentForm.totalQuota = normalizeQuotaForUnitSwitch(assignmentForm.totalQuota, unit)
    }

    if (assignmentForm.dailyQuota != null) {
      assignmentForm.dailyQuota = normalizeQuotaForUnitSwitch(assignmentForm.dailyQuota, unit)
      if (
        assignmentForm.totalQuota != null &&
        assignmentForm.dailyQuota > assignmentForm.totalQuota
      ) {
        assignmentForm.dailyQuota = assignmentForm.totalQuota
      }
    }
  }

  watch(
    () => assignmentForm.quotaUnit,
    () => {
      normalizeAssignmentQuotaFieldsByUnit()
      assignmentForm.quotaWindows = assignmentForm.quotaWindows.map((window) => ({
        ...window,
        quotaUnit: normalizeQuotaUnit(window.quotaUnit),
        quotaLimit:
          window.quotaLimit == null
            ? null
            : normalizeQuotaForUnitSwitch(window.quotaLimit, window.quotaUnit),
      }))
    },
  )

  watch(
    () => [showAssignmentDialog.value, assignmentForm.batchMode, editingAssignmentId.value] as const,
    ([visible, batchMode, editingId]) => {
      if (!visible || !batchMode || Boolean(editingId)) return
      void loadBatchUserOptions()
    },
  )

  onMounted(async () => {
    PermissionService.getInstance()
      .ensureLoaded()
      .then(() => {
        Promise.all([loadTemplates()])
        Promise.all([
          loadBillingConfig(),
          loadGroupOptions(),
          loadModelOptions(),
          loadChannelOptions(),
          loadUserOptions(),
          loadTemplateOptions(),
        ])
        initializeActiveTab()
      })
  })

  return {
    Permission,
    MANAGED_STATUS,
    isDesktop,
    activeTab,
    refreshing,
    canReadTemplates,
    canWriteTemplates,
    canReadAssignments,
    canWriteAssignments,
    canReadUsages,
    hasAnyReadPermission,
    loadingTemplates,
    loadingAssignments,
    loadingUsages,
    templates,
    userPasses,
    usageRecords,
    modelOptions,
    channelOptions,
    groupOptions,
    userOptions,
    templateOptions,
    userOptionsLoading,
    batchUserOptions,
    batchUserOptionsLoading,
    batchAssignmentResult,
    templateFilters,
    assignmentFilters,
    usageFilters,
    usageDateRange,
    templatePagination,
    assignmentPagination,
    usagePagination,
    showTemplateDialog,
    editingTemplateId,
    templateDialogMode,
    savingTemplate,
    templateForm,
    showAssignmentDialog,
    editingAssignmentId,
    savingAssignment,
    assignmentForm,
    quickDurationDays,
    userNameById,
    templateDialogTitle,
    availableTemplateModelOptions,
    assignableTemplateOptions,
    selectedBatchUsers,
    batchSelectionSummary,
    templatePricingPreview,
    formatDateTime,
    formatAmount,
    formatPriceValue,
    formatPercentValue,
    formatRatioValue,
    formatQuotaValue,
    formatDailyQuota,
    formatQuotaUnit,
    formatQuotaWindowHours,
    formatQuotaWindows,
    statusLabel,
    publishStatusLabel: publishStatusLabelForRow,
    publishStatusTagType: publishStatusTagTypeForRow,
    canPublishTemplate: canPublishTemplateRow,
    canUnpublishTemplate: canUnpublishTemplateRow,
    formatAllowedModels,
    formatAllowedChannels,
    formatPurchaseLimit,
    getTemplateQuotaWindowSource,
    getUserPassQuotaWindowSource,
    getQuotaMax,
    getQuotaMin,
    getQuotaPrecision,
    getQuotaStep,
    updateEditableQuotaWindowHours,
    clearEditableQuotaWindow,
    addTemplateQuotaWindow,
    removeTemplateQuotaWindow,
    addAssignmentQuotaWindow,
    removeAssignmentQuotaWindow,
    refreshCurrentTab,
    handleTabChange,
    handleTemplateAllowedChannelsChange,
    handleUserSearch,
    loadBatchUserOptions,
    selectAllVisibleBatchUsers,
    clearBatchUserSelection,
    openCreateTemplateDialog,
    openEditTemplateDialog,
    openCopyTemplateDialog,
    submitTemplate,
    deleteTemplate,
    publishTemplate,
    unpublishTemplate,
    clearTemplatePurchaseLimit,
    openCreateAssignmentDialog,
    openEditAssignmentDialog,
    submitAssignment,
    deleteAssignment,
    handleUsageDateRangeChange,
    searchTemplates,
    searchAssignments,
    searchUsages,
    loadTemplates,
    loadAssignments,
    loadUsages,
    applyQuickDuration,
    increaseAssignmentDuration,
    decreaseAssignmentDuration,
    shiftAssignmentEndDays,
    setAssignmentDurationDays,
  }
}

export type MonthlyPassManagementState = ReturnType<typeof useMonthlyPassManagement>
