import { effectScope, type EffectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useApiDocumentationPricing,
  type PricingModelRow,
} from '@/composables/useApiDocumentationPricing'
import type { RelayCatalogOptionDto } from '@/client/types.gen'

const { getModelPricingMock, listCatalogOptionsMock } = vi.hoisted(() => ({
  getModelPricingMock: vi.fn<() => Promise<PricingModelRow[]>>(),
  listCatalogOptionsMock: vi.fn<() => Promise<RelayCatalogOptionDto[]>>(),
}))

vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessage: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/service/modelPricingService', () => ({
  modelPricingService: { getModelPricing: getModelPricingMock },
}))
vi.mock('@/service/relayChannelService', () => ({
  relayChannelService: { listCatalogOptions: listCatalogOptionsMock },
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

const createChannel = (overrides: Partial<RelayCatalogOptionDto> = {}): RelayCatalogOptionDto => ({
  id: 'channel-1',
  name: 'Test Channel',
  enabled: true,
  isAutomaticProxyPool: false,
  allowedFormats: 'openai',
  modelCapabilities: [
    {
      catalogModelName: 'gpt-4o-mini',
      requestModelId: 'openai/gpt-4o-mini',
      supportedRequestFormats: ['openai'],
    },
  ],
  pricingMode: 'fixed',
  multiplier: 1,
  pricingEffectiveAt: new Date().toISOString(),
  priceMayVary: false,
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
    listCatalogOptionsMock.mockResolvedValue([])
  })

  it('finds exact aliases without creating alias price rows and respects channel selection', async () => {
    const { composable, dispose } = createComposable()
    const row = createPricingRow()
    getModelPricingMock.mockResolvedValue([row])
    const mapped = createChannel({
      modelMappings: [
        {
          requestModelPattern: 'custom-alias',
          catalogModelName: row.model!,
          billingModelId: 'openai/gpt-4o-mini',
          supportedRequestFormats: ['openai-chat-completions'],
        },
      ],
    })
    listCatalogOptionsMock.mockResolvedValue([mapped, createChannel({ id: 'other' })])
    await composable.refreshData()
    composable.filterModelKeyword.value = 'CUSTOM-ALIAS'
    expect(composable.filteredPricingData.value).toEqual([row])
    expect(composable.getModelMappings(row, mapped)).toHaveLength(1)
    expect(composable.getChannelPriceCell(row, mapped).inputPrice).toBe(1)
    composable.filterChannelIds.value = ['other']
    expect(composable.filteredPricingData.value).toEqual([])
    composable.filterChannelIds.value = [mapped.id]
    expect(composable.filteredPricingData.value).toEqual([row])
    composable.filterModelKeyword.value = ''
    composable.filterChannelIds.value = ['other']
    expect(composable.getModelMappings(row, mapped)).toEqual([])
    composable.filterModelKeyword.value = row.model!
    expect(composable.getModelMappings(row, mapped)).toEqual([])
    dispose()
  })

  it('resolves concrete wildcard searches with exact and more specific exclusions', async () => {
    const { composable, dispose } = createComposable()
    const row = createPricingRow()
    const premium = createPricingRow({
      id: 'premium-price',
      model: 'premium',
      provider: 'premium-id',
      modelId: 'premium-id',
    })
    getModelPricingMock.mockResolvedValue([row, premium])
    listCatalogOptionsMock.mockResolvedValue([
      createChannel({
        modelCapabilities: [
          {
            catalogModelName: row.model!,
            requestModelId: row.modelId!,
            supportedRequestFormats: ['openai-chat-completions'],
          },
          {
            catalogModelName: premium.model!,
            requestModelId: premium.modelId!,
            supportedRequestFormats: ['openai-chat-completions'],
          },
        ],
        modelMappings: [
          {
            requestModelPattern: 'client-*',
            catalogModelName: row.model!,
            billingModelId: row.modelId!,
            supportedRequestFormats: ['openai-chat-completions'],
            excludedRequestModelPatterns: ['client-pro-*', 'client-missing'],
          },
          {
            requestModelPattern: 'client-pro-*',
            catalogModelName: premium.model!,
            billingModelId: premium.modelId!,
            supportedRequestFormats: ['openai-chat-completions'],
          },
        ],
      }),
    ])
    await composable.refreshData()
    composable.filterModelKeyword.value = 'client-basic'
    expect(composable.filteredPricingData.value).toEqual([row])
    composable.filterModelKeyword.value = 'client-pro-42'
    expect(composable.filteredPricingData.value).toEqual([premium])
    composable.filterModelKeyword.value = 'client-missing'
    expect(composable.filteredPricingData.value).toEqual([])
    composable.filterModelKeyword.value = 'client-'
    expect(composable.filteredPricingData.value).toHaveLength(2)
    dispose()
  })

  it('scopes alias searches and mapping details to the selected request format', async () => {
    const { composable, dispose } = createComposable()
    const row = createPricingRow({ supportedFormats: 'openai,anthropic' })
    const channel = createChannel({
      modelCapabilities: [
        {
          catalogModelName: row.model!,
          requestModelId: row.modelId!,
          supportedRequestFormats: ['openai-chat-completions', 'anthropic'],
        },
      ],
      modelMappings: [
        {
          requestModelPattern: 'chat-alias',
          catalogModelName: row.model!,
          billingModelId: row.modelId!,
          supportedRequestFormats: ['openai-chat-completions'],
        },
      ],
    })
    getModelPricingMock.mockResolvedValue([row])
    listCatalogOptionsMock.mockResolvedValue([channel])
    await composable.refreshData()
    composable.filterModelKeyword.value = 'chat-alias'
    composable.filterFormat.value = 'anthropic'
    expect(composable.filteredPricingData.value).toEqual([])
    expect(composable.getModelMappings(row, channel)).toEqual([])
    composable.filterFormat.value = 'openai'
    expect(composable.filteredPricingData.value).toEqual([row])
    dispose()
  })

  it('does not discover aliases from automatic pools until the pool view is enabled', async () => {
    const { composable, dispose } = createComposable()
    const row = createPricingRow()
    getModelPricingMock.mockResolvedValue([row])
    listCatalogOptionsMock.mockResolvedValue([
      createChannel({
        isAutomaticProxyPool: true,
        modelMappings: [
          {
            requestModelPattern: 'pool-alias',
            catalogModelName: row.model!,
            billingModelId: row.modelId!,
            supportedRequestFormats: ['openai-chat-completions'],
          },
        ],
      }),
    ])
    await composable.refreshData()
    composable.filterModelKeyword.value = 'pool-alias'
    expect(composable.filteredPricingData.value).toEqual([])
    composable.showAutomaticProxyPools.value = true
    expect(composable.filteredPricingData.value).toEqual([row])
    dispose()
  })

  it('loads the dedicated anonymous catalog endpoint', async () => {
    const { composable, dispose } = createComposable()
    const channel = createChannel()
    listCatalogOptionsMock.mockResolvedValue([channel])
    await composable.refreshData()
    expect(listCatalogOptionsMock).toHaveBeenCalledOnce()
    expect(composable.channels.value).toEqual([channel])
    dispose()
  })

  it('matches catalog capabilities by pricing model name rather than request id', () => {
    const { composable, dispose } = createComposable()
    composable.channels.value = [
      createChannel({
        modelCapabilities: [
          {
            catalogModelName: 'gpt-4o-mini',
            requestModelId: 'provider-id',
            supportedRequestFormats: ['openai'],
          },
        ],
      }),
    ]
    expect(composable.getChannelsForModel('gpt-4o-mini', 'openai')).toHaveLength(1)

    composable.channels.value = [
      createChannel({
        modelCapabilities: [
          {
            catalogModelName: 'gpt-4o-mini-different-price',
            requestModelId: 'openai/gpt-4o-mini',
            supportedRequestFormats: ['openai'],
          },
        ],
      }),
    ]
    expect(composable.getChannelsForModel('gpt-4o-mini', 'openai')).toHaveLength(0)
    dispose()
  })

  it('uses the catalog fixed multiplier and all context tiers', () => {
    const { composable, dispose } = createComposable()
    const row = createPricingRow({ inputPrice: 10, outputPrice: 20 })
    composable.channels.value = [
      createChannel({
        multiplier: 2,
        contextLengthMultipliers: [
          { name: '32K', enabled: true, minTokens: 32000, multiplier: 1.5 },
          { name: '128K', enabled: true, minTokens: 128000, multiplier: 3 },
        ],
      }),
    ]
    expect(composable.getChannelPriceCell(row, composable.channels.value[0]!)).toMatchObject({
      multiplier: 2,
      maximumMultiplier: 6,
      inputPrice: 20,
      maximumInputPrice: 60,
      outputPrice: 40,
      maximumOutputPrice: 120,
    })
    dispose()
  })

  it('uses a published logical channel price range without pool metadata', () => {
    const { composable, dispose } = createComposable()
    const row = createPricingRow({ inputPrice: 10, outputPrice: 20 })
    composable.channels.value = [
      createChannel({
        id: 'logical-route',
        name: 'GPT Route',
        pricingMode: 'range',
        multiplier: undefined,
        modelPriceRanges: [
          {
            catalogModelName: 'gpt-4o-mini',
            requestModelId: 'openai/gpt-4o-mini',
            minMultiplier: 1.2,
            maxMultiplier: 1.8,
          },
        ],
        priceMayVary: true,
      }),
    ]

    expect(composable.getChannelPriceCell(row, composable.channels.value[0]!)).toMatchObject({
      multiplier: 1.2,
      maximumMultiplier: 1.8,
      inputPrice: 12,
      maximumInputPrice: 18,
      outputPrice: 24,
      maximumOutputPrice: 36,
    })
    dispose()
  })

  it('hides variable-price automatic pools by default and allows opting in', () => {
    const { composable, dispose } = createComposable()
    expect('hidePooledChannels' in composable).toBe(false)
    expect('hideAutomaticProxyPools' in composable).toBe(false)
    const standalone = createChannel({ id: 'standalone' })
    const automaticPool = createChannel({
      id: 'automatic-pool',
      pricingMode: 'range',
      modelPriceRanges: [],
      multiplier: undefined,
      isAutomaticProxyPool: true,
      priceMayVary: true,
    })
    composable.channels.value = [standalone, automaticPool]
    expect(composable.showAutomaticProxyPools.value).toBe(false)
    expect(composable.visibleChannels.value.map((channel) => channel.id)).toEqual(['standalone'])

    composable.showAutomaticProxyPools.value = true
    expect(composable.visibleChannels.value.map((channel) => channel.id)).toEqual([
      'standalone',
      'automatic-pool',
    ])
    dispose()
  })
})
