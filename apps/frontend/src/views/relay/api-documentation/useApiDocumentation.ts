import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import {
  type ChannelMatchMode,
  type ChannelPriceMode,
  type PricingTableMode,
  type PriceRangeField,
  type PricingSortField,
  type PricingSortOrder,
  useApiDocumentationPricing,
} from '@/composables/useApiDocumentationPricing'
import { usePageDevice } from '@/composables/usePageDevice'
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import router from '@/router'
import { swaggerDocsService } from '@/service/swaggerDocsService'
import { usePermissionStore } from '@/stores/permissionStore'
import {
  buildRelayUsageEndpointUrl,
  CCSWITCH_BALANCE_SAMPLE,
  resolveRelayAiBaseUrl,
} from '@/constant/strings'
import { Permission } from '@/constant/permission'

export function useApiDocumentation() {
  const baseUrl = computed(() => String(import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, ''))
  const permissionStore = usePermissionStore()
  const aiBaseUrl = computed(() =>
    resolveRelayAiBaseUrl(
      import.meta.env.VITE_RELAY_PUBLIC_BASE_URL,
      import.meta.env.VITE_AI_PROXY_URL,
    ),
  )
  const swaggerDocsBaseUrl = computed(() => (baseUrl.value ? `${baseUrl.value}/docs` : '/docs'))
  const relayUsageEndpoint = computed(() =>
    buildRelayUsageEndpointUrl({
      relayPublicBaseUrl: import.meta.env.VITE_RELAY_PUBLIC_BASE_URL,
      aiProxyUrl: import.meta.env.VITE_AI_PROXY_URL,
      backendBaseUrl: import.meta.env.VITE_BACKEND_URL,
    }),
  )
  const platformBalanceEndpoint = computed(() =>
    baseUrl.value ? `${baseUrl.value}/v1/balance/usage` : '/v1/balance/usage',
  )
  const ccswitchBalanceSample = computed(() =>
    CCSWITCH_BALANCE_SAMPLE.replace('{{usageEndpoint}}', relayUsageEndpoint.value),
  )
  const canOpenSwagger = computed(() =>
    permissionStore.hasPermission(Permission.DEBUG_OPENAPI_READ),
  )
  const openingSwaggerDocs = ref(false)
  const showFullEndpoint = ref(false)
  const activeTabName = ref<'endpoints' | 'pricing' | 'tutorial'>('endpoints')
  const pricingTabActivated = ref(false)
  const mobilePricingControlsExpanded = ref(false)
  const mobilePricingAdvancedSettingsExpanded = ref(false)
  const currentPage = ref(1)
  const pageSize = ref(20)
  const pageSizeOptions = [20, 50, 100, 200]

  const displayOpenaiEndpoint = computed(() =>
    showFullEndpoint.value ? `${aiBaseUrl.value}/v1/chat/completions` : `${aiBaseUrl.value}/v1`,
  )
  const displayAnthropicEndpoint = computed(() =>
    showFullEndpoint.value ? `${aiBaseUrl.value}/v1/messages` : aiBaseUrl.value,
  )
  const displayGeminiEndpoint = computed(() =>
    showFullEndpoint.value
      ? `${aiBaseUrl.value}/v1beta/models/{model}/generateContent`
      : `${aiBaseUrl.value}/v1beta`,
  )

  const {
    loading,
    loadErrorMessage,
    channels,
    selectedChannels,
    filterFormat,
    filterChannelIds,
    filterPricingType,
    filterModelKeyword,
    onlyModelsWithChannels,
    channelMatchMode,
    channelPriceMode,
    pricingTableMode,
    primaryComparisonChannelId,
    primaryComparisonChannel,
    customPriceMultiplier,
    tokenPriceUnit,
    fixedPriceMin,
    fixedPriceMax,
    inputPriceMin,
    inputPriceMax,
    outputPriceMin,
    outputPriceMax,
    sortField,
    sortOrder,
    filteredPricingData,
    priceDisplayMode,
    normalizeFormats,
    getRequestModelId,
    getChannelsForModel,
    getSelectedChannelsForModel,
    getDisplayedPriceMultiplier,
    getChannelPriceCell,
    getHighlightParts,
    toggleTokenPriceUnit,
    resetFilters,
    refreshData,
    copyText,
  } = useApiDocumentationPricing()

  const showCacheMultipliers = ref(false)

  const customMultiplierActive = computed(
    () => customPriceMultiplier.value !== null && customPriceMultiplier.value !== 1,
  )

  const selectedChannelCount = computed(() => selectedChannels.value.length)

  const selectedChannelSummary = computed(() => {
    if (selectedChannelCount.value === 0) return ''
    return i18ns.t('apiDoc.selectedChannelsSummary', { count: selectedChannelCount.value })
  })

  const handleChannelMatchModeChange = (value: ChannelMatchMode) => {
    channelMatchMode.value = value
    currentPage.value = 1
  }

  const handleChannelPriceModeChange = (value: ChannelPriceMode) => {
    if (value === 'selected-lowest' && filterChannelIds.value.length === 0) {
      channelPriceMode.value = 'base'
      return
    }

    channelPriceMode.value = value
    currentPage.value = 1
  }

  const handlePricingTableModeChange = (value: PricingTableMode) => {
    pricingTableMode.value = value
    currentPage.value = 1
  }

  const handlePrimaryComparisonChannelChange = (value: string) => {
    primaryComparisonChannelId.value = value
    currentPage.value = 1
  }

  const mobileSortField = computed<PricingSortField>({
    get: () => sortField.value || '',
    set: (value) => {
      sortField.value = value

      if (!value) {
        sortOrder.value = ''
        return
      }

      if (!sortOrder.value) {
        sortOrder.value = 'asc'
      }

      currentPage.value = 1
    },
  })

  const mobileSortOrder = computed<PricingSortOrder>({
    get: () => sortOrder.value || '',
    set: (value) => {
      if (!mobileSortField.value) {
        sortOrder.value = ''
        return
      }

      sortOrder.value = value

      if (!value) {
        sortField.value = ''
      }

      currentPage.value = 1
    },
  })

  const priceRanges = computed(() => ({
    fixedPrice: {
      min: fixedPriceMin.value,
      max: fixedPriceMax.value,
    },
    inputPrice: {
      min: inputPriceMin.value,
      max: inputPriceMax.value,
    },
    outputPrice: {
      min: outputPriceMin.value,
      max: outputPriceMax.value,
    },
  }))

  const paginatedPricingData = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value
    return filteredPricingData.value.slice(start, start + pageSize.value)
  })

  const balanceFields = computed(() => [
    { field: i18ns.t('apiDoc.fieldIsValid'), description: i18ns.t('apiDoc.fieldIsValidDesc') },
    {
      field: i18ns.t('apiDoc.fieldInvalidMessage'),
      description: i18ns.t('apiDoc.fieldInvalidMessageDesc'),
    },
    { field: i18ns.t('apiDoc.fieldRemaining'), description: i18ns.t('apiDoc.fieldRemainingDesc') },
    { field: i18ns.t('apiDoc.fieldUnit'), description: i18ns.t('apiDoc.fieldUnitDesc') },
    { field: i18ns.t('apiDoc.fieldPlanName'), description: i18ns.t('apiDoc.fieldPlanNameDesc') },
    { field: i18ns.t('apiDoc.fieldTotal'), description: i18ns.t('apiDoc.fieldTotalDesc') },
    { field: i18ns.t('apiDoc.fieldUsed'), description: i18ns.t('apiDoc.fieldUsedDesc') },
    { field: i18ns.t('apiDoc.fieldExtra'), description: i18ns.t('apiDoc.fieldExtraDesc') },
  ])

  const toErrorMessage = (error: unknown, fallback: string) => {
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) return message
    }
    return fallback
  }

  const ensurePricingTabReady = async () => {
    if (pricingTabActivated.value) return
    pricingTabActivated.value = true
    await refreshData()
  }

  const handleTabChange = async (name: string | number) => {
    if (name === 'pricing') {
      await ensurePricingTabReady()
    }
  }

  const handleSortChange = (field: PricingSortField, order: PricingSortOrder) => {
    sortField.value = field
    sortOrder.value = order
    currentPage.value = 1
  }

  const handlePricingTypeFilterChange = (value: string) => {
    filterPricingType.value = value
    currentPage.value = 1
  }

  const handlePriceRangeChange = (
    field: PriceRangeField,
    bound: 'min' | 'max',
    value: number | null,
  ) => {
    const normalizedValue = typeof value === 'number' ? value : null

    if (field === 'fixedPrice') {
      if (bound === 'min') fixedPriceMin.value = normalizedValue
      else fixedPriceMax.value = normalizedValue
      return
    }

    if (field === 'inputPrice') {
      if (bound === 'min') inputPriceMin.value = normalizedValue
      else inputPriceMax.value = normalizedValue
      return
    }

    if (bound === 'min') outputPriceMin.value = normalizedValue
    else outputPriceMax.value = normalizedValue
  }

  const resetPriceRangeFilter = (field: PriceRangeField) => {
    if (field === 'fixedPrice') {
      fixedPriceMin.value = null
      fixedPriceMax.value = null
      return
    }

    if (field === 'inputPrice') {
      inputPriceMin.value = null
      inputPriceMax.value = null
      return
    }

    outputPriceMin.value = null
    outputPriceMax.value = null
  }

  const handleResetFilters = () => {
    resetFilters()
    currentPage.value = 1
  }

  const openSwaggerDocs = async () => {
    if (openingSwaggerDocs.value) return

    const previewWindow = window.open('', '_blank')

    if (previewWindow) {
      try {
        previewWindow.opener = null
      } catch {
        // Ignore browser restrictions while keeping the popup alive for user-gesture navigation.
      }
    }

    openingSwaggerDocs.value = true

    try {
      const handoff = await swaggerDocsService.generateAccessLink(60)
      const targetUrl = swaggerDocsService.buildDocsUrl(swaggerDocsBaseUrl.value, handoff.reurl)

      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.replace(targetUrl)
        previewWindow.focus()
        return
      }

      window.location.assign(targetUrl)
    } catch (error) {
      previewWindow?.close()
      ElMessage.error(toErrorMessage(error, i18ns.t('apiDoc.openSwaggerDocsFailed')))
    } finally {
      openingSwaggerDocs.value = false
    }
  }

  const goRelayTokenManagement = () => {
    void router.push({ name: 'relayTokenManagement' })
  }

  const goSettingsSecurity = () => {
    void router.push({ name: 'settingsSecurity' })
  }

  onMounted(() => {
    void permissionStore.init()

    if (activeTabName.value === 'pricing') {
      void ensurePricingTabReady()
    }
  })

  const { isDesktop } = usePageDevice()

  if (!isDesktop.value) {
    useMobileTableCardLabels('.mobile-adapter')
  }

  watch(filteredPricingData, () => {
    const totalPages = Math.max(1, Math.ceil(filteredPricingData.value.length / pageSize.value))
    if (currentPage.value > totalPages) {
      currentPage.value = totalPages
    }
  })

  watch(
    [
      filterFormat,
      filterChannelIds,
      filterPricingType,
      filterModelKeyword,
      onlyModelsWithChannels,
      channelMatchMode,
      channelPriceMode,
      pricingTableMode,
      primaryComparisonChannelId,
      fixedPriceMin,
      fixedPriceMax,
      inputPriceMin,
      inputPriceMax,
      outputPriceMin,
      outputPriceMax,
    ],
    () => {
      currentPage.value = 1
    },
  )

  watch(pageSize, () => {
    currentPage.value = 1
  })

  return {
    activeTabName,
    aiBaseUrl,
    balanceFields,
    canOpenSwagger,
    ccswitchBalanceSample,
    channels,
    channelMatchMode,
    channelPriceMode,
    pricingTableMode,
    copyText,
    currentPage,
    customMultiplierActive,
    customPriceMultiplier,
    displayAnthropicEndpoint,
    displayGeminiEndpoint,
    displayOpenaiEndpoint,
    filterChannelIds,
    filterFormat,
    filterModelKeyword,
    filterPricingType,
    filteredPricingData,
    fixedPriceMax,
    fixedPriceMin,
    getChannelsForModel,
    getSelectedChannelsForModel,
    getDisplayedPriceMultiplier,
    getHighlightParts,
    getRequestModelId,
    goRelayTokenManagement,
    goSettingsSecurity,
    handleChannelMatchModeChange,
    handleChannelPriceModeChange,
    handlePricingTableModeChange,
    handlePriceRangeChange,
    handlePrimaryComparisonChannelChange,
    handlePricingTypeFilterChange,
    handleResetFilters,
    handleSortChange,
    handleTabChange,
    inputPriceMax,
    inputPriceMin,
    isDesktop,
    loadErrorMessage,
    loading,
    mobilePricingAdvancedSettingsExpanded,
    mobilePricingControlsExpanded,
    mobileSortField,
    mobileSortOrder,
    normalizeFormats,
    onlyModelsWithChannels,
    openSwaggerDocs,
    openingSwaggerDocs,
    outputPriceMax,
    outputPriceMin,
    pageSize,
    pageSizeOptions,
    paginatedPricingData,
    platformBalanceEndpoint,
    priceDisplayMode,
    priceRanges,
    pricingTabActivated,
    primaryComparisonChannel,
    primaryComparisonChannelId,
    refreshData,
    relayUsageEndpoint,
    resetPriceRangeFilter,
    selectedChannelCount,
    selectedChannelSummary,
    selectedChannels,
    showCacheMultipliers,
    showFullEndpoint,
    sortField,
    sortOrder,
    tokenPriceUnit,
    toggleTokenPriceUnit,
    getChannelPriceCell,
  }
}

export type ApiDocumentationState = ReturnType<typeof useApiDocumentation>
