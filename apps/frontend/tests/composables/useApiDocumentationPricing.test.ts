import { effectScope, type EffectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApiDocumentationPricing, type PricingModelRow } from '@/composables/useApiDocumentationPricing'
import type { RelayChannelOptionDto } from '@/client/types.gen'

const { getModelPricingMock, listChannelsMock } = vi.hoisted(() => ({
  getModelPricingMock: vi.fn<() => Promise<PricingModelRow[]>>(),
  listChannelsMock: vi.fn<() => Promise<RelayChannelOptionDto[]>>(),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/service/modelPricingService', () => ({
  modelPricingService: {
    getModelPricing: getModelPricingMock,
  },
}))

vi.mock('@/service/relayChannelService', () => ({
  relayChannelService: {
    listChannelOptions: listChannelsMock,
  },
}))

const createComposable = () => {
  let scope: EffectScope | null = effectScope()
  let composable: ReturnType<typeof useApiDocumentationPricing> | null = null

  scope.run(() => {
    composable = useApiDocumentationPricing()
  })

  if (!composable) throw new Error('Failed to initialize pricing composable')

  return {
    composable,
    dispose: () => {
      scope?.stop()
      scope = null
    },
  }
}

const createChannel = (
  overrides: Partial<RelayChannelOptionDto> = {},
): RelayChannelOptionDto =>
  ({
    id: 'channel-1',
    name: 'Test Channel',
    enabled: true,
    multiplier: 1,
    allowedFormats: 'openai',
    modelCapabilities: [
      {
        catalogModelName: 'gpt-4o-mini',
        requestModelId: 'openai/gpt-4o-mini',
        supportedRequestFormats: ['openai'],
      },
    ],
    ...overrides,
  })

const createPricingRow = (overrides: Partial<PricingModelRow> = {}): PricingModelRow =>
  ({
    id: 'pricing-1',
    model: 'gpt-4o-mini',
    modelId: 'openai/gpt-4o-mini',
    provider: 'openai/gpt-4o-mini',
    pricingType: 'token-based',
    supportedFormats: 'openai',
    inputPrice: 1,
    outputPrice: 2,
    fixedPrice: null,
    status: 1,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    ...overrides,
  }) as PricingModelRow

describe('useApiDocumentationPricing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getModelPricingMock.mockResolvedValue([])
    listChannelsMock.mockResolvedValue([])
  })

  it('matches channel allowedModels by model name instead of model id', () => {
    const { composable, dispose } = createComposable()

    composable.channels.value = [
      createChannel({
        modelCapabilities: [
          {
            catalogModelName: 'gpt-4o-mini',
            requestModelId: 'provider-specific-id',
            supportedRequestFormats: ['openai'],
          },
        ],
      }),
    ]

    const channels = composable.getChannelsForModel('gpt-4o-mini', 'openai/gpt-4o-mini', 'openai')

    expect(channels).toHaveLength(1)

    dispose()
  })

  it('keeps filtered pricing rows when channel restriction stores model names', async () => {
    const { composable, dispose } = createComposable()

    getModelPricingMock.mockResolvedValue([
      createPricingRow({
        model: 'gpt-4o-mini',
        modelId: 'provider-specific-id',
      }),
    ])
    listChannelsMock.mockResolvedValue([
      createChannel({
        id: 'channel-match',
        modelCapabilities: [
          {
            catalogModelName: 'gpt-4o-mini',
            requestModelId: 'provider-specific-id',
            supportedRequestFormats: ['openai'],
          },
        ],
      }),
    ])

    await composable.refreshData()

    composable.filterChannel.value = 'channel-match'

    expect(composable.filteredPricingData.value).toHaveLength(1)
    expect(composable.filteredPricingData.value[0]?.model).toBe('gpt-4o-mini')

    dispose()
  })

  it('uses resolver-provided inferred models for pooled channels without direct upstream urls', () => {
    const { composable, dispose } = createComposable()

    composable.channels.value = [
      createChannel({
        id: 'pooled-channel',
        modelCapabilities: [
          {
            catalogModelName: 'gpt-4o-mini',
            requestModelId: 'openai/gpt-4o-mini',
            supportedRequestFormats: ['openai'],
          },
        ],
      }),
    ]

    const channels = composable.getChannelsForModel('gpt-4o-mini', 'openai/gpt-4o-mini', 'openai')

    expect(channels.map((channel) => channel.id)).toEqual(['pooled-channel'])

    dispose()
  })

  it('does not expose all models when a pooled channel has no inferred availability', () => {
    const { composable, dispose } = createComposable()

    composable.channels.value = [
      createChannel({
        id: 'pooled-channel',
        modelCapabilities: [],
      }),
    ]

    expect(
      composable.getChannelsForModel('gpt-4o-mini', 'openai/gpt-4o-mini', 'openai'),
    ).toEqual([])

    dispose()
  })

  it('uses lowest channel multiplier when enabled for range filtering', async () => {
    const { composable, dispose } = createComposable()

    getModelPricingMock.mockResolvedValue([
      createPricingRow({ model: 'gpt-4o-mini', modelId: 'openai/gpt-4o-mini', inputPrice: 10 }),
    ])
    listChannelsMock.mockResolvedValue([
      createChannel({ id: 'high', multiplier: 2 }),
      createChannel({ id: 'low', multiplier: 0.5 }),
    ])

    await composable.refreshData()

    composable.showLowestChannelPrice.value = true
    composable.inputPriceMax.value = 6

    expect(composable.filteredPricingData.value).toHaveLength(1)
    expect(composable.getDisplayedPriceMultiplier(composable.filteredPricingData.value[0]!)).toBe(0.5)

    dispose()
  })

  it('sorts by displayed input price descending', async () => {
    const { composable, dispose } = createComposable()

    getModelPricingMock.mockResolvedValue([
      createPricingRow({ model: 'cheap', modelId: 'cheap', inputPrice: 1 }),
      createPricingRow({ model: 'expensive', modelId: 'expensive', inputPrice: 5 }),
    ])

    await composable.refreshData()

    composable.onlyModelsWithChannels.value = false
    composable.sortField.value = 'inputPrice'
    composable.sortOrder.value = 'desc'

    expect(composable.filteredPricingData.value.map((item) => item.modelId)).toEqual([
      'expensive',
      'cheap',
    ])

    dispose()
  })
})