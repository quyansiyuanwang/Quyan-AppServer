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

vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn(), success: vi.fn() } }))
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

  it('loads the dedicated anonymous catalog endpoint', async () => {
    const { composable, dispose } = createComposable()
    const channel = createChannel()
    listCatalogOptionsMock.mockResolvedValue([channel])
    await composable.refreshData()
    expect(listCatalogOptionsMock).toHaveBeenCalledOnce()
    expect(composable.channels.value).toEqual([channel])
    dispose()
  })

  it('matches catalog capabilities by model name and request id', () => {
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
    expect(composable.getChannelsForModel('gpt-4o-mini', 'other-id', 'openai')).toHaveLength(1)
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

  it('does not expose topology controls in the public catalog composable', () => {
    const { composable, dispose } = createComposable()
    expect('hidePooledChannels' in composable).toBe(false)
    expect('hideAutomaticProxyPools' in composable).toBe(false)
    dispose()
  })
})
