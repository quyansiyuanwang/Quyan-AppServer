import { usePageDevice } from '@/composables/usePageDevice'
import { Permission } from '@/constant/permission'
import { i18ns } from '@/locales'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { computed, onMounted, ref, watch } from 'vue'
import { configService } from '@/service/configService'
import { groupService } from '@/service/groupService'
import { ramService } from '@/service/ramService'
import { relayChannelService } from '@/service/relayChannelService'
import { relayConfigService } from '@/service/relayConfigService'
import { usePermissionStore } from '@/stores/permissionStore'
import { userService } from '@/service/userService'
import { copyTextWithFallback } from '@/utils/clipboard'
import {
  normalizeRelayFormats,
  serializeRelayFormats,
  toConfiguredRelayFormats,
} from '@/utils/relay-formats'
import type {
  ModelPricingItemDto,
  RelayChannelDto,
  RelayChannelHealthDto,
  RelayAutomaticPoolHealthDto,
  RelayChannelManagementListItemDto,
  RelayChannelImportItemDto,
  RelayChannelMemberDto,
  RelayChannelRoutingConfigDto,
  RelayChannelRoutingStrategy,
  RelayAutomaticPoolRankingMode,
  RelayChannelHealthTrackingMode,
  RelayChannelType,
  RelayChannelVisibilityConfigDto,
  RelayChannelVisibilityMode,
  ContextLengthMultiplierRule,
  TimePeriodMultiplierRule,
  UpdateRelayConfigRequest,
} from '@/client/types.gen'

export type ModelRateRow = {
  model: string
  modelId: string
  pricingType?: 'token-based' | 'per-request'
  inputPrice: number
  outputPrice: number
  fixedPrice?: number
  cacheCreationMultiplier: number
  cacheReadMultiplier: number
  supportedFormats: string[] | string
}

type ModelIdentitySource = {
  model?: string | null
  modelId?: string | null
  provider?: string | null
}

type RelayConfigModelRateItem = ModelPricingItemDto & { provider?: string | null }

type RelayChannelAllowedModelsMode = 'all' | 'manual' | 'auto'

type RelayChannelRoutingConfigFormDto = Omit<
  RelayChannelRoutingConfigDto,
  'healthScoreThreshold' | 'latencyThresholdMs' | 'circuitBreakerThreshold'
> & {
  healthScoreThreshold?: number | null
  latencyThresholdMs?: number | null
  circuitBreakerThreshold?: number | null
  allowedModelsMode?: RelayChannelAllowedModelsMode | null
}

type RelayConfigUpdatePayload = Omit<
  UpdateRelayConfigRequest,
  'modelRates' | 'monitorNameMapping'
> & {
  modelRates: ModelPricingItemDto[]
  monitorNameMapping?: Record<string, string> | null
}

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const MAX_LOGGED_ALLOWED_MODEL_PARSE_ERRORS = 200

const resolveModelId = (source: ModelIdentitySource): string => {
  const explicitModelId = source.modelId?.trim()
  if (explicitModelId) return explicitModelId

  const providerModelId = source.provider?.trim()
  if (providerModelId) return providerModelId

  return source.model?.trim() || ''
}

const normalizeSupportedFormats = (formats?: string): string[] => toConfiguredRelayFormats(formats)

const serializeSupportedFormats = (formats: string[] | string): string =>
  serializeRelayFormats(formats)

const CHANNEL_VISIBILITY_USER_PAGE_SIZE = 100

type ChannelUserOption = {
  id: string
  username: string
  name: string | null
}

type ChannelGroupOption = {
  id: string
  username: string
  name: string
}

type ChannelRoleOption = {
  id: string
  name: string
  description: string | null
}

const toSupportedFormatsArray = (formats: string[] | string | undefined): string[] => {
  return toConfiguredRelayFormats(formats)
}

const recommendedRoutingConfigForm = () => ({
  maxRetries: 2,
  failoverThreshold: 0,
  retryStatusCodes: ['4xx', '5xx'] as string[],
  failbackCooldownMinutes: 5,
  healthScoreThreshold: null as number | null,
  latencyThresholdMs: null as number | null,
  circuitBreakerThreshold: null as number | null,
  stickyByModel: false,
  stickyByFormat: false,
  rankingMode: 'price-first' as RelayAutomaticPoolRankingMode,
  dynamicMemberRankingEnabled: true,
  healthTrackingMode: 'automatic' as RelayChannelHealthTrackingMode,
  manualAvailability: 1,
  manualLatencyMs: 0,
})

const defaultRoutingConfigForm = () => recommendedRoutingConfigForm()

const defaultVisibilityConfigForm = () => ({
  userIds: [] as string[],
  groupIds: [] as string[],
  roleIds: [] as string[],
})

const defaultPoolMemberForm = (priority = 1): RelayChannelMemberDto => ({
  memberChannelId: '',
  priority,
  weight: 1,
  enabled: true,
})

const normalizeStringArray = (value?: Array<string | number | null | undefined>): string[] => {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(value.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)),
  )
}

const normalizeAllowedModelsMode = (
  value?: string | null,
  fallback: RelayChannelAllowedModelsMode = 'all',
): RelayChannelAllowedModelsMode => {
  if (value === 'all' || value === 'manual' || value === 'auto') {
    return value
  }

  return fallback
}

const normalizeOptionalThreshold = (value?: number | null): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

const normalizeRoutingConfigForm = (config?: RelayChannelRoutingConfigFormDto | null) => ({
  maxRetries:
    typeof config?.maxRetries === 'number' && Number.isFinite(config.maxRetries)
      ? config.maxRetries
      : defaultRoutingConfigForm().maxRetries,
  failoverThreshold:
    typeof config?.failoverThreshold === 'number' && Number.isFinite(config.failoverThreshold)
      ? config.failoverThreshold
      : defaultRoutingConfigForm().failoverThreshold,
  retryStatusCodes:
    normalizeStringArray(config?.retryStatusCodes).length > 0
      ? normalizeStringArray(config?.retryStatusCodes)
      : defaultRoutingConfigForm().retryStatusCodes,
  failbackCooldownMinutes:
    typeof config?.failbackCooldownMinutes === 'number' &&
    Number.isFinite(config.failbackCooldownMinutes)
      ? config.failbackCooldownMinutes
      : defaultRoutingConfigForm().failbackCooldownMinutes,
  healthScoreThreshold: normalizeOptionalThreshold(config?.healthScoreThreshold),
  latencyThresholdMs: normalizeOptionalThreshold(config?.latencyThresholdMs),
  circuitBreakerThreshold: normalizeOptionalThreshold(config?.circuitBreakerThreshold),
  stickyByModel:
    typeof config?.stickyByModel === 'boolean'
      ? config.stickyByModel
      : defaultRoutingConfigForm().stickyByModel,
  stickyByFormat:
    typeof config?.stickyByFormat === 'boolean'
      ? config.stickyByFormat
      : defaultRoutingConfigForm().stickyByFormat,
  rankingMode:
    config?.rankingMode === 'stability-first'
      ? 'stability-first'
      : defaultRoutingConfigForm().rankingMode,
  dynamicMemberRankingEnabled:
    typeof config?.dynamicMemberRankingEnabled === 'boolean'
      ? config.dynamicMemberRankingEnabled
      : defaultRoutingConfigForm().dynamicMemberRankingEnabled,
  healthTrackingMode:
    config?.healthTrackingMode === 'manual' || config?.healthTrackingMode === 'disabled'
      ? config.healthTrackingMode
      : defaultRoutingConfigForm().healthTrackingMode,
  manualAvailability:
    typeof config?.manualAvailability === 'number' && Number.isFinite(config.manualAvailability)
      ? config.manualAvailability
      : defaultRoutingConfigForm().manualAvailability,
  manualLatencyMs:
    typeof config?.manualLatencyMs === 'number' && Number.isFinite(config.manualLatencyMs)
      ? config.manualLatencyMs
      : defaultRoutingConfigForm().manualLatencyMs,
})

const normalizeVisibilityConfigForm = (config?: RelayChannelVisibilityConfigDto | null) => ({
  userIds: normalizeStringArray(config?.userIds),
  groupIds: normalizeStringArray(config?.groupIds),
  roleIds: normalizeStringArray(config?.roleIds),
})

const normalizePoolMembersForm = (members?: RelayChannelMemberDto[] | null) => {
  if (!Array.isArray(members)) return [] as RelayChannelMemberDto[]

  return [...members]
    .sort((left, right) => left.priority - right.priority)
    .map((member, index) => ({
      id: member.id,
      memberChannelId: member.memberChannelId || '',
      priority: index + 1,
      weight:
        typeof member.weight === 'number' && Number.isFinite(member.weight) ? member.weight : 1,
      enabled: member.enabled !== false,
      memberChannelName: member.memberChannelName,
      memberChannelType: member.memberChannelType,
      memberChannelEnabled: member.memberChannelEnabled,
    }))
}

const toFiniteNumber = (value: number | null | undefined): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

const toNullableThresholdPayload = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

let modelRateRowCounter = 0
const modelRateRowKeyMap = new WeakMap<ModelRateRow, string>()

const getModelRateRowKey = (row: ModelRateRow): string => {
  const existing = modelRateRowKeyMap.get(row)
  if (existing) return existing

  const key = `model-rate-${++modelRateRowCounter}`
  modelRateRowKeyMap.set(row, key)
  return key
}

export const useRelaySettingsManagement = () => {
  const permissionStore = usePermissionStore()
  const canViewChannelHealth = computed(() =>
    permissionStore.hasPermission(Permission.RELAY_CHANNEL_HEALTH_READ),
  )
  const canViewPoolMetadata = computed(() =>
    permissionStore.hasPermission(Permission.RELAY_CHANNEL_POOL_METADATA_READ),
  )
  const loading = ref(false)
  const saving = ref(false)
  const showImportDialog = ref(false)
  const importText = ref('')
  const editingRowIndex = ref<number | null>(null)
  const desktopSections = ref<string[]>([])
  const mobileSections = ref<string[]>([])
  const desktopSectionLoaded = ref<Record<string, boolean>>({})
  const mobileSectionLoaded = ref<Record<string, boolean>>({})
  const heavySections = new Set(['monitor', 'pricing', 'channels'])

  const importPricingPlaceholder = computed(() =>
    [
      i18ns.t('ServerConfigView.importPricingPlaceholder'),
      '{',
      '  "models": [',
      '    { "model": "gpt-4", "inputPrice": 30, "outputPrice": 60 }',
      '  ]',
      '}',
    ].join('\n'),
  )

  const channelImportPlaceholder = computed(() =>
    [
      i18ns.t('relay.channelImportPlaceholder'),
      '{',
      '  "channels": [',
      '    { "name": "Primary Channel", "allowedFormats": "openai", "enabled": true }',
      '  ]',
      '}',
    ].join('\n'),
  )

  const modelRates = ref<ModelRateRow[]>([])
  const globalMultiplier = ref(1)
  const uptimeStatusUrl = ref('')
  const enableQueue = ref(true)
  const maxConcurrency = ref(5)
  const queueTimeoutSec = ref(30)
  const upstreamStreamTimeoutSec = ref(120)
  const apiCatalogPoolVisibility = ref<'hidden' | 'anonymous-range'>('hidden')
  const relayCustomKeyEnabled = ref(true)
  const relayCustomKeyMaxTokensPerUser = ref(3)
  const relayCustomKeyCreateLimitWindowMinutes = ref(10)
  const relayCustomKeyCreateLimitMaxCount = ref(5)
  const relayUpstreamUrl = ref('')
  const relayUpstreamApiKey = ref('')
  const relayAllowedModels = ref('')
  const monitorConfigEnabled = ref(false)
  const showOnlyConfigured = ref(false)
  const monitorConfigs = ref<
    {
      monitorId: string
      displayName: string
    }[]
  >([])

  const loadConfig = async () => {
    loading.value = true
    try {
      const [relayConfig, relaySystemConfig] = await Promise.all([
        relayConfigService.getRelayConfig(),
        configService.getRelayConfig(),
      ])
      globalMultiplier.value = relayConfig.globalMultiplier
      uptimeStatusUrl.value = relayConfig.uptimeStatusUrl || ''
      enableQueue.value = relayConfig.enableQueue ?? true
      maxConcurrency.value = relayConfig.maxConcurrency ?? 5
      queueTimeoutSec.value = Math.round((relayConfig.queueTimeout ?? 30000) / 1000)
      upstreamStreamTimeoutSec.value = Math.round(
        (relayConfig.upstreamStreamTimeout ?? 120000) / 1000,
      )
      apiCatalogPoolVisibility.value = relayConfig.apiCatalogPoolVisibility ?? 'hidden'
      relayUpstreamUrl.value = relaySystemConfig.upstreamUrl || ''
      relayUpstreamApiKey.value = relaySystemConfig.upstreamApiKey || ''
      relayAllowedModels.value = relaySystemConfig.allowedModels || ''
      relayCustomKeyEnabled.value = relaySystemConfig.customKeyEnabled
      relayCustomKeyMaxTokensPerUser.value = relaySystemConfig.customKeyMaxTokensPerUser
      relayCustomKeyCreateLimitWindowMinutes.value =
        relaySystemConfig.customKeyCreateLimitWindowMinutes
      relayCustomKeyCreateLimitMaxCount.value = relaySystemConfig.customKeyCreateLimitMaxCount

      if (relayConfig.monitorNameMapping) {
        monitorConfigEnabled.value = true
        showOnlyConfigured.value = relayConfig.showOnlyConfigured ?? false
        monitorConfigs.value = Object.entries(relayConfig.monitorNameMapping).map(([id, name]) => ({
          monitorId: id,
          displayName: name as string,
        }))
      } else {
        monitorConfigEnabled.value = false
        showOnlyConfigured.value = false
        monitorConfigs.value = []
      }

      modelRates.value = (relayConfig.modelRates || []).map((m: RelayConfigModelRateItem) => {
        const modelName = (m.model || '').trim()
        const modelId = resolveModelId(m)
        return {
          model: modelName,
          modelId: modelId || modelName,
          pricingType: m.pricingType || 'token-based',
          inputPrice: m.inputPrice,
          outputPrice: m.outputPrice,
          fixedPrice: m.fixedPrice,
          cacheCreationMultiplier: m.cacheCreationMultiplier ?? 1.25,
          cacheReadMultiplier: m.cacheReadMultiplier ?? 0.1,
          supportedFormats: normalizeSupportedFormats(m.supportedFormats),
        }
      })
    } catch (error: any) {
      console.error('loadConfig error:', error)
      ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
    } finally {
      loading.value = false
    }
  }

  const save = async () => {
    saving.value = true
    try {
      const normalizedCustomKeyMaxTokensPerUser = Math.max(0, relayCustomKeyMaxTokensPerUser.value)
      const normalizedCustomKeyCreateLimitWindowMinutes = Math.max(
        1,
        relayCustomKeyCreateLimitWindowMinutes.value,
      )
      const normalizedCustomKeyCreateLimitMaxCount = Math.max(
        0,
        relayCustomKeyCreateLimitMaxCount.value,
      )

      const validRates = modelRates.value.filter((r) => {
        const model = r.model.trim()
        const pricingType = r.pricingType || 'token-based'

        if (!model) return false

        if (pricingType === 'per-request') {
          return r.fixedPrice != null && r.fixedPrice > 0
        }

        return r.inputPrice > 0 && r.outputPrice > 0
      })

      const modelNames = validRates.map((r) => r.model.trim())
      const uniqueModels = new Set(modelNames)
      if (uniqueModels.size !== modelNames.length) {
        ElMessage.error(i18ns.t('ServerConfigView.duplicateModelName'))
        return
      }

      const normalizedModelIds = validRates.map((rate) =>
        resolveModelId({ model: rate.model, modelId: rate.modelId }),
      )
      const invalidModelId = normalizedModelIds.find((modelId) => !MODEL_ID_PATTERN.test(modelId))
      if (invalidModelId) {
        ElMessage.error(`Invalid model ID format: ${invalidModelId}`)
        return
      }

      let monitorNameMapping: Record<string, string> | null = null
      if (monitorConfigEnabled.value) {
        const validConfigs = monitorConfigs.value.filter(
          (c) => c.monitorId.trim() && c.displayName.trim(),
        )
        if (validConfigs.length > 0) {
          monitorNameMapping = {}
          validConfigs.forEach((c) => {
            monitorNameMapping![c.monitorId.trim()] = c.displayName.trim()
          })
        }
      }

      const payload: RelayConfigUpdatePayload = {
        globalMultiplier: globalMultiplier.value,
        uptimeStatusUrl: uptimeStatusUrl.value || undefined,
        monitorNameMapping,
        showOnlyConfigured: monitorNameMapping ? showOnlyConfigured.value : false,
        uptimeTransformRules: undefined,
        uptimeStaticData: undefined,
        enableQueue: enableQueue.value,
        maxConcurrency: maxConcurrency.value,
        queueTimeout: queueTimeoutSec.value * 1000,
        upstreamStreamTimeout: upstreamStreamTimeoutSec.value * 1000,
        apiCatalogPoolVisibility: apiCatalogPoolVisibility.value,
        modelRates: validRates.map((r) => ({
          model: r.model.trim(),
          modelId: resolveModelId({ model: r.model, modelId: r.modelId }),
          pricingType: r.pricingType || 'token-based',
          inputPrice: r.inputPrice,
          outputPrice: r.outputPrice,
          fixedPrice: r.fixedPrice,
          cacheCreationMultiplier: r.cacheCreationMultiplier,
          cacheReadMultiplier: r.cacheReadMultiplier,
          supportedFormats: serializeSupportedFormats(r.supportedFormats),
        })),
      }

      await Promise.all([
        relayConfigService.updateRelayConfig(payload),
        configService.setRelayConfig({
          upstreamUrl: relayUpstreamUrl.value,
          upstreamApiKey: relayUpstreamApiKey.value,
          allowedModels: relayAllowedModels.value,
          customKeyEnabled: relayCustomKeyEnabled.value,
          customKeyMaxTokensPerUser: normalizedCustomKeyMaxTokensPerUser,
          customKeyCreateLimitWindowMinutes: normalizedCustomKeyCreateLimitWindowMinutes,
          customKeyCreateLimitMaxCount: normalizedCustomKeyCreateLimitMaxCount,
        }),
      ])

      ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
      await loadAvailableModels()
    } catch (error: any) {
      console.error('save error:', error)
      ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
    } finally {
      saving.value = false
    }
  }

  const exportModelPricing = () => {
    const data = {
      models: modelRates.value
        .filter((r) => r.model.trim())
        .map((r) => ({
          model: r.model.trim(),
          modelId: resolveModelId({ model: r.model, modelId: r.modelId }),
          pricingType: r.pricingType || 'token-based',
          inputPrice: r.inputPrice,
          outputPrice: r.outputPrice,
          fixedPrice: r.fixedPrice,
          cacheCreationMultiplier: r.cacheCreationMultiplier,
          cacheReadMultiplier: r.cacheReadMultiplier,
          supportedFormats: serializeSupportedFormats(r.supportedFormats),
        })),
    }
    const jsonStr = JSON.stringify(data, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `model-pricing-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    ElMessage.success(i18ns.t('ServerConfigView.exportSuccess'))
  }

  const copyModelPricing = async () => {
    const data = {
      models: modelRates.value
        .filter((r) => r.model.trim())
        .map((r) => ({
          model: r.model.trim(),
          modelId: resolveModelId({ model: r.model, modelId: r.modelId }),
          pricingType: r.pricingType || 'token-based',
          inputPrice: r.inputPrice,
          outputPrice: r.outputPrice,
          fixedPrice: r.fixedPrice,
          cacheCreationMultiplier: r.cacheCreationMultiplier,
          cacheReadMultiplier: r.cacheReadMultiplier,
          supportedFormats: serializeSupportedFormats(r.supportedFormats),
        })),
    }

    const copied = await copyTextWithFallback(JSON.stringify(data, null, 2))
    if (copied) {
      ElMessage.success(i18ns.t('copySuccess'))
      return
    }

    ElMessage.error(i18ns.t('message.error.copyFailed'))
  }

  const addMonitorConfig = () => {
    monitorConfigs.value.push({
      monitorId: '',
      displayName: '',
    })
  }

  const addModelRate = () => {
    modelRates.value.push({
      model: '',
      modelId: '',
      pricingType: 'token-based',
      inputPrice: 10,
      outputPrice: 30,
      fixedPrice: 0,
      cacheCreationMultiplier: 1.25,
      cacheReadMultiplier: 0.1,
      supportedFormats: [],
    })
    editingRowIndex.value = modelRates.value.length - 1
  }

  const onCollapseEnter = (el: Element) => {
    const element = el as HTMLElement
    element.style.height = '0'
    element.style.overflow = 'hidden'
    requestAnimationFrame(() => {
      element.style.height = element.scrollHeight + 'px'
    })
  }

  const onCollapseAfterEnter = (el: Element) => {
    const element = el as HTMLElement
    element.style.height = ''
    element.style.overflow = ''
  }

  const onCollapseLeave = (el: Element) => {
    const element = el as HTMLElement
    element.style.height = element.scrollHeight + 'px'
    element.style.overflow = 'hidden'
    requestAnimationFrame(() => {
      element.style.height = '0'
    })
  }

  const onCollapseAfterLeave = (el: Element) => {
    const element = el as HTMLElement
    element.style.height = ''
    element.style.overflow = ''
  }

  const isMobileSectionExpanded = (name: string) => mobileSections.value.includes(name)
  const isMobileSectionLoaded = (name: string) => !!mobileSectionLoaded.value[name]

  const ensureMobileSectionLoaded = (name: string) => {
    if (mobileSectionLoaded.value[name]) return
    if (heavySections.has(name)) {
      setTimeout(() => {
        mobileSectionLoaded.value[name] = true
      }, 16)
      return
    }
    mobileSectionLoaded.value[name] = true
  }

  const toggleMobileSection = (name: string) => {
    const next = new Set(mobileSections.value)
    if (next.has(name)) {
      next.delete(name)
    } else {
      ensureMobileSectionLoaded(name)
      next.add(name)
    }
    mobileSections.value = Array.from(next)
  }

  const handleImport = () => {
    try {
      const data = JSON.parse(importText.value)
      const models = data.models || data
      if (!Array.isArray(models)) {
        ElMessage.error(i18ns.t('ServerConfigView.importFormatError'))
        return
      }

      for (const item of models) {
        if (
          !item.model ||
          typeof item.inputPrice !== 'number' ||
          typeof item.outputPrice !== 'number'
        ) {
          ElMessage.error(i18ns.t('ServerConfigView.importFormatError'))
          return
        }
        if (
          item.pricingType &&
          item.pricingType !== 'token-based' &&
          item.pricingType !== 'per-request'
        ) {
          ElMessage.error(`Invalid pricingType for model ${item.model}`)
          return
        }
        if (item.pricingType === 'per-request' && typeof item.fixedPrice !== 'number') {
          ElMessage.error(`fixedPrice is required for per-request model ${item.model}`)
          return
        }
      }

      const existingMap = new Map(modelRates.value.map((r) => [r.model.trim(), r]))
      for (const item of models) {
        const key = item.model.trim()
        if (existingMap.has(key)) {
          const existing = existingMap.get(key)!
          existing.pricingType = item.pricingType ?? existing.pricingType ?? 'token-based'
          existing.modelId =
            resolveModelId({
              model: item.model,
              modelId: item.modelId,
              provider: item.provider,
            }) || resolveModelId({ model: key, modelId: existing.modelId })
          existing.inputPrice = item.inputPrice
          existing.outputPrice = item.outputPrice
          existing.fixedPrice = item.fixedPrice ?? existing.fixedPrice
          existing.cacheCreationMultiplier =
            item.cacheCreationMultiplier ?? existing.cacheCreationMultiplier
          existing.cacheReadMultiplier = item.cacheReadMultiplier ?? existing.cacheReadMultiplier
          const formats = item.supportedFormats || existing.supportedFormats
          existing.supportedFormats = toSupportedFormatsArray(formats)
        } else {
          const formats = item.supportedFormats || 'all'
          modelRates.value.push({
            model: key,
            modelId:
              resolveModelId({
                model: item.model,
                modelId: item.modelId,
                provider: item.provider,
              }) || key,
            pricingType: item.pricingType ?? 'token-based',
            inputPrice: item.inputPrice,
            outputPrice: item.outputPrice,
            fixedPrice: item.fixedPrice,
            cacheCreationMultiplier: item.cacheCreationMultiplier ?? 1.25,
            cacheReadMultiplier: item.cacheReadMultiplier ?? 0.1,
            supportedFormats: toSupportedFormatsArray(formats),
          })
        }
      }

      showImportDialog.value = false
      importText.value = ''
      ElMessage.success(i18ns.t('ServerConfigView.importSuccess'))
    } catch {
      ElMessage.error(i18ns.t('ServerConfigView.importFormatError'))
    }
  }

  const channelRows = ref<RelayChannelManagementListItemDto[]>([])
  const channelFilters = ref<{
    keyword: string
    channelType?: RelayChannelType
    enabled?: boolean
  }>({ keyword: '', enabled: true })
  const channelPagination = ref({ page: 1, pageSize: 25, total: 0 })
  const channelLoading = ref(false)
  const channelSaving = ref(false)
  const channelExporting = ref(false)
  const togglingChannelId = ref('')
  const showChannelDialog = ref(false)
  const showChannelImportDialog = ref(false)
  const channelImportText = ref('')
  const isEditingChannel = ref(false)
  const editingChannelId = ref('')
  const selectedChannelIds = ref<string[]>([])
  const channelRequestVersion = ref(0)
  const poolMemberTooltipDetails = ref<Record<string, RelayChannelDto | null>>({})
  const poolMemberTooltipLoadingIds = ref<string[]>([])
  const showPoolMemberPicker = ref(false)
  const poolMemberPickerRows = ref<RelayChannelManagementListItemDto[]>([])
  const poolMemberPickerPagination = ref({ page: 1, pageSize: 25, total: 0 })
  const poolMemberPickerKeyword = ref('')
  const selectedPoolMemberCandidateIds = ref<string[]>([])
  const poolMemberCandidateCache = ref<Record<string, RelayChannelManagementListItemDto>>({})
  const poolMemberInsertPosition = ref<'top' | 'bottom'>('bottom')
  const visibilityUserOptions = ref<ChannelUserOption[]>([])
  const visibilityGroupOptions = ref<ChannelGroupOption[]>([])
  const visibilityRoleOptions = ref<ChannelRoleOption[]>([])
  const visibilityUserOptionsLoading = ref(false)
  const visibilityGroupOptionsLoading = ref(false)
  const visibilityRoleOptionsLoading = ref(false)
  const hasLoadedVisibilityUsers = ref(false)
  const hasLoadedVisibilityGroups = ref(false)
  const hasLoadedVisibilityRoles = ref(false)
  const showChannelDetailDialog = ref(false)
  const currentChannelDetail = ref<RelayChannelDto | null>(null)
  const channelHealth = ref<RelayChannelHealthDto | RelayAutomaticPoolHealthDto | null>(null)
  const channelHealthLoading = ref(false)

  const hasChannelSelection = computed(() => selectedChannelIds.value.length > 0)
  const selectedChannelCount = computed(() => selectedChannelIds.value.length)
  const isCurrentPageFullySelected = computed(
    () =>
      channelRows.value.length > 0 &&
      channelRows.value.every((channel) => selectedChannelIds.value.includes(channel.id)),
  )

  const defaultChannelForm = () => ({
    name: '',
    channelType: 'standalone' as RelayChannelType,
    routingStrategy: 'priority' as RelayChannelRoutingStrategy,
    routingConfig: defaultRoutingConfigForm(),
    pooledAllowedModelsMode: 'all' as RelayChannelAllowedModelsMode,
    visibilityMode: 'public' as RelayChannelVisibilityMode,
    visibilityConfig: defaultVisibilityConfigForm(),
    poolMembers: [] as RelayChannelMemberDto[],
    openaiUpstreamUrl: '',
    openaiUpstreamApiKey: '',
    hasOpenaiUpstreamApiKey: false,
    openaiUpstreamApiKeyTouched: false,
    anthropicUpstreamUrl: '',
    anthropicUpstreamApiKey: '',
    hasAnthropicUpstreamApiKey: false,
    anthropicUpstreamApiKeyTouched: false,
    geminiUpstreamUrl: '',
    geminiUpstreamApiKey: '',
    hasGeminiUpstreamApiKey: false,
    geminiUpstreamApiKeyTouched: false,
    multiplier: 1.0,
    allowedFormats: [] as string[],
    allowedModelsArray: [] as string[],
    restrictModels: false,
    inputTokensIncludeCacheRead: false,
    modelMapping: {} as Record<string, string>,
    timePeriodMultipliers: [] as TimePeriodMultiplierRule[],
    contextLengthMultipliers: [] as ContextLengthMultiplierRule[],
  })

  const ensureVisibilityUserOption = (
    userId?: string,
    username?: string | null,
    name?: string | null,
  ) => {
    if (!userId) return
    if (visibilityUserOptions.value.some((item) => item.id === userId)) return

    visibilityUserOptions.value = [
      {
        id: userId,
        username: username || userId,
        name: name || null,
      },
      ...visibilityUserOptions.value,
    ]
  }

  const ensureVisibilityGroupOption = (
    groupId?: string,
    username?: string | null,
    name?: string | null,
  ) => {
    if (!groupId) return
    if (visibilityGroupOptions.value.some((item) => item.id === groupId)) return

    visibilityGroupOptions.value = [
      {
        id: groupId,
        username: username || groupId,
        name: name || username || groupId,
      },
      ...visibilityGroupOptions.value,
    ]
  }

  const ensureVisibilityRoleOption = (
    roleId?: string,
    name?: string | null,
    description?: string | null,
  ) => {
    if (!roleId) return
    if (visibilityRoleOptions.value.some((item) => item.id === roleId)) return

    visibilityRoleOptions.value = [
      {
        id: roleId,
        name: name || roleId,
        description: description || null,
      },
      ...visibilityRoleOptions.value,
    ]
  }

  const ensureSelectedVisibilityOptions = (config?: RelayChannelVisibilityConfigDto | null) => {
    const normalized = normalizeVisibilityConfigForm(config)
    normalized.userIds.forEach((id) => ensureVisibilityUserOption(id))
    normalized.groupIds.forEach((id) => ensureVisibilityGroupOption(id))
    normalized.roleIds.forEach((id) => ensureVisibilityRoleOption(id))
  }

  const loadVisibilityUserOptions = async (keyword?: string) => {
    visibilityUserOptionsLoading.value = true
    try {
      const result = await userService.getAllUsers({
        page: 1,
        pageSize: CHANNEL_VISIBILITY_USER_PAGE_SIZE,
        keyword: keyword?.trim() || undefined,
      })
      const users = Array.isArray(result?.users) ? result.users : []
      visibilityUserOptions.value = users
        .map((item: { id: string; username?: string | null; name?: string | null }) => ({
          id: item.id,
          username: item.username || item.id,
          name: item.name || null,
        }))
        .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username))

      normalizeStringArray(channelForm.value.visibilityConfig.userIds).forEach((id) =>
        ensureVisibilityUserOption(id),
      )
      hasLoadedVisibilityUsers.value = true
    } catch (_error) {
      visibilityUserOptions.value = []
    } finally {
      visibilityUserOptionsLoading.value = false
    }
  }

  const loadVisibilityGroupOptions = async () => {
    visibilityGroupOptionsLoading.value = true
    try {
      const data = await groupService.getAllGroups()
      const groups = Array.isArray(data) ? data : data.groups
      visibilityGroupOptions.value = groups
        .map((item: { id: string; username: string; name?: string | null }) => ({
          id: item.id,
          username: item.username,
          name: item.name || item.username,
        }))
        .sort((a: ChannelGroupOption, b: ChannelGroupOption) => a.name.localeCompare(b.name))

      normalizeStringArray(channelForm.value.visibilityConfig.groupIds).forEach((id) =>
        ensureVisibilityGroupOption(id),
      )
      hasLoadedVisibilityGroups.value = true
    } catch (_error) {
      visibilityGroupOptions.value = []
    } finally {
      visibilityGroupOptionsLoading.value = false
    }
  }

  const loadVisibilityRoleOptions = async () => {
    visibilityRoleOptionsLoading.value = true
    try {
      const roles = await ramService.listRoles()
      visibilityRoleOptions.value = roles
        .map((item: { id: string; name: string; description?: string | null }) => ({
          id: item.id,
          name: item.name || item.id,
          description: item.description || null,
        }))
        .sort((a: ChannelRoleOption, b: ChannelRoleOption) => a.name.localeCompare(b.name))

      normalizeStringArray(channelForm.value.visibilityConfig.roleIds).forEach((id) =>
        ensureVisibilityRoleOption(id),
      )
      hasLoadedVisibilityRoles.value = true
    } catch (_error) {
      visibilityRoleOptions.value = []
    } finally {
      visibilityRoleOptionsLoading.value = false
    }
  }

  const ensureVisibilityOptionsLoaded = async () => {
    const tasks: Array<Promise<unknown>> = []

    if (!hasLoadedVisibilityGroups.value && !visibilityGroupOptionsLoading.value) {
      tasks.push(loadVisibilityGroupOptions())
    }

    if (!hasLoadedVisibilityRoles.value && !visibilityRoleOptionsLoading.value) {
      tasks.push(loadVisibilityRoleOptions())
    }

    if (!hasLoadedVisibilityUsers.value && !visibilityUserOptionsLoading.value) {
      tasks.push(loadVisibilityUserOptions())
    }

    if (tasks.length > 0) {
      await Promise.all(tasks)
    }
  }

  const handleVisibilityUserSearch = (query: string) => {
    void loadVisibilityUserOptions(query)
  }

  const channelForm = ref(defaultChannelForm())
  const timeRuleDialogVisible = ref(false)
  const editingTimeRuleIndex = ref(-1)
  const timeRuleFormRef = ref<FormInstance>()
  const timeRuleDays = ref<number[]>([])
  const timeRuleRange = ref<string[]>([])
  const timeRuleForm = ref({
    name: '',
    multiplier: 1,
    enabled: true,
  })
  const timeRuleFormRules: FormRules = {
    name: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
    multiplier: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
    timeRange: [
      {
        validator: (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
          if (
            !timeRuleRange.value ||
            timeRuleRange.value.length !== 2 ||
            !timeRuleRange.value[0] ||
            !timeRuleRange.value[1]
          ) {
            callback(new Error(i18ns.t('required')))
          } else {
            callback()
          }
        },
        trigger: 'change',
      },
    ],
  }
  const timeRuleDayOptions = [
    { value: 1, label: i18ns.t('relay.dayMon') },
    { value: 2, label: i18ns.t('relay.dayTue') },
    { value: 3, label: i18ns.t('relay.dayWed') },
    { value: 4, label: i18ns.t('relay.dayThu') },
    { value: 5, label: i18ns.t('relay.dayFri') },
    { value: 6, label: i18ns.t('relay.daySat') },
    { value: 7, label: i18ns.t('relay.daySun') },
  ]

  function formatTimeRuleDays(dayOfWeek: string): string {
    if (!dayOfWeek || dayOfWeek.trim() === '') return i18ns.t('relay.allWeek')
    const days = dayOfWeek.split(',').map(Number)
    const names: string[] = []
    if (days.length === 5 && days.every((d) => [1, 2, 3, 4, 5].includes(d))) {
      return i18ns.t('relay.weekday')
    }
    if (days.length === 2 && days.includes(6) && days.includes(7)) return i18ns.t('relay.weekend')
    for (const day of days) {
      const option = timeRuleDayOptions.find((item) => item.value === day)
      if (option) names.push(option.label)
    }
    return names.join(', ')
  }

  function resetTimeRuleForm() {
    timeRuleForm.value = { name: '', multiplier: 1, enabled: true }
    timeRuleDays.value = []
    timeRuleRange.value = []
    editingTimeRuleIndex.value = -1
  }

  function openAddTimeRule() {
    resetTimeRuleForm()
    timeRuleDialogVisible.value = true
  }

  function openEditTimeRule(index: number) {
    const rule = channelForm.value.timePeriodMultipliers[index]
    if (!rule) return
    editingTimeRuleIndex.value = index
    timeRuleForm.value = {
      name: rule.name,
      multiplier: rule.multiplier,
      enabled: rule.enabled,
    }
    timeRuleDays.value = rule.dayOfWeek ? rule.dayOfWeek.split(',').map(Number) : []
    timeRuleRange.value = [rule.startTime, rule.endTime]
    timeRuleDialogVisible.value = true
  }

  async function saveTimeRule() {
    const valid = await timeRuleFormRef.value?.validate().catch(() => false)
    if (!valid) return
    const rule: TimePeriodMultiplierRule = {
      name: timeRuleForm.value.name,
      dayOfWeek: timeRuleDays.value.join(','),
      startTime: timeRuleRange.value[0]!,
      endTime: timeRuleRange.value[1]!,
      multiplier: timeRuleForm.value.multiplier,
      enabled: timeRuleForm.value.enabled,
    }
    if (editingTimeRuleIndex.value >= 0) {
      channelForm.value.timePeriodMultipliers[editingTimeRuleIndex.value] = rule
    } else {
      channelForm.value.timePeriodMultipliers.push(rule)
    }
    timeRuleDialogVisible.value = false
  }

  function removeTimeRule(index: number) {
    channelForm.value.timePeriodMultipliers.splice(index, 1)
  }

  const availableModels = ref<
    {
      model: string
      modelId: string
      supportedFormats?: string
    }[]
  >([])

  const loadAvailableModels = async () => {
    try {
      const relayConfig = await relayConfigService.getRelayConfig()
      availableModels.value = relayConfig.modelRates.map((m: RelayConfigModelRateItem) => {
        const modelName = (m.model || '').trim()
        const modelId = resolveModelId(m)
        return {
          model: modelName,
          modelId: modelId || modelName,
          supportedFormats: m.supportedFormats || 'all',
        }
      })
    } catch (error) {
      console.error('加载模型列表失败:', error)
    }
  }

  const filteredModels = computed(() => {
    const selectedFormats = channelForm.value.allowedFormats

    if (!Array.isArray(selectedFormats) || selectedFormats.length === 0) {
      return availableModels.value
    }

    return availableModels.value.filter((model) => {
      const formats = model.supportedFormats || 'all'
      if (formats === 'all') return true
      const modelFormats = formats.split(',').map((format: string) => format.trim())
      return selectedFormats.some((selectedFormat) => modelFormats.includes(selectedFormat))
    })
  })

  const formatModelOptionLabel = (model: { model: string; modelId: string }) => {
    const modelName = model.model.trim()
    const modelId = resolveModelId({ model: modelName, modelId: model.modelId })
    if (!modelName) return modelId
    if (!modelId || modelId === modelName) return modelName
    return `${modelName} (${modelId})`
  }

  const isModelDisabled = (model: { model: string; modelId: string }) => {
    const modelName = model.model.trim()
    const modelId = resolveModelId({ model: modelName, modelId: model.modelId })

    if (channelForm.value.allowedModelsArray.includes(modelName)) {
      return false
    }

    for (const selectedModelName of channelForm.value.allowedModelsArray) {
      const selectedModelInfo = availableModels.value.find(
        (item) => item.model === selectedModelName,
      )
      if (!selectedModelInfo) continue

      const selectedModelId = resolveModelId({
        model: selectedModelInfo.model,
        modelId: selectedModelInfo.modelId,
      })

      if (selectedModelId === modelId) {
        return true
      }
    }

    return false
  }

  const computeShowUpstream = (formats: string[] | string | undefined, upstream: string) => {
    if (!formats) return false

    let normalizedFormats: string[] = []
    if (Array.isArray(formats)) {
      normalizedFormats = toConfiguredRelayFormats(formats)
    } else if (typeof formats === 'string') {
      normalizedFormats = normalizeRelayFormats(formats)
    }

    if (normalizedFormats.length === 0) return false

    return normalizedFormats.includes(upstream)
  }

  const getChannelNameById = (channelId: string) => {
    return (
      channelForm.value.poolMembers.find((member) => member.memberChannelId === channelId)
        ?.memberChannelName ||
      poolMemberCandidateCache.value[channelId]?.name ||
      channelId
    )
  }

  const reindexPoolMembers = () => {
    channelForm.value.poolMembers = channelForm.value.poolMembers.map((member, index) => ({
      ...member,
      priority: index + 1,
    }))
  }

  const movePoolMember = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
    const members = [...channelForm.value.poolMembers]
    const [moved] = members.splice(fromIndex, 1)
    if (!moved) return
    members.splice(toIndex, 0, moved)
    channelForm.value.poolMembers = members
    reindexPoolMembers()
  }

  const movePoolMemberToEdge = (index: number, edge: 'top' | 'bottom') => {
    movePoolMember(index, edge === 'top' ? 0 : channelForm.value.poolMembers.length - 1)
  }

  const removePoolMember = (index: number) => {
    channelForm.value.poolMembers.splice(index, 1)
    reindexPoolMembers()
  }

  const isPoolMemberCandidateEligible = (channel: RelayChannelManagementListItemDto) => {
    if (channel.id === editingChannelId.value) return false
    if (channelForm.value.poolMembers.some((member) => member.memberChannelId === channel.id))
      return false
    return (
      channelForm.value.channelType !== 'automatic-proxy-pool' ||
      channel.channelType === 'standalone'
    )
  }

  const loadPoolMemberCandidates = async () => {
    const response = await relayChannelService.listManagementChannels({
      page: poolMemberPickerPagination.value.page,
      pageSize: poolMemberPickerPagination.value.pageSize,
      keyword: poolMemberPickerKeyword.value,
      channelType:
        channelForm.value.channelType === 'automatic-proxy-pool' ? 'standalone' : undefined,
    })
    poolMemberPickerRows.value = response.items.filter(isPoolMemberCandidateEligible)
    poolMemberPickerPagination.value.total = response.total
    for (const item of response.items) poolMemberCandidateCache.value[item.id] = item
  }

  const openPoolMemberPicker = async () => {
    selectedPoolMemberCandidateIds.value = []
    poolMemberPickerKeyword.value = ''
    poolMemberPickerPagination.value.page = 1
    poolMemberInsertPosition.value = 'bottom'
    showPoolMemberPicker.value = true
    await loadPoolMemberCandidates()
  }

  const addSelectedPoolMembers = () => {
    const existingIds = new Set(
      channelForm.value.poolMembers.map((member) => member.memberChannelId),
    )
    const additions = selectedPoolMemberCandidateIds.value
      .map((id) => poolMemberCandidateCache.value[id])
      .filter((item): item is RelayChannelManagementListItemDto => Boolean(item))
      .filter((item) => !existingIds.has(item.id) && isPoolMemberCandidateEligible(item))
      .map((item) => ({
        ...defaultPoolMemberForm(),
        memberChannelId: item.id,
        memberChannelName: item.name,
        memberChannelType: item.channelType,
        memberChannelEnabled: item.enabled,
      }))
    channelForm.value.poolMembers =
      poolMemberInsertPosition.value === 'top'
        ? [...additions, ...channelForm.value.poolMembers]
        : [...channelForm.value.poolMembers, ...additions]
    reindexPoolMembers()
    showPoolMemberPicker.value = false
  }

  const resetRoutingConfigToRecommended = () => {
    channelForm.value.routingConfig = recommendedRoutingConfigForm()
  }

  const clearOptionalRoutingThresholds = () => {
    channelForm.value.routingConfig = {
      ...channelForm.value.routingConfig,
      healthScoreThreshold: null,
      latencyThresholdMs: null,
      circuitBreakerThreshold: null,
    }
  }

  const formatChannelTypeLabel = (channelType: RelayChannelType | string | undefined) => {
    if (channelType === 'automatic-proxy-pool')
      return i18ns.t('relay.channelTypeAutomaticProxyPool')
    return channelType === 'pooled'
      ? i18ns.t('relay.channelTypePooled')
      : i18ns.t('relay.channelTypeStandalone')
  }

  const formatRoutingStrategyLabel = (
    strategy: RelayChannelRoutingStrategy | string | undefined,
  ) => {
    switch (strategy) {
      case 'random':
        return i18ns.t('relay.routingStrategyRandom')
      case 'weighted-random':
        return i18ns.t('relay.routingStrategyWeightedRandom')
      case 'round-robin':
        return i18ns.t('relay.routingStrategyRoundRobin')
      case 'health-priority':
        return i18ns.t('relay.routingStrategyHealthPriority')
      case 'latency-priority':
        return i18ns.t('relay.routingStrategyLatencyPriority')
      case 'priority':
      default:
        return i18ns.t('relay.routingStrategyPriority')
    }
  }

  const formatVisibilityModeLabel = (mode: RelayChannelVisibilityMode | string | undefined) => {
    switch (mode) {
      case 'private':
        return i18ns.t('relay.visibilityModePrivate')
      case 'whitelist':
        return i18ns.t('relay.visibilityModeWhitelist')
      case 'hidden':
        return i18ns.t('relay.visibilityModeHidden')
      case 'public':
      default:
        return i18ns.t('relay.visibilityModePublic')
    }
  }

  const getVisibilitySummary = (
    row: Pick<RelayChannelDto, 'visibilityMode' | 'visibilityConfig'>,
  ) => {
    if (row.visibilityMode !== 'whitelist') {
      return formatVisibilityModeLabel(row.visibilityMode)
    }

    const config = normalizeVisibilityConfigForm(row.visibilityConfig)
    const parts: string[] = []
    if (config.userIds.length > 0)
      parts.push(i18ns.t('relay.visibilityUsersSummary', { count: config.userIds.length }))
    if (config.groupIds.length > 0)
      parts.push(i18ns.t('relay.visibilityGroupsSummary', { count: config.groupIds.length }))
    if (config.roleIds.length > 0)
      parts.push(i18ns.t('relay.visibilityRolesSummary', { count: config.roleIds.length }))

    return parts.length > 0 ? parts.join(' · ') : i18ns.t('relay.visibilityEmptyWhitelist')
  }

  const getPoolMembersSummary = (members?: RelayChannelMemberDto[] | null) => {
    const normalizedMembers = normalizePoolMembersForm(members)
    if (normalizedMembers.length === 0) return ''

    return normalizedMembers
      .map((member) => {
        const parts = [getChannelNameById(member.memberChannelId)]
        parts.push(`#${member.priority}`)
        if (typeof member.weight === 'number' && Number.isFinite(member.weight)) {
          parts.push(`w=${member.weight}`)
        }
        if (member.enabled === false) {
          parts.push(i18ns.t('relay.disabled'))
        }
        return parts.join(' ')
      })
      .join(' | ')
  }

  const buildRoutingConfigPayload = (): RelayChannelRoutingConfigDto | null => {
    const config = channelForm.value.routingConfig
    const payload: RelayChannelRoutingConfigFormDto = {}

    const maxRetries = toFiniteNumber(config.maxRetries)
    if (maxRetries !== undefined) payload.maxRetries = maxRetries

    const failoverThreshold = toFiniteNumber(config.failoverThreshold)
    if (failoverThreshold !== undefined) payload.failoverThreshold = failoverThreshold

    const retryStatusCodes = normalizeStringArray(config.retryStatusCodes)
    if (retryStatusCodes.length > 0) payload.retryStatusCodes = retryStatusCodes

    const failbackCooldownMinutes = toFiniteNumber(config.failbackCooldownMinutes)
    if (failbackCooldownMinutes !== undefined) {
      payload.failbackCooldownMinutes = failbackCooldownMinutes
    }

    payload.healthScoreThreshold = toNullableThresholdPayload(config.healthScoreThreshold)

    payload.latencyThresholdMs = toNullableThresholdPayload(config.latencyThresholdMs)

    payload.circuitBreakerThreshold = toNullableThresholdPayload(config.circuitBreakerThreshold)

    if (['pooled', 'automatic-proxy-pool'].includes(channelForm.value.channelType)) {
      payload.allowedModelsMode = normalizeAllowedModelsMode(
        channelForm.value.pooledAllowedModelsMode,
      )
    }

    if (config.stickyByModel === true) payload.stickyByModel = true
    if (config.stickyByFormat === true) payload.stickyByFormat = true
    if (channelForm.value.channelType === 'automatic-proxy-pool') {
      payload.rankingMode =
        config.rankingMode === 'stability-first' ? 'stability-first' : 'price-first'
      payload.dynamicMemberRankingEnabled = config.dynamicMemberRankingEnabled !== false
    }
    if (channelForm.value.channelType === 'standalone') {
      payload.healthTrackingMode =
        config.healthTrackingMode === 'manual' || config.healthTrackingMode === 'disabled'
          ? config.healthTrackingMode
          : 'automatic'
      if (payload.healthTrackingMode === 'manual') {
        payload.manualAvailability = Math.min(
          1,
          Math.max(0, Number(config.manualAvailability) || 0),
        )
        payload.manualLatencyMs = Math.max(0, Math.floor(Number(config.manualLatencyMs) || 0))
      }
    }

    return Object.keys(payload).length > 0 ? (payload as RelayChannelRoutingConfigDto) : null
  }

  const buildStandaloneHealthTrackingPayload = (): RelayChannelRoutingConfigDto => {
    const config = channelForm.value.routingConfig
    const healthTrackingMode =
      config.healthTrackingMode === 'manual' || config.healthTrackingMode === 'disabled'
        ? config.healthTrackingMode
        : 'automatic'

    if (healthTrackingMode !== 'manual') return { healthTrackingMode }

    return {
      healthTrackingMode,
      manualAvailability: Math.min(1, Math.max(0, Number(config.manualAvailability) || 0)),
      manualLatencyMs: Math.max(0, Math.floor(Number(config.manualLatencyMs) || 0)),
    }
  }

  const buildVisibilityConfigPayload = (): RelayChannelVisibilityConfigDto | null => {
    const config = channelForm.value.visibilityConfig
    const payload: RelayChannelVisibilityConfigDto = {}

    const userIds = normalizeStringArray(config.userIds)
    if (userIds.length > 0) payload.userIds = userIds

    const groupIds = normalizeStringArray(config.groupIds)
    if (groupIds.length > 0) payload.groupIds = groupIds

    const roleIds = normalizeStringArray(config.roleIds)
    if (roleIds.length > 0) payload.roleIds = roleIds

    return Object.keys(payload).length > 0 ? payload : null
  }

  const buildPoolMembersPayload = (): RelayChannelMemberDto[] => {
    const seen = new Set<string>()

    return channelForm.value.poolMembers
      .map((member) => ({
        id: member.id,
        memberChannelId: member.memberChannelId.trim(),
        weight:
          typeof member.weight === 'number' && Number.isFinite(member.weight) ? member.weight : 1,
        enabled: member.enabled !== false,
      }))
      .filter((member) => {
        if (!member.memberChannelId) return false
        if (seen.has(member.memberChannelId)) return false
        seen.add(member.memberChannelId)
        return true
      })
      .map((member, index) => ({ ...member, priority: index + 1 }))
  }

  watch(
    () => channelForm.value.allowedFormats,
    () => {
      if (!channelForm.value.allowedModelsArray.length) return

      const validModels = new Set(filteredModels.value.map((model) => model.model))
      channelForm.value.allowedModelsArray = channelForm.value.allowedModelsArray.filter((model) =>
        validModels.has(model),
      )
    },
  )

  watch(
    () => channelForm.value.channelType,
    (channelType) => {
      if (['pooled', 'automatic-proxy-pool'].includes(channelType)) {
        channelForm.value.restrictModels = false
        return
      }

      channelForm.value.pooledAllowedModelsMode = 'all'
    },
  )

  watch(
    () => channelForm.value.visibilityMode,
    (mode) => {
      if (mode === 'whitelist') {
        void ensureVisibilityOptionsLoaded()
      }
    },
  )

  const loggedAllowedModelParseErrors = new Set<string>()
  const hasShownAllowedModelsParseWarning = ref(false)

  const parseAllowedModels = (allowedModels: string | null | undefined): string[] => {
    if (!allowedModels) return []
    try {
      const parsed = JSON.parse(allowedModels)
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      if (!loggedAllowedModelParseErrors.has(allowedModels)) {
        if (loggedAllowedModelParseErrors.size >= MAX_LOGGED_ALLOWED_MODEL_PARSE_ERRORS) {
          const oldest = loggedAllowedModelParseErrors.values().next().value
          if (oldest !== undefined) loggedAllowedModelParseErrors.delete(oldest)
        }

        console.warn('Failed to parse channel allowedModels JSON in RelaySettingsView', {
          allowedModels,
          error,
        })
        loggedAllowedModelParseErrors.add(allowedModels)
      }

      if (!hasShownAllowedModelsParseWarning.value) {
        ElMessage.warning('Some channel model whitelist settings are invalid and were ignored.')
        hasShownAllowedModelsParseWarning.value = true
      }

      return []
    }
  }

  const getChannelAllowedModelsMode = (
    row: Pick<RelayChannelDto, 'channelType' | 'configuredAllowedModels' | 'routingConfig'>,
  ): RelayChannelAllowedModelsMode => {
    if (!['pooled', 'automatic-proxy-pool'].includes(row.channelType)) {
      return row.configuredAllowedModels ? 'manual' : 'all'
    }

    const routingConfig = (row.routingConfig || null) as RelayChannelRoutingConfigFormDto | null
    return normalizeAllowedModelsMode(
      routingConfig?.allowedModelsMode,
      row.configuredAllowedModels ? 'manual' : 'all',
    )
  }

  const getChannelAllowedModelsSummary = (row: Pick<RelayChannelDto, 'allowedModels'>) => {
    if (row.allowedModels.length === 0) return i18ns.t('relay.noModels')
    return i18ns.t('relay.modelsCount', { count: row.allowedModels.length })
  }

  const isChannelSelected = (id: string) => selectedChannelIds.value.includes(id)

  const toggleChannelSelection = (id: string, checked: boolean | string | number) => {
    const enabled = Boolean(checked)
    if (enabled) {
      if (!selectedChannelIds.value.includes(id)) {
        selectedChannelIds.value = [...selectedChannelIds.value, id]
      }
      return
    }

    selectedChannelIds.value = selectedChannelIds.value.filter((item) => item !== id)
  }

  const toggleCurrentPageSelection = (checked: boolean | string | number) => {
    const pageIds = channelRows.value.map((channel) => channel.id)
    const selected = new Set(selectedChannelIds.value)
    if (Boolean(checked)) pageIds.forEach((id) => selected.add(id))
    else pageIds.forEach((id) => selected.delete(id))
    selectedChannelIds.value = [...selected]
  }

  const filteredModelNames = computed(() =>
    filteredModels.value
      .map((model) => model.model)
      .filter((name): name is string => typeof name === 'string' && name.length > 0),
  )

  const clearChannelSelection = () => {
    selectedChannelIds.value = []
  }

  const getChannelExportIds = () =>
    selectedChannelIds.value.length > 0 ? selectedChannelIds.value : undefined

  const downloadJsonFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const buildChannelExportContent = async () => {
    const exportIds = getChannelExportIds()
    const response = await relayChannelService.exportChannels(
      exportIds ? { ids: exportIds, includeDisabled: true } : { includeDisabled: true },
    )

    return JSON.stringify(
      {
        channels: response.channels,
      },
      null,
      2,
    )
  }

  const exportChannelsAsJson = async () => {
    if (channelExporting.value) return
    channelExporting.value = true
    try {
      const content = await buildChannelExportContent()
      downloadJsonFile(`relay-channels-${new Date().toISOString().slice(0, 10)}.json`, content)
      ElMessage.success(i18ns.t('relay.channelExportSuccess'))
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    } finally {
      channelExporting.value = false
    }
  }

  const copyChannelsAsJson = async () => {
    if (channelExporting.value) return
    channelExporting.value = true
    try {
      const content = await buildChannelExportContent()
      const copied = await copyTextWithFallback(content)
      if (copied) {
        ElMessage.success(i18ns.t('copySuccess'))
        return
      }

      ElMessage.error(i18ns.t('copyFailed'))
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    } finally {
      channelExporting.value = false
    }
  }

  const openChannelImportDialog = () => {
    channelImportText.value = ''
    showChannelImportDialog.value = true
  }

  const handleImportChannels = async () => {
    let channelsToImport: RelayChannelImportItemDto[] = []
    try {
      const parsed = JSON.parse(channelImportText.value)
      const imported = parsed.channels ?? parsed
      if (!Array.isArray(imported)) {
        ElMessage.error(i18ns.t('relay.channelImportFormatError'))
        return
      }

      channelsToImport = imported.filter(
        (item): item is RelayChannelImportItemDto =>
          typeof item?.name === 'string' && item.name.trim().length > 0,
      )

      if (channelsToImport.length !== imported.length) {
        ElMessage.error(i18ns.t('relay.channelImportFormatError'))
        return
      }
    } catch {
      ElMessage.error(i18ns.t('relay.channelImportFormatError'))
      return
    }

    try {
      const result = await relayChannelService.importChannels({
        channels: channelsToImport,
      })
      ElMessage.success(i18ns.t('relay.channelImportSuccess', { count: result.created }))
      showChannelImportDialog.value = false
      channelImportText.value = ''
      await loadChannels()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }

  const handleDuplicateChannel = async (row: Pick<RelayChannelManagementListItemDto, 'id'>) => {
    try {
      await relayChannelService.duplicateChannel(row.id)
      ElMessage.success(i18ns.t('relay.channelDuplicateSuccess'))
      await loadChannels()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }

  const ensureChannelsSelected = () => {
    if (selectedChannelIds.value.length > 0) return true

    ElMessage.warning(i18ns.t('relay.selectChannelsFirst'))
    return false
  }

  const handleBatchDuplicateChannels = async () => {
    if (!ensureChannelsSelected()) return
    const count = selectedChannelIds.value.length

    try {
      await relayChannelService.batchDuplicateChannels(selectedChannelIds.value)
      ElMessage.success(i18ns.t('relay.channelBatchDuplicateSuccess', { count }))
      await loadChannels()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }

  const handleBatchSetChannelStatus = async (enabled: boolean) => {
    if (!ensureChannelsSelected()) return
    const count = selectedChannelIds.value.length

    try {
      await ElMessageBox.confirm(
        i18ns.t('relay.confirmToggleStatus', {
          action: enabled
            ? i18ns.t('relay.batchEnableChannels')
            : i18ns.t('relay.batchDisableChannels'),
        }),
        i18ns.t('warning'),
        {
          type: 'warning',
        },
      )

      await relayChannelService.batchSetChannelStatus({
        ids: selectedChannelIds.value,
        enabled,
      })
      ElMessage.success(
        i18ns.t('relay.channelBatchStatusSuccess', {
          count,
          action: enabled ? i18ns.t('relay.enable') : i18ns.t('relay.disable'),
        }),
      )
      await loadChannels()
    } catch (error: any) {
      if (error !== 'cancel') {
        ElMessage.error(error.message || i18ns.t('operationFailed'))
      }
    }
  }

  const handleBatchDeleteChannels = async () => {
    if (!ensureChannelsSelected()) return
    const count = selectedChannelIds.value.length

    try {
      await ElMessageBox.confirm(i18ns.t('relay.confirmBatchDeleteChannels'), i18ns.t('warning'), {
        type: 'warning',
      })
      await relayChannelService.batchDeleteChannels({
        ids: selectedChannelIds.value,
      })
      ElMessage.success(i18ns.t('relay.channelBatchDeleteSuccess', { count }))
      clearChannelSelection()
      await loadChannels()
    } catch (error: any) {
      if (error !== 'cancel') {
        ElMessage.error(error.message || i18ns.t('operationFailed'))
      }
    }
  }

  const loadChannels = async () => {
    const requestVersion = ++channelRequestVersion.value
    channelLoading.value = true
    try {
      const response = await relayChannelService.listManagementChannels({
        page: channelPagination.value.page,
        pageSize: channelPagination.value.pageSize,
        keyword: channelFilters.value.keyword,
        channelType: channelFilters.value.channelType,
        enabled: channelFilters.value.enabled,
      })
      if (requestVersion !== channelRequestVersion.value) return
      if (response.items.length === 0 && response.total > 0 && channelPagination.value.page > 1) {
        channelPagination.value.page -= 1
        await loadChannels()
        return
      }
      channelRows.value = response.items
      channelPagination.value.total = response.total
      poolMemberTooltipDetails.value = {}
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    } finally {
      channelLoading.value = false
    }
  }

  const loadPoolMemberTooltip = async (row: Pick<RelayChannelManagementListItemDto, 'id'>) => {
    if (
      Object.prototype.hasOwnProperty.call(poolMemberTooltipDetails.value, row.id) ||
      poolMemberTooltipLoadingIds.value.includes(row.id)
    ) {
      return
    }

    poolMemberTooltipLoadingIds.value = [...poolMemberTooltipLoadingIds.value, row.id]
    try {
      poolMemberTooltipDetails.value = {
        ...poolMemberTooltipDetails.value,
        [row.id]: await relayChannelService.getChannel(row.id),
      }
    } catch {
      // The tooltip is supplementary; failure should not interrupt management-list use.
      poolMemberTooltipDetails.value = { ...poolMemberTooltipDetails.value, [row.id]: null }
    } finally {
      poolMemberTooltipLoadingIds.value = poolMemberTooltipLoadingIds.value.filter(
        (id) => id !== row.id,
      )
    }
  }

  let channelKeywordTimer: ReturnType<typeof setTimeout> | undefined
  const setChannelKeyword = (keyword: string) => {
    channelFilters.value.keyword = keyword
    if (channelKeywordTimer) clearTimeout(channelKeywordTimer)
    channelKeywordTimer = setTimeout(() => {
      channelPagination.value.page = 1
      void loadChannels()
    }, 250)
  }

  const updateChannelFilters = (filters: Partial<typeof channelFilters.value>) => {
    channelFilters.value = { ...channelFilters.value, ...filters }
    channelPagination.value.page = 1
    void loadChannels()
  }

  const updateChannelPagination = (page?: number, pageSize?: number) => {
    if (pageSize && pageSize !== channelPagination.value.pageSize) {
      channelPagination.value.pageSize = pageSize
      channelPagination.value.page = 1
    } else if (page) {
      channelPagination.value.page = page
    }
    void loadChannels()
  }

  const openCreateChannelDialog = () => {
    isEditingChannel.value = false
    editingChannelId.value = ''
    channelForm.value = defaultChannelForm()
    ensureSelectedVisibilityOptions(channelForm.value.visibilityConfig)
    showChannelDialog.value = true
    void ensureVisibilityOptionsLoaded()
  }

  const openEditChannelDialog = (
    row: Pick<RelayChannelManagementListItemDto, 'id'> | RelayChannelDto,
  ) => {
    if ('allowedFormats' in row && 'poolMembers' in row) {
      openChannelEditor(row)
      return
    }
    void loadChannelForEditing(row.id)
  }

  const loadChannelForEditing = async (channelId: string) => {
    channelLoading.value = true
    try {
      const detail = await relayChannelService.getChannel(channelId)
      openChannelEditor(detail)
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    } finally {
      channelLoading.value = false
    }
  }

  const openChannelEditor = (row: RelayChannelDto) => {
    isEditingChannel.value = true
    editingChannelId.value = row.id
    const parsedModels = parseAllowedModels(row.configuredAllowedModels)
    const isPooledChannel = ['pooled', 'automatic-proxy-pool'].includes(row.channelType)
    const pooledAllowedModelsMode = isPooledChannel
      ? normalizeAllowedModelsMode(
          (row.routingConfig as RelayChannelRoutingConfigFormDto | null)?.allowedModelsMode,
          row.configuredAllowedModels ? 'manual' : 'all',
        )
      : 'all'
    channelForm.value = {
      name: row.name,
      channelType: row.channelType || 'standalone',
      routingStrategy: row.routingStrategy || 'priority',
      routingConfig: normalizeRoutingConfigForm(row.routingConfig),
      pooledAllowedModelsMode,
      visibilityMode: row.visibilityMode || 'public',
      visibilityConfig: normalizeVisibilityConfigForm(row.visibilityConfig),
      poolMembers: normalizePoolMembersForm(row.poolMembers),
      openaiUpstreamUrl: row.openaiUpstreamUrl || '',
      openaiUpstreamApiKey: '',
      hasOpenaiUpstreamApiKey: row.hasOpenaiUpstreamApiKey,
      openaiUpstreamApiKeyTouched: false,
      anthropicUpstreamUrl: row.anthropicUpstreamUrl || '',
      anthropicUpstreamApiKey: '',
      hasAnthropicUpstreamApiKey: row.hasAnthropicUpstreamApiKey,
      anthropicUpstreamApiKeyTouched: false,
      geminiUpstreamUrl: row.geminiUpstreamUrl || '',
      geminiUpstreamApiKey: '',
      hasGeminiUpstreamApiKey: row.hasGeminiUpstreamApiKey,
      geminiUpstreamApiKeyTouched: false,
      multiplier: row.multiplier,
      allowedFormats: normalizeSupportedFormats(row.allowedFormats || 'all'),
      allowedModelsArray: parsedModels,
      restrictModels:
        !isPooledChannel &&
        row.configuredAllowedModels !== null &&
        row.configuredAllowedModels !== undefined,
      inputTokensIncludeCacheRead: row.inputTokensIncludeCacheRead === true,
      modelMapping: (row.modelMapping as Record<string, string>) || {},
      timePeriodMultipliers: row.timePeriodMultipliers || [],
      contextLengthMultipliers: row.contextLengthMultipliers || [],
    }
    ensureSelectedVisibilityOptions(row.visibilityConfig)
    showChannelDialog.value = true
    void ensureVisibilityOptionsLoaded()
  }

  const openChannelDetailDialog = async (row: Pick<RelayChannelManagementListItemDto, 'id'>) => {
    channelLoading.value = true
    try {
      currentChannelDetail.value = await relayChannelService.getChannel(row.id)
      showChannelDetailDialog.value = true
      if (
        canViewChannelHealth.value &&
        (currentChannelDetail.value.channelType === 'standalone' || canViewPoolMetadata.value)
      ) {
        void loadChannelHealth(row.id)
      }
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    } finally {
      channelLoading.value = false
    }
  }

  const closeChannelDetailDialog = () => {
    showChannelDetailDialog.value = false
    currentChannelDetail.value = null
    channelHealth.value = null
  }

  const loadChannelHealth = async (channelId: string) => {
    channelHealthLoading.value = true
    try {
      channelHealth.value = await relayChannelService.getChannelHealth(channelId)
    } catch (error: any) {
      channelHealth.value = null
      ElMessage.error(error.message || i18ns.t('relay.healthLoadFailed'))
    } finally {
      channelHealthLoading.value = false
    }
  }

  const handleSaveChannel = async () => {
    if (!channelForm.value.name) {
      ElMessage.error(i18ns.t('relay.channelName') + i18ns.t('relay.apiKeyRequired'))
      return
    }

    const isPooledChannel = ['pooled', 'automatic-proxy-pool'].includes(
      channelForm.value.channelType,
    )

    if (
      channelForm.value.visibilityMode === 'whitelist' &&
      normalizeStringArray(channelForm.value.visibilityConfig.userIds).length === 0 &&
      normalizeStringArray(channelForm.value.visibilityConfig.groupIds).length === 0 &&
      normalizeStringArray(channelForm.value.visibilityConfig.roleIds).length === 0
    ) {
      ElMessage.error(i18ns.t('relay.visibilityWhitelistRequired'))
      return
    }

    if (isPooledChannel) {
      const poolMembers = buildPoolMembersPayload()
      if (poolMembers.length === 0) {
        ElMessage.error(i18ns.t('relay.poolMembersRequired'))
        return
      }
    }

    if (!isPooledChannel) {
      if (
        !channelForm.value.openaiUpstreamUrl &&
        !channelForm.value.anthropicUpstreamUrl &&
        !channelForm.value.geminiUpstreamUrl
      ) {
        ElMessage.error(i18ns.t('relay.atLeastOneUpstream'))
        return
      }
    }

    const formats =
      Array.isArray(channelForm.value.allowedFormats) && channelForm.value.allowedFormats.length > 0
        ? channelForm.value.allowedFormats
        : ['openai', 'anthropic', 'gemini']

    if (!isPooledChannel && formats.includes('openai')) {
      if (!channelForm.value.openaiUpstreamUrl) {
        ElMessage.error(i18ns.t('relay.openaiFormatNoUrl'))
        return
      }
      if (!channelForm.value.openaiUpstreamApiKey && !channelForm.value.hasOpenaiUpstreamApiKey) {
        ElMessage.error(i18ns.t('relay.openaiFormatNoKey'))
        return
      }
    }
    if (!isPooledChannel && formats.includes('anthropic')) {
      if (!channelForm.value.anthropicUpstreamUrl) {
        ElMessage.error(i18ns.t('relay.anthropicFormatNoUrl'))
        return
      }
      if (
        !channelForm.value.anthropicUpstreamApiKey &&
        !channelForm.value.hasAnthropicUpstreamApiKey
      ) {
        ElMessage.error(i18ns.t('relay.anthropicFormatNoKey'))
        return
      }
    }
    if (!isPooledChannel && formats.includes('gemini')) {
      if (!channelForm.value.geminiUpstreamUrl) {
        ElMessage.error(i18ns.t('relay.geminiFormatNoUrl'))
        return
      }
      if (!channelForm.value.geminiUpstreamApiKey && !channelForm.value.hasGeminiUpstreamApiKey) {
        ElMessage.error(i18ns.t('relay.geminiFormatNoKey'))
        return
      }
    }

    if (
      (!isPooledChannel && !Array.isArray(channelForm.value.allowedFormats)) ||
      channelForm.value.allowedFormats.length === 0
    ) {
      if (
        channelForm.value.openaiUpstreamUrl &&
        !channelForm.value.openaiUpstreamApiKey &&
        !channelForm.value.hasOpenaiUpstreamApiKey
      ) {
        ElMessage.error(i18ns.t('relay.openaiUrlNoKey'))
        return
      }
      if (
        channelForm.value.anthropicUpstreamUrl &&
        !channelForm.value.anthropicUpstreamApiKey &&
        !channelForm.value.hasAnthropicUpstreamApiKey
      ) {
        ElMessage.error(i18ns.t('relay.anthropicUrlNoKey'))
        return
      }
      if (
        channelForm.value.geminiUpstreamUrl &&
        !channelForm.value.geminiUpstreamApiKey &&
        !channelForm.value.hasGeminiUpstreamApiKey
      ) {
        ElMessage.error(i18ns.t('relay.geminiUrlNoKey'))
        return
      }
    }

    channelSaving.value = true
    try {
      const routingConfig = isPooledChannel
        ? buildRoutingConfigPayload()
        : buildStandaloneHealthTrackingPayload()
      const visibilityConfig =
        channelForm.value.visibilityMode === 'hidden' ? null : buildVisibilityConfigPayload()
      const poolMembers = isPooledChannel ? buildPoolMembersPayload() : []

      const data = {
        name: channelForm.value.name,
        channelType: channelForm.value.channelType,
        routingStrategy: channelForm.value.routingStrategy,
        routingConfig,
        visibilityMode: channelForm.value.visibilityMode,
        visibilityConfig,
        poolMembers: isPooledChannel ? poolMembers : [],
        openaiUpstreamUrl: isPooledChannel ? '' : channelForm.value.openaiUpstreamUrl,
        anthropicUpstreamUrl: isPooledChannel ? '' : channelForm.value.anthropicUpstreamUrl,
        geminiUpstreamUrl: isPooledChannel ? '' : channelForm.value.geminiUpstreamUrl,
        multiplier: isPooledChannel ? undefined : channelForm.value.multiplier,
        allowedFormats:
          Array.isArray(channelForm.value.allowedFormats) &&
          channelForm.value.allowedFormats.length > 0
            ? channelForm.value.allowedFormats.join(',')
            : 'all',
        allowedModels: isPooledChannel
          ? channelForm.value.pooledAllowedModelsMode === 'manual'
            ? JSON.stringify(channelForm.value.allowedModelsArray)
            : null
          : channelForm.value.restrictModels
            ? JSON.stringify(channelForm.value.allowedModelsArray)
            : null,
        inputTokensIncludeCacheRead: channelForm.value.inputTokensIncludeCacheRead,
        modelMapping:
          channelForm.value.modelMapping && Object.keys(channelForm.value.modelMapping).length > 0
            ? channelForm.value.modelMapping
            : null,
        timePeriodMultipliers:
          channelForm.value.timePeriodMultipliers.length > 0
            ? channelForm.value.timePeriodMultipliers
            : null,
        contextLengthMultipliers:
          channelForm.value.contextLengthMultipliers.length > 0
            ? [...channelForm.value.contextLengthMultipliers].sort(
                (left, right) => left.minTokens - right.minTokens,
              )
            : null,
      }

      if (isEditingChannel.value) {
        const secretUpdates = isPooledChannel
          ? {
              openaiUpstreamApiKey: '',
              anthropicUpstreamApiKey: '',
              geminiUpstreamApiKey: '',
            }
          : {
              ...(channelForm.value.openaiUpstreamApiKeyTouched
                ? { openaiUpstreamApiKey: channelForm.value.openaiUpstreamApiKey }
                : {}),
              ...(channelForm.value.anthropicUpstreamApiKeyTouched
                ? { anthropicUpstreamApiKey: channelForm.value.anthropicUpstreamApiKey }
                : {}),
              ...(channelForm.value.geminiUpstreamApiKeyTouched
                ? { geminiUpstreamApiKey: channelForm.value.geminiUpstreamApiKey }
                : {}),
            }
        await relayChannelService.updateChannel(editingChannelId.value, {
          ...data,
          ...secretUpdates,
        })
      } else {
        await relayChannelService.createChannel({
          ...data,
          openaiUpstreamApiKey: isPooledChannel ? '' : channelForm.value.openaiUpstreamApiKey,
          anthropicUpstreamApiKey: isPooledChannel ? '' : channelForm.value.anthropicUpstreamApiKey,
          geminiUpstreamApiKey: isPooledChannel ? '' : channelForm.value.geminiUpstreamApiKey,
        })
      }

      ElMessage.success(
        isEditingChannel.value ? i18ns.t('relay.updateSuccess') : i18ns.t('relay.createSuccess'),
      )
      showChannelDialog.value = false
      await loadChannels()
      await loadAvailableModels()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.createFailed'))
    } finally {
      channelSaving.value = false
    }
  }

  const handleToggleChannelStatus = async (
    row: Pick<RelayChannelManagementListItemDto, 'id' | 'enabled'>,
  ) => {
    try {
      const action = row.enabled ? i18ns.t('relay.disableChannel') : i18ns.t('relay.enableChannel')
      await ElMessageBox.confirm(
        i18ns.t('relay.confirmToggleStatus', { action }),
        i18ns.t('warning'),
        {
          type: 'warning',
        },
      )

      togglingChannelId.value = row.id
      await relayChannelService.toggleChannelStatus(row.id)
      ElMessage.success(i18ns.t('relay.updateSuccess'))
      await loadChannels()
    } catch (error: any) {
      if (error !== 'cancel') {
        ElMessage.error(error.message || i18ns.t('operationFailed'))
      }
    } finally {
      if (togglingChannelId.value === row.id) {
        togglingChannelId.value = ''
      }
    }
  }

  const handleDeleteChannel = async (row: Pick<RelayChannelManagementListItemDto, 'id'>) => {
    try {
      await ElMessageBox.confirm(i18ns.t('relay.confirmDeleteChannel'), i18ns.t('warning'), {
        type: 'warning',
      })
      await relayChannelService.deleteChannel(row.id)
      ElMessage.success(i18ns.t('relay.deleteSuccess'))
      loadChannels()
    } catch (error: any) {
      if (error !== 'cancel') {
        ElMessage.error(error.message || i18ns.t('relay.deleteFailed'))
      }
    }
  }

  const { isDesktop } = usePageDevice()

  onMounted(() => {
    loadConfig()
    loadChannels()
    loadAvailableModels()
  })

  watch(isDesktop, () => {
    const sourceSections = isDesktop.value ? mobileSections.value : desktopSections.value
    const targetLoaded = isDesktop.value ? desktopSectionLoaded : mobileSectionLoaded
    const targetSections = isDesktop.value ? desktopSections : mobileSections
    for (const name of sourceSections) {
      if (!targetLoaded.value[name]) {
        targetLoaded.value[name] = true
      }
      if (!targetSections.value.includes(name)) {
        targetSections.value = [...targetSections.value, name]
      }
    }
  })

  // Legacy page sections remain mounted behind feature guards during the transition to the compact list.
  const legacyChannels = channelRows as any
  const legacySelectedChannels = computed(() => selectedChannelIds.value) as any
  const legacyAvailablePoolMemberChannels = computed(() => []) as any
  const legacyIsPoolMemberOptionDisabled = () => false
  const legacyAddPoolMember = () => void openPoolMemberPicker()

  return {
    Permission,
    isDesktop,
    loading,
    saving,
    showImportDialog,
    importText,
    editingRowIndex,
    desktopSections,
    mobileSections,
    importPricingPlaceholder,
    channelImportPlaceholder,
    getModelRateRowKey,
    modelRates,
    globalMultiplier,
    uptimeStatusUrl,
    enableQueue,
    maxConcurrency,
    queueTimeoutSec,
    upstreamStreamTimeoutSec,
    apiCatalogPoolVisibility,
    relayCustomKeyEnabled,
    relayCustomKeyMaxTokensPerUser,
    relayCustomKeyCreateLimitWindowMinutes,
    relayCustomKeyCreateLimitMaxCount,
    monitorConfigEnabled,
    showOnlyConfigured,
    monitorConfigs,
    save,
    exportModelPricing,
    copyModelPricing,
    addMonitorConfig,
    addModelRate,
    onCollapseEnter,
    onCollapseAfterEnter,
    onCollapseLeave,
    onCollapseAfterLeave,
    isMobileSectionExpanded,
    isMobileSectionLoaded,
    toggleMobileSection,
    handleImport,
    channelRows,
    channels: legacyChannels,
    channelFilters,
    channelPagination,
    channelLoading,
    channelSaving,
    channelExporting,
    togglingChannelId,
    poolMemberTooltipDetails,
    poolMemberTooltipLoadingIds,
    showChannelDialog,
    showChannelDetailDialog,
    showChannelImportDialog,
    channelImportText,
    isEditingChannel,
    currentChannelDetail,
    channelHealth,
    channelHealthLoading,
    canViewChannelHealth,
    canViewPoolMetadata,
    selectedChannelCount,
    selectedChannels: legacySelectedChannels,
    hasChannelSelection,
    isCurrentPageFullySelected,
    isAllChannelsSelected: isCurrentPageFullySelected,
    visibilityUserOptions,
    visibilityGroupOptions,
    visibilityRoleOptions,
    visibilityUserOptionsLoading,
    visibilityGroupOptionsLoading,
    visibilityRoleOptionsLoading,
    channelForm,
    timeRuleDialogVisible,
    editingTimeRuleIndex,
    timeRuleFormRef,
    timeRuleDays,
    timeRuleRange,
    timeRuleForm,
    timeRuleFormRules,
    timeRuleDayOptions,
    formatTimeRuleDays,
    openAddTimeRule,
    openEditTimeRule,
    saveTimeRule,
    removeTimeRule,
    filteredModels,
    formatModelOptionLabel,
    isModelDisabled,
    computeShowUpstream,
    getChannelNameById,
    availablePoolMemberChannels: legacyAvailablePoolMemberChannels,
    isPoolMemberOptionDisabled: legacyIsPoolMemberOptionDisabled,
    addPoolMember: legacyAddPoolMember,
    showPoolMemberPicker,
    poolMemberPickerRows,
    poolMemberPickerPagination,
    poolMemberPickerKeyword,
    selectedPoolMemberCandidateIds,
    poolMemberInsertPosition,
    openPoolMemberPicker,
    loadPoolMemberCandidates,
    loadPoolMemberTooltip,
    addSelectedPoolMembers,
    movePoolMember,
    movePoolMemberToEdge,
    removePoolMember,
    resetRoutingConfigToRecommended,
    clearOptionalRoutingThresholds,
    formatChannelTypeLabel,
    formatRoutingStrategyLabel,
    formatVisibilityModeLabel,
    getVisibilitySummary,
    getPoolMembersSummary,
    getChannelAllowedModelsMode,
    getChannelAllowedModelsSummary,
    parseAllowedModels,
    isChannelSelected,
    toggleChannelSelection,
    toggleCurrentPageSelection,
    toggleAllChannels: toggleCurrentPageSelection,
    setChannelKeyword,
    updateChannelFilters,
    updateChannelPagination,
    filteredModelNames,
    clearChannelSelection,
    exportChannelsAsJson,
    copyChannelsAsJson,
    openChannelImportDialog,
    openChannelDetailDialog,
    closeChannelDetailDialog,
    loadChannelHealth,
    handleVisibilityUserSearch,
    handleImportChannels,
    handleDuplicateChannel,
    handleBatchDuplicateChannels,
    handleBatchSetChannelStatus,
    handleBatchDeleteChannels,
    openCreateChannelDialog,
    openEditChannelDialog,
    handleSaveChannel,
    handleToggleChannelStatus,
    handleDeleteChannel,
  }
}

export type RelaySettingsManagementState = ReturnType<typeof useRelaySettingsManagement>
