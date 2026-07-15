import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { i18ns } from '@/locales'
import type { ModelPricingDto, RelayChannelOptionDto } from '@/client/types.gen'
import { ElMessage } from 'element-plus'
import { modelPricingService } from '@/service/modelPricingService'
import { relayChannelService } from '@/service/relayChannelService'
import { LruCache } from '@/utils/lru-cache'
import { copyTextWithFallback } from '@/utils/clipboard'
import { normalizeRelayFormats } from '../utils/relay-formats'

export type HighlightPart = {
  text: string
  matched: boolean
}

export type PricingModelRow = ModelPricingDto & {
  modelId?: string | null
}

export type PricingSortField = 'model' | 'fixedPrice' | 'inputPrice' | 'outputPrice' | ''
export type PricingSortOrder = 'asc' | 'desc' | ''
export type ChannelMatchMode = 'match-any' | 'match-all'
export type ChannelPriceMode = 'base' | 'selected-lowest' | 'global-lowest'
export type PricingDisplayMode = ChannelPriceMode
export type PricingTableMode = 'summary' | 'channel-columns'
export type PriceRangeField = 'fixedPrice' | 'inputPrice' | 'outputPrice'
export type PricingTokenUnit = 'M' | 'K'

export type ChannelPriceCell = {
  available: boolean
  channelId: string
  channelName: string
  multiplier: number
  fixedPrice: number | null
  inputPrice: number | null
  outputPrice: number | null
  cacheCreationMultiplier: number | null
  cacheReadMultiplier: number | null
}

const HIGHLIGHT_CACHE_MAX_SIZE = 500
const normalizeFormats = (formats?: string): string[] => normalizeRelayFormats(formats)

const buildHighlightCacheKey = (keyword: string, text: string): string =>
  JSON.stringify([keyword, text])

const resolveErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export const useApiDocumentationPricing = () => {
  const loading = ref(false)
  const loadErrorMessage = ref('')
  const pricingData = ref<PricingModelRow[]>([])
  const channels = ref<RelayChannelOptionDto[]>([])

  const filterFormat = ref<string>('')
  const filterChannelIds = ref<string[]>([])
  const filterPricingType = ref<string>('')
  const filterModelKeyword = ref<string>('')
  const onlyModelsWithChannels = ref(true)
  const channelMatchMode = ref<ChannelMatchMode>('match-any')
  const channelPriceMode = ref<ChannelPriceMode>('selected-lowest')
  const pricingTableMode = ref<PricingTableMode>('summary')
  const primaryComparisonChannelId = ref('')
  const customPriceMultiplier = ref<number | null>(null)
  const tokenPriceUnit = ref<PricingTokenUnit>('M')
  const fixedPriceMin = ref<number | null>(null)
  const fixedPriceMax = ref<number | null>(null)
  const inputPriceMin = ref<number | null>(null)
  const inputPriceMax = ref<number | null>(null)
  const outputPriceMin = ref<number | null>(null)
  const outputPriceMax = ref<number | null>(null)
  const sortField = ref<PricingSortField>('')
  const sortOrder = ref<PricingSortOrder>('')

  const highlightPartsCache = new LruCache<string, HighlightPart[]>(HIGHLIGHT_CACHE_MAX_SIZE)

  const getRequestModelId = (
    item: Pick<PricingModelRow, 'model' | 'modelId' | 'provider'>,
  ): string => {
    const modelId = (item.modelId || '').trim()
    if (modelId) return modelId

    const provider = (item.provider || '').trim()
    if (provider) return provider

    return (item.model || '').trim()
  }

  const selectedChannelIdsSet = computed(() => new Set(filterChannelIds.value))

  const filterChannel = computed<string>({
    get: () => filterChannelIds.value[0] || '',
    set: (channelId) => {
      filterChannelIds.value = channelId ? [channelId] : []
    },
  })

  const showLowestChannelPrice = computed<boolean>({
    get: () => channelPriceMode.value === 'global-lowest',
    set: (enabled) => {
      if (enabled) {
        channelPriceMode.value = 'global-lowest'
        return
      }

      if (channelPriceMode.value === 'global-lowest') {
        channelPriceMode.value = filterChannelIds.value.length > 0 ? 'selected-lowest' : 'base'
      }
    },
  })

  const selectedChannels = computed(() => {
    const channelMap = new Map(channels.value.map((channel) => [channel.id, channel]))

    return filterChannelIds.value
      .map((channelId) => channelMap.get(channelId))
      .filter((channel): channel is RelayChannelOptionDto => Boolean(channel))
  })

  const primaryComparisonChannel = computed(() => {
    return (
      selectedChannels.value.find((channel) => channel.id === primaryComparisonChannelId.value) ||
      null
    )
  })

  const getChannelsForModel = (
    modelName: string,
    modelId: string,
    modelFormat?: string,
  ): RelayChannelOptionDto[] => {
    const normalizedModelName = modelName.trim()
    const normalizedModelId = modelId.trim()
    const modelFormats = normalizeFormats(modelFormat)

    return channels.value.filter((channel) => {
      return channel.modelCapabilities.some(
        (capability) =>
          (capability.catalogModelName === normalizedModelName ||
            capability.requestModelId === normalizedModelId) &&
          capability.supportedRequestFormats.some((format) => modelFormats.includes(format)),
      )
    })
  }

  const getSelectedChannelsForModel = (item: PricingModelRow): RelayChannelOptionDto[] => {
    const availableChannels = getChannelsForModel(
      item.model || '',
      getRequestModelId(item),
      item.supportedFormats,
    )

    if (selectedChannelIdsSet.value.size === 0) return []

    return availableChannels.filter((channel) => selectedChannelIdsSet.value.has(channel.id))
  }

  const getLowestMultiplierForModel = (item: PricingModelRow): number | null => {
    const availableChannels = getChannelsForModel(
      item.model || '',
      getRequestModelId(item),
      item.supportedFormats,
    )

    if (availableChannels.length === 0) return null

    return Math.min(...availableChannels.map((channel) => channel.multiplier ?? 1))
  }

  const getLowestSelectedMultiplierForModel = (item: PricingModelRow): number | null => {
    const availableSelectedChannels = getSelectedChannelsForModel(item)

    if (availableSelectedChannels.length === 0) return null

    return Math.min(...availableSelectedChannels.map((channel) => channel.multiplier ?? 1))
  }

  const getDisplayedPriceMultiplier = (item: PricingModelRow): number => {
    const customMultiplier = customPriceMultiplier.value ?? 1

    if (channelPriceMode.value === 'global-lowest') {
      return (getLowestMultiplierForModel(item) ?? 1) * customMultiplier
    }

    if (channelPriceMode.value === 'selected-lowest') {
      return (getLowestSelectedMultiplierForModel(item) ?? 1) * customMultiplier
    }

    return customMultiplier
  }

  const getChannelPriceCell = (
    item: PricingModelRow,
    channel: Pick<RelayChannelOptionDto, 'id' | 'name' | 'multiplier'>,
  ): ChannelPriceCell => {
    const availableChannel = getChannelsForModel(
      item.model || '',
      getRequestModelId(item),
      item.supportedFormats,
    ).find((candidate) => candidate.id === channel.id)

    const customMultiplier = customPriceMultiplier.value ?? 1
    const channelMultiplier =
      (availableChannel?.multiplier ?? channel.multiplier ?? 1) * customMultiplier
    const divisor = getTokenPriceUnitDivisor()

    if (!availableChannel) {
      return {
        available: false,
        channelId: channel.id,
        channelName: channel.name,
        multiplier: channelMultiplier,
        fixedPrice: null,
        inputPrice: null,
        outputPrice: null,
        cacheCreationMultiplier: item.cacheCreationMultiplier ?? null,
        cacheReadMultiplier: item.cacheReadMultiplier ?? null,
      }
    }

    return {
      available: true,
      channelId: channel.id,
      channelName: channel.name,
      multiplier: channelMultiplier,
      fixedPrice:
        item.pricingType === 'per-request' ? (item.fixedPrice ?? 0) * channelMultiplier : null,
      inputPrice:
        item.pricingType === 'per-request'
          ? null
          : ((item.inputPrice ?? 0) * channelMultiplier) / divisor,
      outputPrice:
        item.pricingType === 'per-request'
          ? null
          : ((item.outputPrice ?? 0) * channelMultiplier) / divisor,
      cacheCreationMultiplier: item.cacheCreationMultiplier ?? null,
      cacheReadMultiplier: item.cacheReadMultiplier ?? null,
    }
  }

  const priceDisplayMode = computed<PricingDisplayMode>(() => {
    if (channelPriceMode.value === 'global-lowest') return 'global-lowest'
    if (channelPriceMode.value === 'selected-lowest' && filterChannelIds.value.length > 0) {
      return 'selected-lowest'
    }

    return 'base'
  })

  const getTokenPriceUnitDivisor = (): number => {
    return tokenPriceUnit.value === 'K' ? 1000 : 1
  }

  const getComparablePrice = (
    item: PricingModelRow,
    field: Exclude<PricingSortField, ''>,
  ): number | null => {
    if (pricingTableMode.value === 'channel-columns' && primaryComparisonChannel.value) {
      const comparisonCell = getChannelPriceCell(item, primaryComparisonChannel.value)

      if (field === 'fixedPrice') return comparisonCell.fixedPrice
      if (field === 'inputPrice') return comparisonCell.inputPrice
      if (field === 'outputPrice') return comparisonCell.outputPrice
      return null
    }

    const multiplier = getDisplayedPriceMultiplier(item)

    if (field === 'fixedPrice') {
      if (item.pricingType !== 'per-request') return null
      return (item.fixedPrice ?? 0) * multiplier
    }

    if (item.pricingType === 'per-request') return null

    const divisor = getTokenPriceUnitDivisor()

    if (field === 'inputPrice') return (item.inputPrice * multiplier) / divisor
    if (field === 'outputPrice') return (item.outputPrice * multiplier) / divisor

    return null
  }

  const isWithinRange = (value: number | null, min: number | null, max: number | null): boolean => {
    if (min == null && max == null) return true
    if (value == null) return false
    if (min != null && value < min) return false
    if (max != null && value > max) return false
    return true
  }

  const compareNullableNumbers = (
    left: number | null,
    right: number | null,
    direction: PricingSortOrder,
  ): number => {
    if (left == null && right == null) return 0
    if (left == null) return 1
    if (right == null) return -1

    return direction === 'asc' ? left - right : right - left
  }

  const filteredPricingData = computed(() => {
    let result = [...pricingData.value]

    if (filterModelKeyword.value.trim()) {
      const keyword = filterModelKeyword.value.trim().toLowerCase()
      result = result.filter((item) => {
        const modelName = (item.model || '').toLowerCase()
        const modelId = getRequestModelId(item).toLowerCase()
        return modelName.includes(keyword) || modelId.includes(keyword)
      })
    }

    if (filterPricingType.value) {
      result = result.filter((item) => item.pricingType === filterPricingType.value)
    }

    if (filterFormat.value) {
      result = result.filter((item) =>
        normalizeFormats(item.supportedFormats).includes(filterFormat.value),
      )
    }

    if (filterChannelIds.value.length > 0) {
      result = result.filter((item) => {
        const availableSelectedChannels = getSelectedChannelsForModel(item)

        if (channelMatchMode.value === 'match-all') {
          return availableSelectedChannels.length === filterChannelIds.value.length
        }

        return availableSelectedChannels.length > 0
      })
    }

    if (onlyModelsWithChannels.value) {
      result = result.filter(
        (item) =>
          getChannelsForModel(item.model || '', getRequestModelId(item), item.supportedFormats)
            .length > 0,
      )
    }

    result = result.filter((item) =>
      isWithinRange(
        getComparablePrice(item, 'fixedPrice'),
        fixedPriceMin.value,
        fixedPriceMax.value,
      ),
    )
    result = result.filter((item) =>
      isWithinRange(
        getComparablePrice(item, 'inputPrice'),
        inputPriceMin.value,
        inputPriceMax.value,
      ),
    )
    result = result.filter((item) =>
      isWithinRange(
        getComparablePrice(item, 'outputPrice'),
        outputPriceMin.value,
        outputPriceMax.value,
      ),
    )

    if (sortField.value && sortOrder.value) {
      result.sort((left, right) => {
        if (sortField.value === 'model') {
          const leftModel = getRequestModelId(left) || left.model || ''
          const rightModel = getRequestModelId(right) || right.model || ''
          return sortOrder.value === 'asc'
            ? leftModel.localeCompare(rightModel)
            : rightModel.localeCompare(leftModel)
        }

        const currentSortField = sortField.value as Exclude<PricingSortField, '' | 'model'>

        return compareNullableNumbers(
          getComparablePrice(left, currentSortField),
          getComparablePrice(right, currentSortField),
          sortOrder.value,
        )
      })
    }

    return result
  })

  const getHighlightParts = (rawText?: string): HighlightPart[] => {
    const text = String(rawText || '')
    const keyword = filterModelKeyword.value.trim()
    const keywordLower = keyword.toLowerCase()
    const cacheKey = buildHighlightCacheKey(keywordLower, text)

    const cached = highlightPartsCache.get(cacheKey)
    if (cached) return cached

    if (!keyword || !text) {
      const fallback = [{ text, matched: false }]
      highlightPartsCache.set(cacheKey, fallback)
      return fallback
    }

    const sourceLower = text.toLowerCase()
    const parts: HighlightPart[] = []
    let cursor = 0

    while (cursor < text.length) {
      const index = sourceLower.indexOf(keywordLower, cursor)
      if (index === -1) {
        parts.push({ text: text.slice(cursor), matched: false })
        break
      }

      if (index > cursor) {
        parts.push({ text: text.slice(cursor, index), matched: false })
      }

      parts.push({ text: text.slice(index, index + keyword.length), matched: true })
      cursor = index + keyword.length
    }

    const resolvedParts = parts.length > 0 ? parts : [{ text, matched: false }]
    highlightPartsCache.set(cacheKey, resolvedParts)
    return resolvedParts
  }

  const loadPricing = async () => {
    loading.value = true
    try {
      pricingData.value = await modelPricingService.getModelPricing()
    } catch (error) {
      loadErrorMessage.value = resolveErrorMessage(error, i18ns.t('apiDoc.loadFailed'))
      ElMessage.error(loadErrorMessage.value)
      throw error
    } finally {
      loading.value = false
    }
  }

  const loadChannels = async () => {
    try {
      channels.value = await relayChannelService.listChannelOptions()
    } catch (error) {
      loadErrorMessage.value = resolveErrorMessage(error, i18ns.t('relay.loadFailed'))
      ElMessage.error(loadErrorMessage.value)
      throw error
    }
  }

  const refreshData = async () => {
    loadErrorMessage.value = ''
    try {
      await Promise.all([loadPricing(), loadChannels()])
    } catch {
      // Keep the current UI state and show the captured loadErrorMessage.
    }
  }

  const copyText = async (text: string) => {
    const copied = await copyTextWithFallback(text)
    if (copied) {
      ElMessage.success(i18ns.t('apiDoc.copied'))
      return
    }

    ElMessage.error(i18ns.t('message.error.copyFailed'))
  }

  const scaleRangeValue = (value: number | null, factor: number): number | null => {
    if (value == null) return null
    return value * factor
  }

  const toggleTokenPriceUnit = () => {
    const factor = tokenPriceUnit.value === 'M' ? 1 / 1000 : 1000

    tokenPriceUnit.value = tokenPriceUnit.value === 'M' ? 'K' : 'M'
    inputPriceMin.value = scaleRangeValue(inputPriceMin.value, factor)
    inputPriceMax.value = scaleRangeValue(inputPriceMax.value, factor)
    outputPriceMin.value = scaleRangeValue(outputPriceMin.value, factor)
    outputPriceMax.value = scaleRangeValue(outputPriceMax.value, factor)
  }

  const resetFilters = () => {
    filterFormat.value = ''
    filterChannelIds.value = []
    filterPricingType.value = ''
    filterModelKeyword.value = ''
    onlyModelsWithChannels.value = true
    channelMatchMode.value = 'match-any'
    channelPriceMode.value = 'selected-lowest'
    pricingTableMode.value = 'summary'
    primaryComparisonChannelId.value = ''
    customPriceMultiplier.value = null
    tokenPriceUnit.value = 'M'
    fixedPriceMin.value = null
    fixedPriceMax.value = null
    inputPriceMin.value = null
    inputPriceMax.value = null
    outputPriceMin.value = null
    outputPriceMax.value = null
    sortField.value = ''
    sortOrder.value = ''
  }

  watch(filterModelKeyword, () => {
    highlightPartsCache.clear()
  })

  watch(filterChannelIds, (ids) => {
    if (ids.length === 0 && channelPriceMode.value === 'selected-lowest') {
      channelPriceMode.value = 'base'
    }
  })

  watch(
    selectedChannels,
    (channelsForComparison) => {
      if (channelsForComparison.length === 0) {
        primaryComparisonChannelId.value = ''
        return
      }

      const currentChannelStillSelected = channelsForComparison.some(
        (channel) => channel.id === primaryComparisonChannelId.value,
      )

      if (!currentChannelStillSelected) {
        const firstChannel = channelsForComparison[0]
        primaryComparisonChannelId.value = firstChannel ? firstChannel.id : ''
      }
    },
    { immediate: true },
  )

  watch(sortField, (val) => {
    if (!val) sortOrder.value = ''
  })

  onBeforeUnmount(() => {
    highlightPartsCache.clear()
  })

  return {
    loading,
    loadErrorMessage,
    channels,
    selectedChannels,
    filterFormat,
    filterChannel,
    filterChannelIds,
    filterPricingType,
    filterModelKeyword,
    onlyModelsWithChannels,
    channelMatchMode,
    channelPriceMode,
    showLowestChannelPrice,
    pricingTableMode,
    primaryComparisonChannelId,
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
    primaryComparisonChannel,
    normalizeFormats,
    getRequestModelId,
    getChannelsForModel,
    getSelectedChannelsForModel,
    getLowestMultiplierForModel,
    getLowestSelectedMultiplierForModel,
    getDisplayedPriceMultiplier,
    getChannelPriceCell,
    getHighlightParts,
    toggleTokenPriceUnit,
    resetFilters,
    refreshData,
    copyText,
    loadPricing,
    loadChannels,
  }
}
