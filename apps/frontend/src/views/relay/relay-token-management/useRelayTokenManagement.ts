import { usePageDevice } from '@/composables/usePageDevice'
import { MANAGED_STATUS } from '@/constant/status'
import { i18ns } from '@/locales'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { TableInstance } from 'element-plus'
import { relayTokenService } from '@/service/relayTokenService'
import { relayChannelService } from '@/service/relayChannelService'
import { userService } from '@/service/userService'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { useFloatingOverlayVisibility } from '@/composables/useFloatingOverlayVisibility'
import Sortable from 'sortablejs'
import { resolveRelayAiBaseUrl } from '@/constant/strings'
import { copyTextWithFallback } from '@/utils/clipboard'
import { normalizeRelayFormats, type RelayFormat } from '@/utils/relay-formats'
import { Permission } from '@/constant/permission'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  ImportRelayTokensResponse,
  RelayChannelOptionDto,
  RelayChannelSwitchLogDto,
  RelayTokenImportItemDto,
  RelayTokenChannelConfigDto,
  RelayTokenDto,
  RelayTokenQuotaWindowDto,
  UserDto,
} from '@/client/types.gen'
export type EditableChannelConfig = {
  tempKey: string
  channelId: string
  priority: number
}

export type EditableFailoverConfig = {
  enabled: boolean
  maxRetries: number
  retryStatusCodes: string[]
  failoverThreshold: number
  failbackCooldownMinutes: number
}

export type ChannelOption = {
  id: string
  name: string
  multiplier: number | string
  unavailable?: boolean
}

type CcswitchApp = 'claude' | 'codex' | 'gemini'
type RelayRoutingMode = 'ordered' | 'automatic-pool'

export type TokenQuotaSnapshot = {
  usedQuota: number
  remainingQuota?: number
  quotaUsagePercent?: number
  isQuotaExceeded: boolean
}

export type QuotaUnit = 'amount' | 'request' | 'token'

export type RelayTokenQuotaWindowLike = Pick<
  RelayTokenQuotaWindowDto,
  'quotaLimit' | 'quotaUnit' | 'quotaWindowHours'
> & {
  id?: string
  usedQuota?: number
  remainingQuota?: number
  quotaUsagePercent?: number
  isQuotaExceeded?: boolean
}

type RelayTokenWithQuotaWindows = RelayTokenDto & {
  quotaWindows?: RelayTokenQuotaWindowLike[]
}

type RelayTokenWithRouting = RelayTokenDto & {
  routingMode?: RelayRoutingMode
  automaticProxyPoolChannelId?: string
}

export type EditableQuotaWindow = RelayTokenQuotaWindowLike & {
  id?: string
  months: number
  days: number
  hours: number
  minutes: number
}

const DEFAULT_RETRY_STATUS_CODES = ['4xx', '5xx']
const DEFAULT_QUOTA_WINDOW_HOURS = 24
const QUOTA_WINDOW_PREVIEW_CYCLE = ['hour', 'actual', 'day', 'week', 'month'] as const
const MAX_AMOUNT_QUOTA = 999999.9999
const MAX_INTEGER_QUOTA = 999999
const MAX_QUOTA_WINDOW_HOURS = 24 * 30 * 12
const MAX_QUOTA_WINDOW_MONTHS = 12
const MAX_QUOTA_WINDOW_DAYS = 29
const MAX_QUOTA_WINDOW_HOUR_PART = 23
const MAX_QUOTA_WINDOW_MINUTE_PART = 59
const MAX_QUOTA_WINDOWS = 20
const MAX_VISIBLE_CHANNEL_CONFIGS = 2

const EXACT_HTTP_STATUS_RULE_REGEX = /^[1-5]\d{2}$/
const WILDCARD_HTTP_STATUS_RULE_REGEX = /^[0-9x*]{3}$/i
const REGEX_FLAGS_REGEX = /^[imsu]*$/
const HTTP_STATUS_CODES = Array.from({ length: 500 }, (_, index) => index + 100)

const parseRegexRule = (rule: string): RegExp | null => {
  if (!rule.startsWith('/')) return null

  const lastSlashIndex = rule.lastIndexOf('/')
  if (lastSlashIndex <= 0) return null

  const pattern = rule.slice(1, lastSlashIndex)
  const flags = rule.slice(lastSlashIndex + 1)
  if (!pattern || !REGEX_FLAGS_REGEX.test(flags)) return null

  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

const matchesWildcardStatusRule = (statusCode: number, rule: string) => {
  const statusText = String(statusCode)
  if (statusText.length !== 3 || rule.length !== 3) return false

  return rule.split('').every((char, index) => {
    if (char === 'x' || char === '*') return true
    return statusText[index] === char
  })
}

const isValidRetryStatusRule = (rule: string) => {
  if (EXACT_HTTP_STATUS_RULE_REGEX.test(rule)) return true

  if (WILDCARD_HTTP_STATUS_RULE_REGEX.test(rule) && /[x*]/i.test(rule)) {
    return HTTP_STATUS_CODES.some((statusCode) => matchesWildcardStatusRule(statusCode, rule))
  }

  const regex = parseRegexRule(rule)
  if (!regex) return false

  return HTTP_STATUS_CODES.some((statusCode) => {
    regex.lastIndex = 0
    return regex.test(String(statusCode))
  })
}

const createDefaultFailoverConfig = (): EditableFailoverConfig => ({
  enabled: false,
  maxRetries: 1,
  retryStatusCodes: [...DEFAULT_RETRY_STATUS_CODES],
  failoverThreshold: 0,
  failbackCooldownMinutes: 0,
})

let channelConfigKeySeed = 0

const createEmptyChannelConfig = (priority: number, channelId = ''): EditableChannelConfig => ({
  tempKey: `token-channel-config-${channelConfigKeySeed++}`,
  channelId,
  priority,
})

const round4 = (value: number) => Math.round(value * 10000) / 10000

const normalizeQuotaUnit = (value?: string): QuotaUnit => {
  if (value === 'request' || value === 'token') return value
  return 'amount'
}

const isIntegerQuotaUnit = (value?: string): boolean => {
  const unit = normalizeQuotaUnit(value)
  return unit === 'request' || unit === 'token'
}

const getQuotaMax = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? MAX_INTEGER_QUOTA : MAX_AMOUNT_QUOTA
}

const getQuotaMin = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 1 : 0.0001
}

const getQuotaPrecision = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 0 : 4
}

const getQuotaStep = (value?: string): number => {
  return isIntegerQuotaUnit(value) ? 1 : 0.0001
}

const normalizeQuotaForSubmit = (value: number, unit?: string): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return numeric
  if (isIntegerQuotaUnit(unit)) return Math.floor(numeric)
  return round4(numeric)
}

const normalizeQuotaForUnitSwitch = (value: number, unit?: string): number => {
  const normalized = normalizeQuotaForSubmit(value, unit)
  if (!Number.isFinite(normalized)) return normalized

  const clamped = Math.min(getQuotaMax(unit), Math.max(getQuotaMin(unit), normalized))
  return isIntegerQuotaUnit(unit) ? Math.floor(clamped) : round4(clamped)
}

const normalizeQuotaWindowHours = (value?: number): number | undefined => {
  if (value == null) return undefined
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return undefined
  return Math.min(Math.round(numeric * 10000) / 10000, MAX_QUOTA_WINDOW_HOURS)
}

const clampNonNegativeInteger = (value: unknown, max: number): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.min(Math.floor(numeric), max)
}

const splitQuotaWindowParts = (value?: number) => {
  const normalized = normalizeQuotaWindowHours(value)
  if (normalized == null) {
    return {
      months: 0,
      days: 0,
      hours: 0,
      minutes: 0,
    }
  }

  const totalMinutes = Math.round(normalized * 60)
  const minutesPerMonth = 30 * 24 * 60
  const minutesPerDay = 24 * 60
  const months = Math.floor(totalMinutes / minutesPerMonth)
  const afterMonths = totalMinutes % minutesPerMonth
  const days = Math.floor(afterMonths / minutesPerDay)
  const afterDays = afterMonths % minutesPerDay

  return {
    months,
    days,
    hours: Math.floor(afterDays / 60),
    minutes: afterDays % 60,
  }
}

const combineQuotaWindowParts = (
  monthsValue: unknown,
  daysValue: unknown,
  hoursValue: unknown,
  minutesValue: unknown,
): number | undefined => {
  const months = clampNonNegativeInteger(monthsValue, MAX_QUOTA_WINDOW_MONTHS)
  const days = clampNonNegativeInteger(daysValue, MAX_QUOTA_WINDOW_DAYS)
  const hours = clampNonNegativeInteger(hoursValue, MAX_QUOTA_WINDOW_HOUR_PART)
  const minutes = clampNonNegativeInteger(minutesValue, MAX_QUOTA_WINDOW_MINUTE_PART)
  const totalHours = months * 30 * 24 + days * 24 + hours + minutes / 60
  return normalizeQuotaWindowHours(totalHours)
}

const createEditableQuotaWindow = (
  input?: Partial<RelayTokenQuotaWindowLike>,
): EditableQuotaWindow => {
  const quotaUnit = normalizeQuotaUnit(input?.quotaUnit)
  const normalizedQuotaWindowHours =
    normalizeQuotaWindowHours(input?.quotaWindowHours) ?? DEFAULT_QUOTA_WINDOW_HOURS
  const { months, days, hours, minutes } = splitQuotaWindowParts(normalizedQuotaWindowHours)
  const initialQuotaLimit =
    input?.quotaLimit != null && Number.isFinite(Number(input.quotaLimit))
      ? Number(input.quotaLimit)
      : getQuotaMin(quotaUnit)

  return {
    id: input?.id,
    quotaLimit: normalizeQuotaForUnitSwitch(initialQuotaLimit, quotaUnit),
    quotaUnit,
    quotaWindowHours: normalizedQuotaWindowHours,
    months,
    days,
    hours,
    minutes,
  }
}

type QuotaWindowPreviewMode = (typeof QUOTA_WINDOW_PREVIEW_CYCLE)[number]

export const useRelayTokenManagement = () => {
  const { isDesktop } = usePageDevice()
  const { setHidden: setFloatingOverlayHidden, reset: resetFloatingOverlayHidden } =
    useFloatingOverlayVisibility()
  const permissionStore = usePermissionStore()
  const userInfoStore = useUserInfoStore()

  const serverTokens = ref<RelayTokenDto[]>([])
  const allTokensCache = ref<RelayTokenDto[] | null>(null)
  const userOptions = ref<Array<Pick<UserDto, 'id' | 'username' | 'name'>>>([])
  const userOptionsLoading = ref(false)
  const selectedTargetUserId = ref('')
  const tokenTableRef = ref<TableInstance>()
  const channels = ref<RelayChannelOptionDto[]>([])
  const channelsLoading = ref(false)
  const channelsLoadError = ref<unknown>(null)
  const quotaWindowPreviewModes = ref<Record<string, number>>({})
  const loadingTokens = ref(false)
  const showEditDialog = ref(false)
  const saving = ref(false)
  const editMode = ref<'create' | 'edit'>('create')
  const currentEditId = ref('')
  const DEFAULT_EDIT_DIALOG_SECTIONS = ['basic', 'channelFailover', 'quota']
  const editDialogSectionNames = ref<string[]>([...DEFAULT_EDIT_DIALOG_SECTIONS])
  const showSwitchLogDialog = ref(false)
  const loadingSwitchLogs = ref(false)
  const currentSwitchLogTokenId = ref('')
  const currentSwitchLogTokenName = ref('')
  const switchLogs = ref<RelayChannelSwitchLogDto[]>([])
  const showBalanceScriptDialog = ref(false)
  const currentBalanceScriptToken = ref<RelayTokenDto | null>(null)
  const showV1BalanceScriptDialog = ref(false)
  const currentV1BalanceScriptToken = ref<RelayTokenDto | null>(null)
  const showQuotaWindowDetailDialog = ref(false)
  const currentQuotaWindowDetailToken = ref<RelayTokenDto | null>(null)
  const retryStatusCodeOptions = DEFAULT_RETRY_STATUS_CODES
  const currentPage = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const pageSizeOptions = [10, 20, 50, 100]
  const searchKeyword = ref('')
  const searchTokenKeyword = ref('')
  const activeSearchKeyword = ref('')
  const activeSearchTokenKeyword = ref('')
  const showAllMode = ref(false)
  const selectedTokenIds = ref<string[]>([])
  const showTokenImportDialog = ref(false)
  const tokenImportText = ref('')

  const canManageAllTokens = computed(() =>
    permissionStore.hasPermission(Permission.RELAY_TOKEN_MANAGE_OTHERS_READ),
  )

  const currentTargetUserId = computed(() => {
    const normalized = selectedTargetUserId.value.trim()
    return normalized || userInfoStore.userInfo.id || ''
  })

  const currentTargetUserIdForRequest = computed(() => {
    const currentUserId = userInfoStore.userInfo.id || ''
    return currentTargetUserId.value && currentTargetUserId.value !== currentUserId
      ? currentTargetUserId.value
      : undefined
  })

  const normalizeSearchText = (value?: string | null) =>
    String(value || '')
      .trim()
      .toLowerCase()

  const normalizedSearchKeyword = computed(() => normalizeSearchText(activeSearchKeyword.value))
  const normalizedSearchTokenKeyword = computed(() =>
    normalizeSearchText(activeSearchTokenKeyword.value),
  )

  const hasSearchFilters = computed(
    () => Boolean(normalizedSearchKeyword.value) || Boolean(normalizedSearchTokenKeyword.value),
  )

  const isLocalTokenMode = computed(() => showAllMode.value || hasSearchFilters.value)

  const filteredAllTokens = computed(() => {
    const keyword = normalizedSearchKeyword.value
    const tokenKeyword = normalizedSearchTokenKeyword.value

    return (allTokensCache.value || []).filter((row) => {
      const matchesKeyword =
        !keyword ||
        [row.name, row.id, row.channelName, row.allowedModels]
          .map((item) => normalizeSearchText(item))
          .some((item) => item.includes(keyword))

      const matchesToken = !tokenKeyword || normalizeSearchText(row.token).includes(tokenKeyword)

      return matchesKeyword && matchesToken
    })
  })

  const paginationTotal = computed(() =>
    isLocalTokenMode.value ? filteredAllTokens.value.length : total.value,
  )

  const showPagination = computed(() => !showAllMode.value && paginationTotal.value > 0)

  const tokens = computed<RelayTokenDto[]>(() => {
    if (!isLocalTokenMode.value) return serverTokens.value
    if (showAllMode.value) return filteredAllTokens.value

    const start = (currentPage.value - 1) * pageSize.value
    return filteredAllTokens.value.slice(start, start + pageSize.value)
  })

  const selectedTokenIdSet = computed(() => new Set(selectedTokenIds.value))

  const selectedTokens = computed(() => {
    const tokenMap = new Map<string, RelayTokenDto>()

    for (const token of serverTokens.value) tokenMap.set(token.id, token)
    for (const token of allTokensCache.value || []) tokenMap.set(token.id, token)
    for (const token of tokens.value) tokenMap.set(token.id, token)

    return selectedTokenIds.value
      .map((id) => tokenMap.get(id))
      .filter((token): token is RelayTokenDto => Boolean(token))
  })

  const desktopChannelListRef = ref<HTMLElement | null>(null)
  const mobileChannelListRef = ref<HTMLElement | null>(null)
  let desktopSortable: Sortable | null = null
  let mobileSortable: Sortable | null = null

  const createEmptyEditForm = () => ({
    name: '',
    token: '',
    channelId: '' as string,
    expiresAt: null as Date | null,
    quotaLimit: null as number | null,
    originalQuotaWindowsEnabled: false,
    quotaWindowsEnabled: false,
    quotaWindows: [] as EditableQuotaWindow[],
    allowedModels: '',
    ipWhitelist: [] as string[],
    allowedModelIdsList: [] as string[],
    routingMode: 'ordered' as RelayRoutingMode,
    automaticProxyPoolChannelId: '',
    channelConfigs: [createEmptyChannelConfig(0)] as EditableChannelConfig[],
    failoverConfig: createDefaultFailoverConfig() as EditableFailoverConfig,
    modelMapping: {} as Record<string, string>,
  })

  const editForm = ref({
    ...createEmptyEditForm(),
  })

  const channelNameMap = computed(
    () => new Map(channels.value.map((channel) => [channel.id, channel.name])),
  )

  const activeChannelIdSet = computed(() => new Set(channels.value.map((channel) => channel.id)))

  const automaticProxyPoolChannelOptions = computed(() =>
    channels.value.filter((channel) => channel.channelType === 'automatic-proxy-pool'),
  )

  const orderedChannelOptions = computed(() =>
    channels.value.filter((channel) => channel.channelType !== 'automatic-proxy-pool'),
  )

  const selectedChannelConfigKeys = ref<string[]>([])
  const tokenChannelBatchAddIds = ref<string[]>([])
  const showTokenChannelImportDialog = ref(false)
  const tokenChannelImportText = ref('')

  const selectedChannelConfigKeySet = computed(() => new Set(selectedChannelConfigKeys.value))

  const selectedChannelConfigs = computed(() =>
    editForm.value.channelConfigs.filter((config) =>
      selectedChannelConfigKeySet.value.has(config.tempKey),
    ),
  )

  const hasSelectedChannelConfigs = computed(() => selectedChannelConfigs.value.length > 0)

  const isAllChannelConfigsSelected = computed(
    () =>
      editForm.value.channelConfigs.length > 0 &&
      selectedChannelConfigKeys.value.length === editForm.value.channelConfigs.length,
  )

  const tokenChannelBatchAddOptions = computed(() => {
    const selectedIds = new Set(
      editForm.value.channelConfigs.map((config) => config.channelId.trim()).filter(Boolean),
    )
    return orderedChannelOptions.value.filter((channel) => !selectedIds.has(channel.id))
  })

  const unavailableChannelConfigs = computed(() =>
    editForm.value.channelConfigs
      .map((config, index) => ({
        channelId: config.channelId.trim(),
        priority: index,
      }))
      .filter((config) => config.channelId && !activeChannelIdSet.value.has(config.channelId)),
  )

  const showUnavailableChannelWarning = computed(
    () => editMode.value === 'edit' && unavailableChannelConfigs.value.length > 0,
  )

  const unavailableChannelWarningText = computed(() =>
    i18ns.t('relay.unavailableChannelsWarningDesc', {
      channels: unavailableChannelConfigs.value
        .map((config) =>
          i18ns.t('relay.unavailableChannelSummaryItem', {
            order: config.priority + 1,
            channelId: config.channelId,
          }),
        )
        .join('；'),
    }),
  )

  const normalizeChannelConfigs = (configs: EditableChannelConfig[]) =>
    configs.map((config, index) => ({
      ...config,
      priority: index,
    }))

  const syncSelectedChannelConfigKeys = () => {
    const validKeys = new Set(editForm.value.channelConfigs.map((config) => config.tempKey))
    selectedChannelConfigKeys.value = selectedChannelConfigKeys.value.filter((key) =>
      validKeys.has(key),
    )
  }

  const syncTokenChannelBatchAddIds = () => {
    const availableIds = new Set(tokenChannelBatchAddOptions.value.map((channel) => channel.id))
    tokenChannelBatchAddIds.value = tokenChannelBatchAddIds.value.filter((id) =>
      availableIds.has(id),
    )
  }

  const replaceChannelConfigs = (configs: EditableChannelConfig[]) => {
    const normalizedConfigs = normalizeChannelConfigs(configs)
    editForm.value.channelConfigs = normalizedConfigs.length
      ? normalizedConfigs
      : [createEmptyChannelConfig(0)]
    syncSelectedChannelConfigKeys()
    syncTokenChannelBatchAddIds()
  }

  const resetTokenChannelEditorState = () => {
    selectedChannelConfigKeys.value = []
    tokenChannelBatchAddIds.value = []
    showTokenChannelImportDialog.value = false
    tokenChannelImportText.value = ''
  }

  const toggleAllChannelConfigSelections = () => {
    if (isAllChannelConfigsSelected.value) {
      selectedChannelConfigKeys.value = []
      return
    }

    selectedChannelConfigKeys.value = editForm.value.channelConfigs.map((config) => config.tempKey)
  }

  const buildTokenChannelExportItems = () => {
    const seen = new Set<string>()

    return editForm.value.channelConfigs.map((config, index) => {
      const channelId = config.channelId.trim()

      if (!channelId) {
        throw new Error(i18ns.t('relay.channelRequired'))
      }

      if (seen.has(channelId)) {
        throw new Error(i18ns.t('relay.duplicateChannels'))
      }

      seen.add(channelId)

      return {
        channelId,
        priority: index,
        channelName: channelNameMap.value.get(channelId) || channelId,
      }
    })
  }

  const buildTokenChannelExportContent = () =>
    JSON.stringify(buildTokenChannelExportItems(), null, 2)

  const downloadJsonFile = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  const parseImportedTokenChannelConfigs = (rawContent: string): EditableChannelConfig[] => {
    let parsed: unknown

    try {
      parsed = JSON.parse(rawContent)
    } catch {
      throw new Error(i18ns.t('relay.tokenChannelImportFormatError'))
    }

    if (!Array.isArray(parsed)) {
      throw new Error(i18ns.t('relay.tokenChannelImportFormatError'))
    }

    const seen = new Set<string>()

    return parsed.map((item, index) => {
      const channelId =
        typeof item === 'string'
          ? item.trim()
          : item && typeof item === 'object'
            ? String((item as { channelId?: unknown }).channelId ?? '').trim()
            : ''

      if (!channelId) {
        throw new Error(i18ns.t('relay.tokenChannelImportFormatError'))
      }

      if (seen.has(channelId)) {
        throw new Error(i18ns.t('relay.duplicateChannels'))
      }

      seen.add(channelId)
      return createEmptyChannelConfig(index, channelId)
    })
  }

  const handleCopyTokenChannelConfigs = async () => {
    try {
      const copied = await copyTextWithFallback(buildTokenChannelExportContent())
      if (!copied) {
        throw new Error(i18ns.t('copyFailed'))
      }

      ElMessage.success(i18ns.t('copySuccess'))
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('copyFailed'))
    }
  }

  const handleExportTokenChannelConfigs = () => {
    try {
      const fileSuffix = currentEditId.value || editMode.value
      downloadJsonFile(
        `relay-token-channel-configs-${fileSuffix}.json`,
        buildTokenChannelExportContent(),
      )
      ElMessage.success(i18ns.t('relay.tokenChannelExportSuccess'))
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    }
  }

  const openTokenChannelImportDialog = () => {
    tokenChannelImportText.value = ''
    showTokenChannelImportDialog.value = true
  }

  const handleImportTokenChannelConfigs = () => {
    try {
      replaceChannelConfigs(parseImportedTokenChannelConfigs(tokenChannelImportText.value))
      tokenChannelImportText.value = ''
      showTokenChannelImportDialog.value = false
      ElMessage.success(i18ns.t('relay.tokenChannelImportSuccess'))
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.tokenChannelImportFormatError'))
    }
  }

  const handleBatchAddTokenChannels = () => {
    if (!tokenChannelBatchAddIds.value.length) {
      ElMessage.warning(i18ns.t('relay.tokenChannelSelectChannelsFirst'))
      return
    }

    const existingConfigs = editForm.value.channelConfigs.filter((config) =>
      config.channelId.trim(),
    )
    const existingIds = new Set(existingConfigs.map((config) => config.channelId.trim()))
    const additions = tokenChannelBatchAddIds.value
      .filter((channelId) => !existingIds.has(channelId))
      .map((channelId, index) =>
        createEmptyChannelConfig(existingConfigs.length + index, channelId),
      )

    replaceChannelConfigs([...existingConfigs, ...additions])
    tokenChannelBatchAddIds.value = []
  }

  const handleBatchRemoveTokenChannelConfigs = () => {
    if (!hasSelectedChannelConfigs.value) {
      ElMessage.warning(i18ns.t('relay.tokenChannelSelectConfigsFirst'))
      return
    }

    replaceChannelConfigs(
      editForm.value.channelConfigs.filter(
        (config) => !selectedChannelConfigKeySet.value.has(config.tempKey),
      ),
    )
  }

  const selectedChannelAllowedModels = computed(() => {
    const selectedChannelIds = new Set(
      editForm.value.channelConfigs.map((config) => config.channelId.trim()).filter(Boolean),
    )
    const resolvedModels = channels.value
      .filter((channel) => selectedChannelIds.has(channel.id))
      .flatMap((channel) =>
        channel.modelCapabilities.map((capability) => capability.requestModelId),
      )

    // Keep saved choices visible while editing even if their channel is no longer available.
    return [...new Set([...resolvedModels, ...editForm.value.allowedModelIdsList])].sort(
      (left, right) => left.localeCompare(right),
    )
  })

  const filteredModelIds = computed(() => selectedChannelAllowedModels.value)
  const channelFilteredModelNames = computed(() => selectedChannelAllowedModels.value)

  const requiredRetrySlots = computed(() => Math.max(0, editForm.value.channelConfigs.length - 1))

  const showMaxRetriesRiskWarning = computed(
    () =>
      editForm.value.failoverConfig.enabled &&
      editForm.value.channelConfigs.length > 1 &&
      editForm.value.failoverConfig.maxRetries < requiredRetrySlots.value,
  )

  const maxRetriesRiskWarningText = computed(() =>
    i18ns.t('relay.maxRetriesRiskWarning', {
      configured: editForm.value.failoverConfig.maxRetries,
      recommended: requiredRetrySlots.value,
      totalChannels: editForm.value.channelConfigs.length,
    }),
  )

  const getModelIdDisplayLabel = (modelId: string): string => {
    return modelId
  }

  watch(
    () => [editForm.value.channelConfigs.map((config) => config.channelId).join(',')],
    () => {
      editForm.value.channelId = editForm.value.channelConfigs[0]?.channelId || ''
      syncTokenChannelBatchAddIds()
    },
    { deep: true },
  )

  watch(
    () => editForm.value.routingMode,
    (routingMode) => {
      if (routingMode !== 'ordered') return
      const orderedIds = new Set(orderedChannelOptions.value.map((channel) => channel.id))
      replaceChannelConfigs(
        editForm.value.channelConfigs.filter(
          (config) => !config.channelId || orderedIds.has(config.channelId),
        ),
      )
    },
  )

  watch(showEditDialog, (isOpen) => {
    setFloatingOverlayHidden(isOpen)
    if (isOpen) {
      setTimeout(() => {
        initSortable()
      }, 100)
    } else {
      resetTokenChannelEditorState()
      destroySortable()
    }
  })

  onBeforeUnmount(() => {
    resetFloatingOverlayHidden()
  })

  const initSortable = () => {
    if (desktopChannelListRef.value) {
      desktopSortable = new Sortable(desktopChannelListRef.value, {
        animation: 150,
        handle: '.channel-config-drag-handle',
        draggable: '.channel-config-row',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        onEnd: (evt) => {
          const fromIndex = parseInt(evt.item.dataset.index ?? '-1', 10)
          const toRows = Array.from(evt.to.querySelectorAll(':scope > .channel-config-row'))
          const toIndex = toRows.indexOf(evt.item)
          if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
            const configs = [...editForm.value.channelConfigs]
            const [moved] = configs.splice(fromIndex, 1)
            configs.splice(toIndex, 0, moved!)
            editForm.value.channelConfigs = configs.map((config, index) => ({
              ...config,
              priority: index,
            }))
          }
        },
      })
    }

    if (mobileChannelListRef.value) {
      mobileSortable = new Sortable(mobileChannelListRef.value, {
        animation: 150,
        handle: '.channel-config-drag-handle',
        draggable: '.channel-config-row',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        onEnd: (evt) => {
          const fromIndex = parseInt(evt.item.dataset.index ?? '-1', 10)
          const toRows = Array.from(evt.to.querySelectorAll(':scope > .channel-config-row'))
          const toIndex = toRows.indexOf(evt.item)
          if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
            const configs = [...editForm.value.channelConfigs]
            const [moved] = configs.splice(fromIndex, 1)
            configs.splice(toIndex, 0, moved!)
            editForm.value.channelConfigs = configs.map((config, index) => ({
              ...config,
              priority: index,
            }))
          }
        },
      })
    }
  }

  const destroySortable = () => {
    if (desktopSortable) {
      desktopSortable.destroy()
      desktopSortable = null
    }
    if (mobileSortable) {
      mobileSortable.destroy()
      mobileSortable = null
    }
  }

  const invalidateAllTokensCache = () => {
    allTokensCache.value = null
  }

  const ensureUserOption = (userId?: string, username?: string | null, name?: string | null) => {
    if (!userId) return
    if (userOptions.value.some((item) => item.id === userId)) return

    userOptions.value = [
      {
        id: userId,
        username: username || userId,
        name: name || null,
      },
      ...userOptions.value,
    ]
  }

  const loadUserOptions = async (keyword?: string) => {
    if (!canManageAllTokens.value) return

    userOptionsLoading.value = true
    try {
      const result = await userService.getAllUsers({
        page: 1,
        pageSize: 100,
        keyword: keyword?.trim() || undefined,
      })
      const users = Array.isArray(result?.users) ? result.users : []
      userOptions.value = users
        .map((item: UserDto) => ({
          id: item.id,
          username: item.username || item.id,
          name: item.name || null,
        }))
        .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username))

      ensureUserOption(
        userInfoStore.userInfo.id,
        userInfoStore.userInfo.username,
        userInfoStore.userInfo.name,
      )
    } catch (_error) {
      userOptions.value = []
    } finally {
      userOptionsLoading.value = false
    }
  }

  const handleTargetUserSearch = (query: string) => {
    void loadUserOptions(query)
  }

  const handleTargetUserChange = () => {
    currentPage.value = 1
    clearTokenSelection()
    invalidateAllTokensCache()
    void loadChannels()
    void loadTokens({ forceAllReload: true })
  }

  const syncSelectedTokenIds = () => {
    const availableIds = new Set<string>()
    for (const token of serverTokens.value) availableIds.add(token.id)
    for (const token of allTokensCache.value || []) availableIds.add(token.id)
    for (const token of tokens.value) availableIds.add(token.id)

    selectedTokenIds.value = selectedTokenIds.value.filter((id) => availableIds.has(id))
  }

  const loadAllTokens = async (force = false) => {
    if (allTokensCache.value && !force) return allTokensCache.value

    const mergedTokens: RelayTokenDto[] = []
    const batchSize = 100
    let nextPage = 1
    let expectedTotal = 0

    while (true) {
      const result = await relayTokenService.getRelayTokens({
        page: nextPage,
        pageSize: batchSize,
        targetUserId: currentTargetUserIdForRequest.value,
      })

      const items = result.items || []
      mergedTokens.push(...items)
      expectedTotal = result.total || mergedTokens.length

      if (!items.length || mergedTokens.length >= expectedTotal) break
      nextPage += 1
    }

    allTokensCache.value = mergedTokens
    return mergedTokens
  }

  const loadTokens = async (options?: { forceAllReload?: boolean }) => {
    loadingTokens.value = true
    try {
      if (isLocalTokenMode.value) {
        await loadAllTokens(options?.forceAllReload)

        const maxPage = Math.max(1, Math.ceil(filteredAllTokens.value.length / pageSize.value))
        if (showAllMode.value) {
          currentPage.value = 1
        } else if (currentPage.value > maxPage) {
          currentPage.value = maxPage
        }

        total.value = filteredAllTokens.value.length
        serverTokens.value = []
        syncSelectedTokenIds()
        return
      }

      const result = await relayTokenService.getRelayTokens({
        page: currentPage.value,
        pageSize: pageSize.value,
        targetUserId: currentTargetUserIdForRequest.value,
      })
      const relayTokens = result.items || []

      currentPage.value = result.page || currentPage.value
      pageSize.value = result.pageSize || pageSize.value
      total.value = result.total || 0
      serverTokens.value = relayTokens
      syncSelectedTokenIds()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    } finally {
      loadingTokens.value = false
    }
  }

  const refreshTokens = () => {
    void loadTokens({ forceAllReload: true })
  }

  const handleTokenSelectionChange = (rows: RelayTokenDto[]) => {
    selectedTokenIds.value = rows.map((row) => row.id)
  }

  const handleMobileTokenSelectionChange = (id: string, checked: boolean | string | number) => {
    if (checked) {
      if (!selectedTokenIdSet.value.has(id)) {
        selectedTokenIds.value = [...selectedTokenIds.value, id]
      }
      return
    }

    selectedTokenIds.value = selectedTokenIds.value.filter((item) => item !== id)
  }

  const handleSelectAllVisibleTokens = () => {
    selectedTokenIds.value = tokens.value.map((token) => token.id)

    if (isDesktop.value) {
      tokenTableRef.value?.clearSelection()
      tokens.value.forEach((token) => tokenTableRef.value?.toggleRowSelection(token, true))
    }
  }

  const clearTokenSelection = () => {
    selectedTokenIds.value = []
    tokenTableRef.value?.clearSelection()
  }

  const ensureSelectedTokenIds = () => {
    syncSelectedTokenIds()

    if (!selectedTokenIds.value.length) {
      ElMessage.warning(i18ns.t('relay.selectTokensFirst'))
      return null
    }

    return [...selectedTokenIds.value]
  }

  const buildRelayTokenExportItems = (tokensToExport: RelayTokenDto[]): RelayTokenImportItemDto[] =>
    tokensToExport.map((token) => ({
      name: token.name || null,
      expiresAt: token.expiresAt || null,
      quotaLimit: token.quotaLimit ?? null,
      allowedModels: token.allowedModels || null,
      ipWhitelist: token.ipWhitelist || null,
      modelMapping: token.modelMapping || undefined,
      enabled: token.status === MANAGED_STATUS.ENABLED,
      channelConfigs: (token.channelConfigs || []).map((config) => ({
        channelId: config.channelId,
        priority: config.priority,
      })),
      failoverConfig: token.failoverConfig
        ? {
            enabled: Boolean(token.failoverConfig.enabled),
            maxRetries: token.failoverConfig.maxRetries ?? 0,
            retryStatusCodes: token.failoverConfig.retryStatusCodes || [],
            failoverThreshold: token.failoverConfig.failoverThreshold ?? 0,
            failbackCooldownMinutes: token.failoverConfig.failbackCooldownMinutes ?? 0,
          }
        : undefined,
    }))

  const downloadRelayTokenExport = (items: RelayTokenImportItemDto[], fileSuffix = 'batch') => {
    downloadJsonFile(`relay-tokens-${fileSuffix}.json`, JSON.stringify(items, null, 2))
  }

  const copyRelayTokenExportItems = async (items: RelayTokenImportItemDto[]) => {
    try {
      const copied = await copyTextWithFallback(JSON.stringify(items, null, 2))

      if (!copied) {
        throw new Error(i18ns.t('copyFailed'))
      }

      ElMessage.success(i18ns.t('copySuccess'))
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('copyFailed'))
    }
  }

  const handleCopySingleTokenJson = async (row: RelayTokenDto) => {
    try {
      const result = await relayTokenService.exportTokens({
        ids: [row.id],
        targetUserId: currentTargetUserIdForRequest.value,
      })
      await copyRelayTokenExportItems(result.tokens || buildRelayTokenExportItems([row]))
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    }
  }

  const openTokenImportDialog = () => {
    tokenImportText.value = ''
    showTokenImportDialog.value = true
  }

  const handleExportSingleToken = async (row: RelayTokenDto) => {
    try {
      const result = await relayTokenService.exportTokens({
        ids: [row.id],
        targetUserId: currentTargetUserIdForRequest.value,
      })
      downloadRelayTokenExport(result.tokens || buildRelayTokenExportItems([row]), row.id)
      ElMessage.success(i18ns.t('relay.tokenExportSuccess'))
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    }
  }

  const handleBatchExportTokens = async () => {
    const ids = ensureSelectedTokenIds()
    if (!ids) return

    try {
      const result = await relayTokenService.exportTokens({
        ids,
        targetUserId: currentTargetUserIdForRequest.value,
      })
      downloadRelayTokenExport(result.tokens || buildRelayTokenExportItems(selectedTokens.value))
      ElMessage.success(i18ns.t('relay.tokenExportSuccess'))
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    }
  }

  const copyToken = async (token: string) => {
    try {
      const copied = await copyTextWithFallback(token)

      if (!copied) {
        throw new Error(i18ns.t('copyFailed'))
      }

      ElMessage.success(i18ns.t('copySuccess'))
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('copyFailed'))
    }
  }

  const handleBatchCopyTokenValues = async () => {
    const ids = ensureSelectedTokenIds()
    if (!ids) return

    const selectedRows = selectedTokens.value.filter((token) => ids.includes(token.id))
    if (!selectedRows.length) {
      ElMessage.warning(i18ns.t('relay.selectTokensFirst'))
      return
    }

    await copyToken(selectedRows.map((token) => token.token).join('\n'))
  }

  const handleBatchCopyTokenJson = async () => {
    const ids = ensureSelectedTokenIds()
    if (!ids) return

    try {
      const result = await relayTokenService.exportTokens({
        ids,
        targetUserId: currentTargetUserIdForRequest.value,
      })
      await copyRelayTokenExportItems(
        result.tokens || buildRelayTokenExportItems(selectedTokens.value),
      )
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    }
  }

  const handleDuplicateSingleToken = async (row: RelayTokenDto) => {
    try {
      await relayTokenService.duplicateToken(row.id, {
        targetUserId: currentTargetUserIdForRequest.value,
      })
      invalidateAllTokensCache()
      ElMessage.success(i18ns.t('relay.tokenDuplicateSuccess'))
      await loadTokens({ forceAllReload: true })
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }

  const handleBatchDuplicateTokens = async () => {
    const ids = ensureSelectedTokenIds()
    if (!ids) return
    const count = ids.length

    try {
      await relayTokenService.batchDuplicateTokens({
        ids,
        targetUserId: currentTargetUserIdForRequest.value,
      })
      invalidateAllTokensCache()
      clearTokenSelection()
      ElMessage.success(i18ns.t('relay.tokenBatchDuplicateSuccess', { count }))
      await loadTokens({ forceAllReload: true })
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }

  const handleBatchSetTokenStatus = async (enabled: boolean) => {
    const ids = ensureSelectedTokenIds()
    if (!ids) return
    const count = ids.length

    try {
      await relayTokenService.batchSetTokenStatus({
        ids,
        enabled,
        targetUserId: currentTargetUserIdForRequest.value,
      })
      invalidateAllTokensCache()
      clearTokenSelection()
      ElMessage.success(
        i18ns.t('relay.tokenBatchStatusSuccess', {
          count,
          action: enabled ? i18ns.t('relay.enable') : i18ns.t('relay.disable'),
        }),
      )
      await loadTokens({ forceAllReload: true })
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }

  const handleBatchDeleteTokens = async () => {
    const ids = ensureSelectedTokenIds()
    if (!ids) return
    const count = ids.length

    try {
      await ElMessageBox.confirm(i18ns.t('relay.confirmBatchDeleteTokens'), i18ns.t('warning'), {
        type: 'warning',
      })
      await relayTokenService.batchDeleteTokens({
        ids,
        targetUserId: currentTargetUserIdForRequest.value,
      })
      invalidateAllTokensCache()
      clearTokenSelection()
      ElMessage.success(i18ns.t('relay.tokenBatchDeleteSuccess', { count }))
      await loadTokens({ forceAllReload: true })
    } catch (error: any) {
      if (error !== 'cancel') {
        ElMessage.error(error.message || i18ns.t('operationFailed'))
      }
    }
  }

  const handleBatchTokenCommand = async (command: string) => {
    switch (command) {
      case 'copy-json':
        await handleBatchCopyTokenJson()
        break
      case 'copy-token-value':
        await handleBatchCopyTokenValues()
        break
      case 'export':
        await handleBatchExportTokens()
        break
      case 'duplicate':
        await handleBatchDuplicateTokens()
        break
      case 'enable':
        await handleBatchSetTokenStatus(true)
        break
      case 'disable':
        await handleBatchSetTokenStatus(false)
        break
      case 'delete':
        await handleBatchDeleteTokens()
        break
      default:
        break
    }
  }

  const parseImportedTokens = (rawContent: string): RelayTokenImportItemDto[] => {
    let parsed: unknown

    try {
      parsed = JSON.parse(rawContent)
    } catch {
      throw new Error(i18ns.t('relay.tokenImportFormatError'))
    }

    const imported =
      parsed && typeof parsed === 'object' && 'tokens' in (parsed as Record<string, unknown>)
        ? (parsed as { tokens?: unknown }).tokens
        : parsed

    if (!Array.isArray(imported)) {
      throw new Error(i18ns.t('relay.tokenImportFormatError'))
    }

    return imported as RelayTokenImportItemDto[]
  }

  const handleImportTokens = async () => {
    try {
      const importItems = parseImportedTokens(tokenImportText.value)
      const result: ImportRelayTokensResponse = await relayTokenService.importTokens({
        tokens: importItems,
        targetUserId: currentTargetUserIdForRequest.value,
      })
      tokenImportText.value = ''
      showTokenImportDialog.value = false
      invalidateAllTokensCache()
      clearTokenSelection()
      ElMessage.success(
        i18ns.t('relay.tokenImportSuccess', {
          count: result.created ?? result.total ?? importItems.length,
        }),
      )
      await loadTokens({ forceAllReload: true })
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.tokenImportFormatError'))
    }
  }

  const handleSearch = () => {
    activeSearchKeyword.value = searchKeyword.value
    activeSearchTokenKeyword.value = searchTokenKeyword.value
    currentPage.value = 1
    void loadTokens()
  }

  const toggleShowAll = () => {
    showAllMode.value = !showAllMode.value
    currentPage.value = 1
    void loadTokens()
  }

  const handleCurrentPageChange = (page: number) => {
    currentPage.value = page
    void loadTokens()
  }

  const handlePageSizeChange = (size: number) => {
    pageSize.value = size
    currentPage.value = 1
    void loadTokens()
  }

  const loadChannels = async () => {
    channelsLoading.value = true
    channelsLoadError.value = null
    try {
      channels.value = await relayChannelService.listChannelOptions(
        currentTargetUserIdForRequest.value,
      )
    } catch (error) {
      channelsLoadError.value = error
      channels.value = []
    } finally {
      channelsLoading.value = false
    }
  }

  const openCreateDialog = () => {
    editMode.value = 'create'
    currentEditId.value = ''
    editForm.value = createEmptyEditForm()
    resetTokenChannelEditorState()
    editDialogSectionNames.value = [...DEFAULT_EDIT_DIALOG_SECTIONS]
    showEditDialog.value = true
  }

  const getSortedChannelConfigs = (row: RelayTokenDto): RelayTokenChannelConfigDto[] =>
    [...(row.channelConfigs || [])].sort((a, b) => a.priority - b.priority)

  const isAutomaticPoolToken = (row: RelayTokenDto) =>
    (row as RelayTokenWithRouting).routingMode === 'automatic-pool'

  const getAutomaticProxyPoolChannelId = (row: RelayTokenDto) =>
    (row as RelayTokenWithRouting).automaticProxyPoolChannelId?.trim() || ''

  const getRelayTokenQuotaWindows = (row: RelayTokenDto): RelayTokenQuotaWindowLike[] => {
    const quotaWindows = (row as RelayTokenWithQuotaWindows).quotaWindows
    return Array.isArray(quotaWindows) ? quotaWindows : []
  }

  const openEditDialog = async (row: RelayTokenDto) => {
    editMode.value = 'edit'
    currentEditId.value = row.id
    editDialogSectionNames.value = [...DEFAULT_EDIT_DIALOG_SECTIONS]

    const modelIdsList = row.allowedModels
      ? row.allowedModels
          .split(',')
          .map((m: string) => m.trim())
          .filter(Boolean)
      : []

    const channelConfigs = getSortedChannelConfigs(row).length
      ? getSortedChannelConfigs(row).map((config, index) =>
          createEmptyChannelConfig(index, config.channelId),
        )
      : [createEmptyChannelConfig(0, row.channelId || '')]

    const routingToken = row as RelayTokenWithRouting
    const quotaWindows = getRelayTokenQuotaWindows(row).map((quotaWindow) =>
      createEditableQuotaWindow(quotaWindow),
    )

    editForm.value = {
      name: row.name || '',
      token: '',
      channelId: channelConfigs[0]?.channelId || '',
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      quotaLimit: row.quotaLimit ?? null,
      originalQuotaWindowsEnabled: quotaWindows.length > 0,
      quotaWindowsEnabled: quotaWindows.length > 0,
      quotaWindows,
      allowedModels: row.allowedModels || '',
      ipWhitelist: splitIpWhitelistInput(row.ipWhitelist),
      allowedModelIdsList: modelIdsList,
      routingMode: routingToken.routingMode || 'ordered',
      automaticProxyPoolChannelId: routingToken.automaticProxyPoolChannelId || '',
      channelConfigs,
      failoverConfig: {
        enabled: row.failoverConfig?.enabled ?? false,
        maxRetries: row.failoverConfig?.maxRetries ?? 0,
        retryStatusCodes: row.failoverConfig?.retryStatusCodes?.length
          ? [...row.failoverConfig.retryStatusCodes]
          : [...DEFAULT_RETRY_STATUS_CODES],
        failoverThreshold: row.failoverConfig?.failoverThreshold ?? 0,
        failbackCooldownMinutes: row.failoverConfig?.failbackCooldownMinutes ?? 0,
      },
      modelMapping: (row.modelMapping as Record<string, string>) || {},
    }

    showEditDialog.value = true
  }

  const getAvailableChannelOptions = (currentChannelId: string): ChannelOption[] => {
    const selectedChannelIds = new Set(
      editForm.value.channelConfigs
        .map((config) => config.channelId)
        .filter((channelId) => channelId && channelId !== currentChannelId),
    )

    const options: ChannelOption[] = orderedChannelOptions.value
      .filter((channel) => !selectedChannelIds.has(channel.id) || channel.id === currentChannelId)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        multiplier: channel.multiplier,
      }))

    if (currentChannelId && !activeChannelIdSet.value.has(currentChannelId)) {
      options.unshift({
        id: currentChannelId,
        name: i18ns.t('relay.unavailableChannelOptionLabel'),
        multiplier: 0,
        unavailable: true,
      })
    }

    return options
  }

  const getChannelOptionLabel = (channel: ChannelOption) =>
    channel.unavailable
      ? i18ns.t('relay.unavailableChannelOptionLabelWithId', {
          channelId: channel.id,
        })
      : `${channel.name} (${channel.multiplier}x)`

  const addChannelConfig = () => {
    if (editForm.value.channelConfigs.length >= channels.value.length) return
    editForm.value.channelConfigs.push(
      createEmptyChannelConfig(editForm.value.channelConfigs.length),
    )
    syncTokenChannelBatchAddIds()
  }

  const removeChannelConfig = (index: number) => {
    if (editForm.value.channelConfigs.length === 1) {
      replaceChannelConfigs([])
      return
    }

    replaceChannelConfigs(
      editForm.value.channelConfigs.filter((_, currentIndex) => currentIndex !== index),
    )
  }

  const applyQuotaWindowParts = (quotaWindow: EditableQuotaWindow) => {
    const normalized =
      combineQuotaWindowParts(
        quotaWindow.months,
        quotaWindow.days,
        quotaWindow.hours,
        quotaWindow.minutes,
      ) ?? DEFAULT_QUOTA_WINDOW_HOURS
    quotaWindow.quotaWindowHours = normalized
    const { months, days, hours, minutes } = splitQuotaWindowParts(normalized)
    quotaWindow.months = months
    quotaWindow.days = days
    quotaWindow.hours = hours
    quotaWindow.minutes = minutes
  }

  const handleQuotaWindowUnitChange = (quotaWindow: EditableQuotaWindow) => {
    quotaWindow.quotaUnit = normalizeQuotaUnit(quotaWindow.quotaUnit)
    quotaWindow.quotaLimit = normalizeQuotaForUnitSwitch(
      quotaWindow.quotaLimit ?? getQuotaMin(quotaWindow.quotaUnit),
      quotaWindow.quotaUnit,
    )
  }

  const addQuotaWindow = () => {
    if (saving.value || !editForm.value.quotaWindowsEnabled) return
    if (editForm.value.quotaWindows.length >= MAX_QUOTA_WINDOWS) return
    editForm.value.quotaWindows.push(createEditableQuotaWindow())
  }

  const handleQuotaWindowsToggleChange = (value: string | number | boolean) => {
    if (saving.value) return
    const enabled = Boolean(value)
    editForm.value.quotaWindowsEnabled = enabled

    if (enabled && !editForm.value.quotaWindows.length) {
      editForm.value.quotaWindows.push(createEditableQuotaWindow())
    }
  }

  const getQuotaWindowPreviewKey = (quotaWindow: RelayTokenQuotaWindowLike, index: number) =>
    quotaWindow.id || `draft-${index}`

  const removeQuotaWindow = (index: number) => {
    const targetQuotaWindow = editForm.value.quotaWindows[index]
    if (targetQuotaWindow) {
      const key = getQuotaWindowPreviewKey(targetQuotaWindow, index)
      delete quotaWindowPreviewModes.value[key]
    }
    editForm.value.quotaWindows.splice(index, 1)
  }

  const normalizeQuotaWindowsPayload = () => {
    if (!editForm.value.quotaWindowsEnabled || !editForm.value.quotaWindows.length) return []

    const seen = new Set<string>()

    return editForm.value.quotaWindows.map((quotaWindow, index) => {
      const quotaUnit = normalizeQuotaUnit(quotaWindow.quotaUnit)
      const rawQuotaLimit = Number(quotaWindow.quotaLimit)

      if (!Number.isFinite(rawQuotaLimit)) {
        throw new Error(i18ns.t('relay.quotaWindowLimitRequired', { index: index + 1 }))
      }

      const normalizedQuotaLimit = normalizeQuotaForSubmit(rawQuotaLimit, quotaUnit)
      if (
        normalizedQuotaLimit < getQuotaMin(quotaUnit) ||
        normalizedQuotaLimit > getQuotaMax(quotaUnit)
      ) {
        throw new Error(i18ns.t('relay.quotaWindowLimitOutOfRange', { index: index + 1 }))
      }

      const quotaWindowHours =
        combineQuotaWindowParts(
          quotaWindow.months,
          quotaWindow.days,
          quotaWindow.hours,
          quotaWindow.minutes,
        ) ?? quotaWindow.quotaWindowHours
      const normalizedQuotaWindowHours = normalizeQuotaWindowHours(quotaWindowHours)

      if (normalizedQuotaWindowHours == null) {
        throw new Error(i18ns.t('relay.quotaWindowHoursRequired', { index: index + 1 }))
      }

      const uniqueKey = `${quotaUnit}:${normalizedQuotaWindowHours}`
      if (seen.has(uniqueKey)) {
        throw new Error(i18ns.t('relay.quotaWindowDuplicate'))
      }
      seen.add(uniqueKey)

      quotaWindow.quotaLimit = normalizedQuotaLimit
      quotaWindow.quotaUnit = quotaUnit
      quotaWindow.quotaWindowHours = normalizedQuotaWindowHours
      const { months, days, hours, minutes } = splitQuotaWindowParts(normalizedQuotaWindowHours)
      quotaWindow.months = months
      quotaWindow.days = days
      quotaWindow.hours = hours
      quotaWindow.minutes = minutes

      return {
        quotaLimit: normalizedQuotaLimit,
        quotaUnit,
        quotaWindowHours: normalizedQuotaWindowHours,
      }
    })
  }

  const buildChannelConfigsPayload = () => {
    const trimmedConfigs = editForm.value.channelConfigs.map((config, index) => ({
      channelId: (config.channelId ?? '').trim(),
      priority: index,
    }))

    if (trimmedConfigs.some((config) => !config.channelId)) {
      throw new Error(i18ns.t('relay.channelRequired'))
    }

    const uniqueIds = new Set(trimmedConfigs.map((config) => config.channelId))
    if (uniqueIds.size !== trimmedConfigs.length) {
      throw new Error(i18ns.t('relay.duplicateChannels'))
    }

    const automaticPoolIds = new Set(automaticProxyPoolChannelOptions.value.map((channel) => channel.id))
    if (trimmedConfigs.some((config) => automaticPoolIds.has(config.channelId))) {
      throw new Error(i18ns.t('relay.channelRequired'))
    }

    const unavailableChannelIds = trimmedConfigs
      .map((config) => config.channelId)
      .filter((channelId) => !activeChannelIdSet.value.has(channelId))

    if (unavailableChannelIds.length) {
      throw new Error(
        i18ns.t('relay.unavailableChannelsSaveError', {
          channels: unavailableChannelIds
            .map((channelId, index) =>
              i18ns.t('relay.unavailableChannelSummaryItem', {
                order: index + 1,
                channelId,
              }),
            )
            .join('；'),
        }),
      )
    }

    return trimmedConfigs
  }

  const normalizeRetryStatusCodes = (codes: Array<string | number>) => {
    const normalizedCodes: string[] = []
    const seen = new Set<string>()

    for (const rawCode of codes) {
      const rawRule = String(rawCode ?? '').trim()
      if (!rawRule) continue

      const normalizedRule = parseRegexRule(rawRule) ? rawRule : rawRule.toLowerCase()
      if (!isValidRetryStatusRule(normalizedRule)) {
        throw new Error(i18ns.t('relay.invalidRetryStatusRule', { rule: rawRule }))
      }

      if (seen.has(normalizedRule)) continue
      seen.add(normalizedRule)
      normalizedCodes.push(normalizedRule)
    }

    return normalizedCodes
  }

  const splitIpWhitelistInput = (value?: string | null) => {
    return String(value || '')
      .split(/[\r\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const normalizeIpWhitelistEntries = (values: Array<string | number>) => {
    const entries = values.map((item) => String(item || '').trim()).filter(Boolean)

    return Array.from(new Set(entries))
  }

  const normalizeIpWhitelistInput = (values: Array<string | number>) => {
    const entries = normalizeIpWhitelistEntries(values)
    return entries.length ? entries.join('\n') : ''
  }

  const normalizeQuotaLimitInput = (value: number | null | undefined): number | null => {
    if (value == null) return null

    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return null

    return round4(numeric)
  }

  const normalizeOptionalDateForSubmit = (
    value: Date | null | undefined,
  ): string | null | undefined => {
    if (!value) return undefined

    const timestamp = value.getTime()
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null

    return value.toISOString()
  }

  const handleSave = async () => {
    saving.value = true
    try {
      const routingMode = editForm.value.routingMode
      const channelConfigs = routingMode === 'ordered' ? buildChannelConfigsPayload() : undefined
      const automaticProxyPoolChannelId = editForm.value.automaticProxyPoolChannelId.trim()
      if (
        routingMode === 'automatic-pool' &&
        !automaticProxyPoolChannelOptions.value.some(
          (channel) => channel.id === automaticProxyPoolChannelId,
        )
      ) {
        throw new Error(i18ns.t('relay.automaticProxyPoolChannelRequired'))
      }
      const quotaWindows = normalizeQuotaWindowsPayload()
      const allowedModelsStr = editForm.value.allowedModelIdsList.join(',')
      const normalizedName = editForm.value.name.trim()
      editForm.value.ipWhitelist = normalizeIpWhitelistEntries(editForm.value.ipWhitelist)
      const ipWhitelist = normalizeIpWhitelistInput(editForm.value.ipWhitelist)
      const normalizedExpiresAt = normalizeOptionalDateForSubmit(editForm.value.expiresAt)

      const failoverConfig = {
        enabled: editForm.value.failoverConfig.enabled,
        maxRetries: editForm.value.failoverConfig.maxRetries,
        retryStatusCodes: normalizeRetryStatusCodes(editForm.value.failoverConfig.retryStatusCodes),
        failoverThreshold: editForm.value.failoverConfig.failoverThreshold,
        failbackCooldownMinutes: editForm.value.failoverConfig.failbackCooldownMinutes,
      }

      const shouldIncludeQuotaWindowsForUpdate =
        editMode.value === 'create' ||
        editForm.value.originalQuotaWindowsEnabled ||
        editForm.value.quotaWindowsEnabled

      if (editMode.value === 'create') {
        const modelMapping =
          editForm.value.modelMapping && Object.keys(editForm.value.modelMapping).length > 0
            ? editForm.value.modelMapping
            : undefined

        const data = {
          name: normalizedName || undefined,
          token: editForm.value.token.trim() || undefined,
          routingMode,
          automaticProxyPoolChannelId:
            routingMode === 'automatic-pool' ? automaticProxyPoolChannelId : undefined,
          ...(channelConfigs ? { channelId: channelConfigs[0]?.channelId, channelConfigs } : {}),
          failoverConfig,
          expiresAt: normalizedExpiresAt ?? undefined,
          quotaLimit: editForm.value.quotaLimit ?? undefined,
          quotaWindows,
          allowedModels: allowedModelsStr || undefined,
          ipWhitelist,
          modelMapping,
          targetUserId: currentTargetUserIdForRequest.value,
        }
        await relayTokenService.createRelayToken(data)
        currentPage.value = 1
        invalidateAllTokensCache()
        ElMessage.success(i18ns.t('relay.createSuccess'))
      } else {
        const modelMapping =
          editForm.value.modelMapping && Object.keys(editForm.value.modelMapping).length > 0
            ? editForm.value.modelMapping
            : null

        const data = {
          name: normalizedName || null,
          token: editForm.value.token.trim() || undefined,
          routingMode,
          automaticProxyPoolChannelId:
            routingMode === 'automatic-pool' ? automaticProxyPoolChannelId : null,
          ...(channelConfigs ? { channelId: channelConfigs[0]?.channelId, channelConfigs } : {}),
          failoverConfig,
          expiresAt: normalizedExpiresAt ?? null,
          quotaLimit: editForm.value.quotaLimit == null ? null : editForm.value.quotaLimit,
          ...(shouldIncludeQuotaWindowsForUpdate ? { quotaWindows } : {}),
          allowedModels: allowedModelsStr || null,
          ipWhitelist: ipWhitelist || null,
          modelMapping,
          targetUserId: currentTargetUserIdForRequest.value,
        }
        await relayTokenService.updateToken(currentEditId.value, data)
        invalidateAllTokensCache()

        ElMessage.success(i18ns.t('relay.updateSuccess'))
      }

      showEditDialog.value = false
      void loadTokens()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.createFailed'))
    } finally {
      saving.value = false
    }
  }

  const handleToggleStatus = async (row: RelayTokenDto) => {
    try {
      const action =
        row.status === MANAGED_STATUS.ENABLED
          ? i18ns.t('relay.disableToken')
          : i18ns.t('relay.enableToken')
      await ElMessageBox.confirm(
        i18ns.t('relay.confirmToggleStatus', { action }),
        i18ns.t('warning'),
        {
          type: 'warning',
        },
      )
      await relayTokenService.toggleTokenStatus(row.id, currentTargetUserIdForRequest.value)
      invalidateAllTokensCache()
      ElMessage.success(i18ns.t('success'))
      void loadTokens()
    } catch (error: any) {
      if (error !== 'cancel') {
        ElMessage.error(error.message || i18ns.t('operationFailed'))
      }
    }
  }

  const handleRefreshToken = async (row: RelayTokenDto) => {
    try {
      await ElMessageBox.confirm(i18ns.t('relay.confirmRefreshToken'), i18ns.t('warning'), {
        type: 'warning',
      })

      const refreshedToken = await relayTokenService.refreshRelayToken(
        row.id,
        currentTargetUserIdForRequest.value,
      )
      invalidateAllTokensCache()

      try {
        await navigator.clipboard.writeText(refreshedToken.token)
        ElMessage.success(i18ns.t('relay.refreshTokenSuccessAndCopied'))
      } catch {
        ElMessage.success(i18ns.t('relay.refreshTokenSuccess'))
      }

      await loadTokens({ forceAllReload: true })
    } catch (error: any) {
      if (error !== 'cancel') {
        ElMessage.error(error.message || i18ns.t('relay.refreshTokenFailed'))
      }
    }
  }

  const getAIEndpointUrl = () =>
    resolveRelayAiBaseUrl(
      import.meta.env.VITE_RELAY_PUBLIC_BASE_URL,
      import.meta.env.VITE_AI_PROXY_URL,
    )

  const RELAY_FORMAT_TO_CCSWITCH_APP: Record<RelayFormat, CcswitchApp> = {
    anthropic: 'claude',
    openai: 'codex',
    gemini: 'gemini',
  }

  const getTokenSupportedFormats = (row: RelayTokenDto): RelayFormat[] => {
    const configuredFormats = new Set<RelayFormat>()
    const channelIds = new Set<string>()

    const automaticProxyPoolChannelId = getAutomaticProxyPoolChannelId(row)
    if (automaticProxyPoolChannelId) channelIds.add(automaticProxyPoolChannelId)

    for (const config of getSortedChannelConfigs(row)) {
      if (config.channelId) channelIds.add(config.channelId)
    }

    if (row.channelId) channelIds.add(row.channelId)

    for (const channelId of channelIds) {
      const channel = channels.value.find((item) => item.id === channelId)
      if (!channel) continue

      for (const format of normalizeRelayFormats(channel.allowedFormats)) {
        configuredFormats.add(format)
      }
    }

    return configuredFormats.size > 0 ? Array.from(configuredFormats) : ['anthropic']
  }

  const getCcswitchLaunchLabel = (format: RelayFormat) => {
    switch (format) {
      case 'openai':
        return i18ns.t('relay.launchGptToCcswitch')
      case 'gemini':
        return i18ns.t('relay.launchGeminiToCcswitch')
      case 'anthropic':
      default:
        return i18ns.t('relay.launchClaudeToCcswitch')
    }
  }

  const maskToken = (token: string, start = 10, end = 8) => {
    const normalized = String(token || '')
    if (normalized.length <= start + end) return normalized
    return `${normalized.slice(0, start)}...${normalized.slice(-end)}`
  }

  const buildCcswitchImportUri = (row: RelayTokenDto, format: RelayFormat) => {
    const baseEndpoint = getAIEndpointUrl()
    const name =
      row.name?.trim() || `${i18ns.t('relay.unnamedToken')} ${maskToken(row.token, 6, 4)}`

    let endpoint: string
    if (format === 'anthropic') {
      endpoint = `${baseEndpoint}`
    } else if (format === 'openai') {
      endpoint = `${baseEndpoint}/v1`
    } else if (format === 'gemini') {
      endpoint = `${baseEndpoint}/v1beta`
    } else {
      throw new Error(i18ns.t('relay.unsupportedFormat', { format }))
    }

    const searchParams = new URLSearchParams({
      resource: 'provider',
      app: RELAY_FORMAT_TO_CCSWITCH_APP[format],
      name,
      endpoint,
      apiKey: row.token,
      homepage: endpoint,
      enabled: 'true',
    })

    return `ccswitch://v1/import?${searchParams.toString()}`
  }

  const openBalanceScriptDialog = (row: RelayTokenDto) => {
    currentBalanceScriptToken.value = row
    showBalanceScriptDialog.value = true
  }

  const switchToV1BalanceScriptDialog = () => {
    if (currentBalanceScriptToken.value) {
      currentV1BalanceScriptToken.value = currentBalanceScriptToken.value
    }
    showBalanceScriptDialog.value = false
    showV1BalanceScriptDialog.value = true
  }

  const handleLaunchToCcswitch = async (row: RelayTokenDto, format: RelayFormat) => {
    try {
      const endpoint = getAIEndpointUrl()
      if (!endpoint) {
        ElMessage.error(i18ns.t('relay.launchToCcswitchMissingEndpoint'))
        return
      }

      const importUri = buildCcswitchImportUri(row, format)
      window.location.href = importUri
      ElMessage.info(i18ns.t('relay.launchToCcswitchSuccess'))
    } catch {
      ElMessage.error(i18ns.t('relay.launchToCcswitchFailed'))
    }
  }

  const handleExportToCcswitch = async (row: RelayTokenDto) => {
    openBalanceScriptDialog(row)
  }

  const handleMoreCommand = async (command: string, row: RelayTokenDto) => {
    if (command.startsWith('launch-ccswitch-')) {
      const format = command.replace('launch-ccswitch-', '') as RelayFormat
      if (format === 'anthropic' || format === 'openai' || format === 'gemini') {
        await handleLaunchToCcswitch(row, format)
      }
    } else if (command === 'duplicate') {
      await handleDuplicateSingleToken(row)
    } else if (command === 'export') {
      await handleExportSingleToken(row)
    } else if (command === 'copy-token-value') {
      await copyToken(row.token)
    } else if (command === 'copy-json') {
      await handleCopySingleTokenJson(row)
    } else if (command === 'export-ccswitch') {
      await handleExportToCcswitch(row)
    } else if (command === 'refresh-token') {
      await handleRefreshToken(row)
    } else if (command === 'open-switch-logs') {
      await openSwitchLogsDialog(row)
    }
  }

  const sortQuotaWindowsForDisplay = (quotaWindows: RelayTokenQuotaWindowLike[]) => {
    return [...quotaWindows].sort((left, right) => {
      const rightPercent =
        right.quotaUsagePercent != null && Number.isFinite(Number(right.quotaUsagePercent))
          ? Number(right.quotaUsagePercent)
          : -1
      const leftPercent =
        left.quotaUsagePercent != null && Number.isFinite(Number(left.quotaUsagePercent))
          ? Number(left.quotaUsagePercent)
          : -1

      if (rightPercent !== leftPercent) {
        return rightPercent - leftPercent
      }

      const leftHours = normalizeQuotaWindowHours(left.quotaWindowHours) ?? Number.POSITIVE_INFINITY
      const rightHours =
        normalizeQuotaWindowHours(right.quotaWindowHours) ?? Number.POSITIVE_INFINITY

      if (leftHours !== rightHours) {
        return leftHours - rightHours
      }

      return Number(right.usedQuota || 0) - Number(left.usedQuota || 0)
    })
  }

  const getSortedRelayTokenQuotaWindows = (row: RelayTokenDto) =>
    sortQuotaWindowsForDisplay(getRelayTokenQuotaWindows(row))

  const getPrimaryRelayTokenQuotaWindows = (row: RelayTokenDto) =>
    getSortedRelayTokenQuotaWindows(row).slice(0, 1)

  const getRemainingRelayTokenQuotaWindowCount = (row: RelayTokenDto) =>
    Math.max(getSortedRelayTokenQuotaWindows(row).length - 1, 0)

  const getVisibleChannelConfigs = (row: RelayTokenDto) =>
    getSortedChannelConfigs(row).slice(0, MAX_VISIBLE_CHANNEL_CONFIGS)

  const getHiddenChannelConfigCount = (row: RelayTokenDto) =>
    Math.max(getSortedChannelConfigs(row).length - MAX_VISIBLE_CHANNEL_CONFIGS, 0)

  const currentQuotaWindowDetailWindows = computed(() =>
    currentQuotaWindowDetailToken.value
      ? getSortedRelayTokenQuotaWindows(currentQuotaWindowDetailToken.value)
      : [],
  )

  const quotaWindowDetailDialogTitle = computed(() => {
    if (!currentQuotaWindowDetailToken.value) return i18ns.t('relay.quotaWindows')

    return `${i18ns.t('relay.quotaWindows')} · ${currentQuotaWindowDetailToken.value.name || i18ns.t('relay.unnamedToken')}`
  })

  const openQuotaWindowDetailDialog = (row: RelayTokenDto) => {
    currentQuotaWindowDetailToken.value = row
    showQuotaWindowDetailDialog.value = true
  }

  const getChannelName = (channelId: string) => channelNameMap.value.get(channelId) || channelId

  const getAutomaticProxyPoolChannelName = (row: RelayTokenDto) => {
    const channelId = getAutomaticProxyPoolChannelId(row)
    return channelId ? getChannelName(channelId) : i18ns.t('relay.noChannel')
  }

  const getTokenQuotaSnapshot = (row: RelayTokenDto): TokenQuotaSnapshot => {
    const usedQuota = Number(row.usedQuota || 0)
    const quotaLimit = row.quotaLimit
    const remainingQuota = quotaLimit != null ? Math.max(quotaLimit - usedQuota, 0) : undefined
    const quotaUsagePercent =
      quotaLimit && quotaLimit > 0 ? (usedQuota / quotaLimit) * 100 : undefined

    return {
      usedQuota,
      remainingQuota,
      quotaUsagePercent,
      isQuotaExceeded: quotaLimit != null ? usedQuota >= quotaLimit : false,
    }
  }

  const formatSuccessRate = (value: number) => `${(Number(value || 0) * 100).toFixed(1)}%`

  const formatRetryStatusCodeOptionLabel = (code: string) => {
    switch (code) {
      case '4xx':
        return i18ns.t('relay.retryStatusCodeLabel4xx')
      case '5xx':
        return i18ns.t('relay.retryStatusCodeLabel5xx')
      case '401':
        return i18ns.t('relay.retryStatusCodeLabel401')
      case '403':
        return i18ns.t('relay.retryStatusCodeLabel403')
      case '405':
        return i18ns.t('relay.retryStatusCodeLabel405')
      case '429':
        return i18ns.t('relay.retryStatusCodeLabel429')
      case '500':
        return i18ns.t('relay.retryStatusCodeLabel500')
      case '502':
        return i18ns.t('relay.retryStatusCodeLabel502')
      case '503':
        return i18ns.t('relay.retryStatusCodeLabel503')
      case '504':
        return i18ns.t('relay.retryStatusCodeLabel504')
      default:
        return code.startsWith('/')
          ? i18ns.t('relay.retryStatusCodeLabelRegex', { rule: code })
          : i18ns.t('relay.retryStatusCodeLabelFallback', { code: String(code) })
    }
  }

  const formatRetryStatusCodes = (codes: Array<string | number>) =>
    codes && codes.length
      ? normalizeRetryStatusCodes(codes)
          .map((code) => formatRetryStatusCodeOptionLabel(code))
          .join(', ')
      : '-'

  const formatChannelSummary = (row: RelayTokenDto) => {
    if (isAutomaticPoolToken(row)) return getAutomaticProxyPoolChannelName(row)

    const configs = getSortedChannelConfigs(row)
    if (!configs.length) return '-'
    const visibleText = getVisibleChannelConfigs(row)
      .map(
        (config) =>
          `#${config.priority + 1} ${config.channelName || getChannelName(config.channelId)}`,
      )
      .join(' · ')

    const hiddenCount = getHiddenChannelConfigCount(row)
    return hiddenCount > 0 ? `${visibleText} · ${i18ns.t('nav.more')} ${hiddenCount}` : visibleText
  }

  const formatNumber = (num: number) => num.toLocaleString('zh-CN')

  const formatTokenStatsSummary = (row: RelayTokenDto) => {
    return `${row.requestCount || 0} / ${formatNumber(row.totalTokens || 0)}`
  }

  const formatCompactFailoverSummary = (row: RelayTokenDto) => {
    if (!row.failoverConfig?.enabled) return `${i18ns.t('relay.maxRetries')}: 0`
    const retryCodes = normalizeRetryStatusCodes(row.failoverConfig.retryStatusCodes || [])
    const threshold = row.failoverConfig.failoverThreshold ?? 0
    const failbackCooldownMinutes = Math.max(0, row.failoverConfig.failbackCooldownMinutes ?? 0)
    const cooldownText = failbackCooldownMinutes
      ? ` · ${i18ns.t('relay.failbackCooldownCompact', { minutes: failbackCooldownMinutes })}`
      : ''
    return `${i18ns.t('relay.maxRetries')}: ${row.failoverConfig.maxRetries} · ${i18ns.t('relay.failoverThreshold')}: ${threshold} · ${retryCodes.length}${i18ns.t('relay.statusCode')}${cooldownText}`
  }

  const formatMobileChannelMeta = (row: RelayTokenDto) => {
    if (isAutomaticPoolToken(row)) return i18ns.t('relay.routingModeAutomaticPool')

    const failoverText = formatCompactFailoverSummary(row)
    return row.failoverConfig?.enabled
      ? `${i18ns.t('relay.failoverEnabled')} · ${failoverText}`
      : `${i18ns.t('relay.failoverDisabled')} · ${failoverText}`
  }

  const loadSwitchLogs = async (tokenId: string = currentSwitchLogTokenId.value) => {
    if (!tokenId) return
    loadingSwitchLogs.value = true
    try {
      const result = await relayTokenService.getTokenSwitchLogs(
        tokenId,
        50,
        currentTargetUserIdForRequest.value,
      )
      switchLogs.value = result.logs || []
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    } finally {
      loadingSwitchLogs.value = false
    }
  }

  const openSwitchLogsDialog = async (row: RelayTokenDto) => {
    currentSwitchLogTokenId.value = row.id
    currentSwitchLogTokenName.value = row.name || row.token.slice(0, 12)
    switchLogs.value = []
    showSwitchLogDialog.value = true
    await loadSwitchLogs(row.id)
  }

  const formatDateTime = (date: Date | string) => {
    const d = new Date(date)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatQuotaWindowUnit = (value?: string) => {
    const unit = normalizeQuotaUnit(value)
    if (unit === 'request') return i18ns.t('relay.quotaWindowUnitRequest')
    if (unit === 'token') return i18ns.t('relay.quotaWindowUnitToken')
    return i18ns.t('relay.quotaWindowUnitAmount')
  }

  const formatQuotaWindowDurationPart = (value: number, unitLabel: string) => {
    if (value === 1) return unitLabel
    return `${value}${unitLabel}`
  }

  const formatQuotaWindowHours = (value?: number) => {
    const normalized = normalizeQuotaWindowHours(value)
    if (normalized == null) return i18ns.t('relay.unlimited')

    const { months, days, hours, minutes } = splitQuotaWindowParts(normalized)
    const parts = [
      months > 0 ? formatQuotaWindowDurationPart(months, i18ns.t('monthlyPass.monthsUnit')) : '',
      days > 0 ? formatQuotaWindowDurationPart(days, i18ns.t('monthlyPass.daysUnit')) : '',
      hours > 0 ? formatQuotaWindowDurationPart(hours, i18ns.t('monthlyPass.hoursUnit')) : '',
      minutes > 0 || normalized === 0
        ? formatQuotaWindowDurationPart(minutes, i18ns.t('monthlyPass.minutesUnit'))
        : '',
    ].filter(Boolean)

    return parts.join(' ')
  }

  const getQuotaWindowPreviewMode = (
    quotaWindow: RelayTokenQuotaWindowLike,
    index: number,
  ): QuotaWindowPreviewMode => {
    const key = getQuotaWindowPreviewKey(quotaWindow, index)
    const modeIndex = quotaWindowPreviewModes.value[key] ?? 0
    return QUOTA_WINDOW_PREVIEW_CYCLE[modeIndex] ?? 'hour'
  }

  const toggleQuotaWindowPreviewMode = (quotaWindow: RelayTokenQuotaWindowLike, index: number) => {
    const key = getQuotaWindowPreviewKey(quotaWindow, index)
    const current = quotaWindowPreviewModes.value[key] ?? 0
    quotaWindowPreviewModes.value[key] = (current + 1) % QUOTA_WINDOW_PREVIEW_CYCLE.length
  }

  const formatQuotaWindowPeriodLabel = (hours: number, mode: QuotaWindowPreviewMode) => {
    switch (mode) {
      case 'hour':
        return i18ns.t('monthlyPass.hoursUnit')
      case 'actual':
        return formatQuotaWindowHours(hours)
      case 'day':
        return i18ns.t('monthlyPass.daysUnit')
      case 'week':
        return `7${i18ns.t('monthlyPass.daysUnit')}`
      case 'month':
        return i18ns.t('monthlyPass.monthsUnit')
      default:
        return formatQuotaWindowHours(hours)
    }
  }

  const formatQuotaWindowPreviewValue = (
    value: number,
    unit: string | undefined,
    divisor: number,
  ): string => {
    const normalizedValue = divisor > 0 ? value / divisor : 0
    if (isIntegerQuotaUnit(unit)) {
      return `${Math.round(normalizedValue)} ${formatQuotaWindowUnit(unit)}`
    }

    return `${round4(normalizedValue).toFixed(4)} ${i18ns.t('balance.yuan')}`
  }

  const formatQuotaWindowPreview = (quotaWindow: RelayTokenQuotaWindowLike, index: number) => {
    const normalizedHours = normalizeQuotaWindowHours(quotaWindow.quotaWindowHours)
    const normalizedLimit = Number(quotaWindow.quotaLimit)

    if (normalizedHours == null || !Number.isFinite(normalizedLimit)) {
      return formatQuotaWindowHours(quotaWindow.quotaWindowHours)
    }

    const mode = getQuotaWindowPreviewMode(quotaWindow, index)
    const periodHours =
      mode === 'hour'
        ? 1
        : mode === 'actual'
          ? normalizedHours
          : mode === 'day'
            ? 24
            : mode === 'week'
              ? 24 * 7
              : 24 * 30

    const divisor = normalizedHours > 0 ? normalizedHours / periodHours : 1

    return `${formatQuotaWindowPreviewValue(normalizedLimit, quotaWindow.quotaUnit, divisor)} / ${formatQuotaWindowPeriodLabel(normalizedHours, mode)}`
  }

  const formatQuotaWindowLimit = (value?: number | null, unit?: string) => {
    if (value == null) return '-'
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '-'
    if (isIntegerQuotaUnit(unit)) return `${Math.floor(numeric)} ${formatQuotaWindowUnit(unit)}`
    return `${numeric.toFixed(4)} ${i18ns.t('balance.yuan')}`
  }

  const formatQuotaWindowValue = (value?: number | null, unit?: string) => {
    if (value == null) return '-'
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return '-'

    if (isIntegerQuotaUnit(unit)) {
      return `${Math.floor(Math.max(0, numeric)).toLocaleString('zh-CN')} ${formatQuotaWindowUnit(unit)}`
    }

    return `${Math.max(0, numeric).toLocaleString('zh-CN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    })} ${i18ns.t('balance.yuan')}`
  }

  const formatQuotaWindowRule = (quotaWindow: RelayTokenQuotaWindowLike) => {
    return `${formatQuotaWindowLimit(quotaWindow.quotaLimit, quotaWindow.quotaUnit)} / ${formatQuotaWindowHours(quotaWindow.quotaWindowHours)}`
  }

  const formatQuotaWindowCompactSummary = (quotaWindow: RelayTokenQuotaWindowLike) => {
    return `${formatQuotaWindowValue(quotaWindow.usedQuota, quotaWindow.quotaUnit)} / ${formatQuotaWindowValue(quotaWindow.quotaLimit, quotaWindow.quotaUnit)} / ${formatQuotaWindowHours(quotaWindow.quotaWindowHours)}`
  }

  const formatQuotaAmount = (value?: number | null) =>
    `${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${i18ns.t('balance.yuan')}`

  const formatRemainingQuota = (summary?: TokenQuotaSnapshot) =>
    summary?.remainingQuota != null
      ? formatQuotaAmount(summary.remainingQuota)
      : i18ns.t('relay.unlimited')

  const formatQuotaPercent = (value?: number | null) => `${Number(value || 0).toFixed(1)}%`

  const getQuotaProgressPercentage = (value?: number | null) =>
    Math.min(Math.max(Number(value || 0), 0), 100)

  const getQuotaProgressStatus = (value?: number | null): 'success' | 'warning' | 'exception' => {
    const normalizedValue = Number(value || 0)
    if (normalizedValue >= 90) return 'exception'
    if (normalizedValue >= 70) return 'warning'
    return 'success'
  }

  const handleDelete = async (row: RelayTokenDto) => {
    try {
      await ElMessageBox.confirm(i18ns.t('relay.confirmDelete'), i18ns.t('warning'), {
        type: 'warning',
      })
      await relayTokenService.deleteRelayToken(row.id, currentTargetUserIdForRequest.value)
      invalidateAllTokensCache()
      ElMessage.success(i18ns.t('relay.deleteSuccess'))
      void loadTokens()
    } catch (error: any) {
      if (error !== 'cancel') {
        ElMessage.error(error.message || i18ns.t('relay.deleteFailed'))
      }
    }
  }

  onMounted(() => {
    selectedTargetUserId.value = userInfoStore.userInfo.id || ''
    void loadTokens()
    void loadChannels()
    void loadUserOptions()
  })

  watch(
    () => userInfoStore.userInfo.id,
    (userId) => {
      if (!userId) return
      if (!selectedTargetUserId.value) {
        selectedTargetUserId.value = userId
      }
      ensureUserOption(userId, userInfoStore.userInfo.username, userInfoStore.userInfo.name)
    },
    { immediate: true },
  )

  return {
    isDesktop,
    tokenTableRef,
    userOptions,
    userOptionsLoading,
    selectedTargetUserId,
    loadingTokens,
    showEditDialog,
    saving,
    editMode,
    editDialogSectionNames,
    showSwitchLogDialog,
    loadingSwitchLogs,
    currentSwitchLogTokenName,
    switchLogs,
    showBalanceScriptDialog,
    currentBalanceScriptToken,
    showV1BalanceScriptDialog,
    currentV1BalanceScriptToken,
    showQuotaWindowDetailDialog,
    currentQuotaWindowDetailToken,
    retryStatusCodeOptions,
    currentPage,
    pageSize,
    pageSizeOptions,
    searchKeyword,
    searchTokenKeyword,
    showAllMode,
    selectedTokenIds,
    showTokenImportDialog,
    tokenImportText,
    canManageAllTokens,
    paginationTotal,
    showPagination,
    tokens,
    selectedTokenIdSet,
    desktopChannelListRef,
    mobileChannelListRef,
    editForm,
    automaticProxyPoolChannelOptions,
    selectedChannelConfigKeys,
    tokenChannelBatchAddIds,
    showTokenChannelImportDialog,
    tokenChannelImportText,
    selectedChannelConfigs,
    hasSelectedChannelConfigs,
    isAllChannelConfigsSelected,
    tokenChannelBatchAddOptions,
    showUnavailableChannelWarning,
    unavailableChannelWarningText,
    filteredModelIds,
    channelFilteredModelNames,
    showMaxRetriesRiskWarning,
    maxRetriesRiskWarningText,
    currentQuotaWindowDetailWindows,
    quotaWindowDetailDialogTitle,
    currentTargetUserIdForRequest,
    handleTargetUserSearch,
    handleTargetUserChange,
    refreshTokens,
    handleTokenSelectionChange,
    handleMobileTokenSelectionChange,
    handleSelectAllVisibleTokens,
    clearTokenSelection,
    handleBatchTokenCommand,
    handleSearch,
    toggleShowAll,
    handleCurrentPageChange,
    handlePageSizeChange,
    openTokenImportDialog,
    openCreateDialog,
    openEditDialog,
    handleRefreshToken,
    handleToggleStatus,
    handleDelete,
    handleMoreCommand,
    copyToken,
    maskToken,
    getTokenSupportedFormats,
    getCcswitchLaunchLabel,
    getSortedChannelConfigs,
    isAutomaticPoolToken,
    getAutomaticProxyPoolChannelName,
    getVisibleChannelConfigs,
    getHiddenChannelConfigCount,
    getChannelName,
    formatSuccessRate,
    formatRetryStatusCodes,
    formatCompactFailoverSummary,
    getTokenQuotaSnapshot,
    formatQuotaAmount,
    formatQuotaPercent,
    getQuotaProgressPercentage,
    getQuotaProgressStatus,
    getRelayTokenQuotaWindows,
    getPrimaryRelayTokenQuotaWindows,
    getRemainingRelayTokenQuotaWindowCount,
    formatQuotaWindowCompactSummary,
    formatQuotaWindowRule,
    openQuotaWindowDetailDialog,
    formatDateTime,
    formatNumber,
    formatChannelSummary,
    formatMobileChannelMeta,
    formatTokenStatsSummary,
    formatRemainingQuota,
    openSwitchLogsDialog,
    loadSwitchLogs,
    switchToV1BalanceScriptDialog,
    handleImportTokens,
    handleCopyTokenChannelConfigs,
    handleExportTokenChannelConfigs,
    openTokenChannelImportDialog,
    handleImportTokenChannelConfigs,
    toggleAllChannelConfigSelections,
    handleBatchAddTokenChannels,
    handleBatchRemoveTokenChannelConfigs,
    getAvailableChannelOptions,
    channelsLoading,
    channelsLoadError,
    getChannelOptionLabel,
    addChannelConfig,
    removeChannelConfig,
    formatRetryStatusCodeOptionLabel,
    normalizeQuotaLimitInput,
    handleQuotaWindowsToggleChange,
    addQuotaWindow,
    removeQuotaWindow,
    getQuotaMin,
    getQuotaMax,
    getQuotaPrecision,
    getQuotaStep,
    MAX_QUOTA_WINDOWS,
    MAX_QUOTA_WINDOW_MONTHS,
    MAX_QUOTA_WINDOW_DAYS,
    MAX_QUOTA_WINDOW_HOUR_PART,
    MAX_QUOTA_WINDOW_MINUTE_PART,
    applyQuotaWindowParts,
    toggleQuotaWindowPreviewMode,
    formatQuotaWindowPreview,
    handleQuotaWindowUnitChange,
    handleSave,
    getModelIdDisplayLabel,
  }
}

export type RelayTokenManagementState = ReturnType<typeof useRelayTokenManagement>
