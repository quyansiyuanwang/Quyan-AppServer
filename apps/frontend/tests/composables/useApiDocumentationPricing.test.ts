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

  it('uses eligible automatic-pool member multipliers for price ranges and lowest pricing', async () => {
    const { composable, dispose } = createComposable()
    const row = createPricingRow({ inputPrice: 10, outputPrice: 20 })
    const capability = {
      catalogModelName: 'gpt-4o-mini',
      requestModelId: 'openai/gpt-4o-mini',
      supportedRequestFormats: ['openai'] as const,
    }

    composable.channels.value = [
      createChannel({
        id: 'automatic-pool',
        channelType: 'automatic-proxy-pool',
        multiplier: 99,
        automaticProxyPool: {
          routingStrategy: 'weighted-random',
          members: [
            {
              id: 'low-member',
              name: 'Low member',
              enabled: true,
              priority: 1,
              multiplier: 0.5,
              timePeriodMultiplier: 1,
              effectiveMultiplier: 0.5,
              allowedFormats: 'openai',
              modelCapabilities: [capability],
            },
            {
              id: 'high-member',
              name: 'High member',
              enabled: true,
              priority: 2,
              multiplier: 2,
              timePeriodMultiplier: 1,
              effectiveMultiplier: 2,
              allowedFormats: 'openai',
              modelCapabilities: [capability],
            },
            {
              id: 'disabled-member',
              name: 'Disabled member',
              enabled: false,
              priority: 3,
              multiplier: 0.1,
              timePeriodMultiplier: 1,
              effectiveMultiplier: 0.1,
              allowedFormats: 'openai',
              modelCapabilities: [capability],
            },
          ],
        },
      }),
    ]

    composable.channelPriceMode.value = 'global-lowest'

    const cell = composable.getChannelPriceCell(row, composable.channels.value[0]!)

    expect(composable.getDisplayedPriceMultiplier(row)).toBe(0.5)
    expect(cell).toMatchObject({
      available: true,
      automaticProxyPool: true,
      multiplier: 0.5,
      maximumMultiplier: 2,
      inputPrice: 5,
      maximumInputPrice: 20,
      outputPrice: 10,
      maximumOutputPrice: 40,
    })
    expect(cell.members.map((member) => member.id)).toEqual(['low-member', 'high-member'])

    dispose()
  })

  it('hides independent channels and automatic proxy pools independently', () => {
    const { composable, dispose } = createComposable()
    const poolCapability = {
      catalogModelName: 'pool-model',
      requestModelId: 'pool-model',
      supportedRequestFormats: ['openai'] as const,
    }

    composable.channels.value = [
      createChannel({
        id: 'independent-channel',
        modelCapabilities: [
          {
            catalogModelName: 'independent-model',
            requestModelId: 'independent-model',
            supportedRequestFormats: ['openai'],
          },
        ],
      }),
      createChannel({
        id: 'automatic-pool',
        channelType: 'automatic-proxy-pool',
        modelCapabilities: [poolCapability],
        automaticProxyPool: {
          routingStrategy: 'weighted-random',
          members: [
            {
              id: 'pool-member',
              name: 'Pool member',
              enabled: true,
              priority: 1,
              multiplier: 1,
              timePeriodMultiplier: 1,
              effectiveMultiplier: 1,
              allowedFormats: 'openai',
              modelCapabilities: [poolCapability],
            },
          ],
        },
      }),
    ]
    composable.filterChannelIds.value = ['independent-channel', 'automatic-pool']

    composable.hideIndependentChannels.value = true

    expect(composable.visibleChannels.value.map((channel) => channel.id)).toEqual(['automatic-pool'])
    expect(composable.selectedChannels.value.map((channel) => channel.id)).toEqual(['automatic-pool'])
    expect(
      composable.getChannelsForModel('independent-model', 'independent-model', 'openai'),
    ).toEqual([])
    expect(
      composable.getChannelsForModel('pool-model', 'pool-model', 'openai').map((channel) => channel.id),
    ).toEqual(['automatic-pool'])

    composable.hideAutomaticProxyPools.value = true

    expect(composable.visibleChannels.value).toEqual([])
    expect(composable.selectedChannels.value).toEqual([])
    expect(composable.filterChannelIds.value).toEqual([])

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