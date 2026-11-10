// @vitest-environment jsdom
import { defineComponent, h, inject, provide } from 'vue'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChannelModelMappings from '@/components/relay/ChannelModelMappings.vue'
import ModelPricingTable from '@/components/relay/ModelPricingTable.vue'
import type { RelayCatalogModelMappingDto, RelayCatalogOptionDto } from '@/client/types.gen'
import type { ChannelPriceCell, PricingModelRow } from '@/composables/useApiDocumentationPricing'
import { i18ns } from '@/locales'

enableAutoUnmount(afterEach)

const exactMapping: RelayCatalogModelMappingDto = {
  requestModelPattern: 'friendly-model',
  catalogModelName: 'Catalog Model',
  billingModelId: 'billing-model-id',
  supportedRequestFormats: ['openai-chat-completions', 'anthropic'],
}
const wildcardMapping: RelayCatalogModelMappingDto = {
  ...exactMapping,
  requestModelPattern: 'friendly-*',
  excludedRequestModelPatterns: ['friendly-disabled', 'friendly-premium-*'],
}

const realPopover = {
  transition: false,
  ElPopover: false,
  'el-popover': false,
  ElTooltip: false,
  'el-tooltip': false,
}
const getDetails = () => document.body.querySelector<HTMLElement>('.model-mappings-details')
const waitForDetails = async () => {
  await vi.waitFor(() => expect(getDetails()).not.toBeNull())
  return getDetails()!
}

describe('ChannelModelMappings', () => {
  it('opens details on click, highlights aliases and toggles closed', async () => {
    const wrapper = mount(ChannelModelMappings, {
      props: {
        mappings: [exactMapping, wildcardMapping],
        channelName: 'Public channel',
        onCopy: vi.fn(),
        getHighlightParts: (text = '') => [
          { text: text.slice(0, 8), matched: true },
          { text: text.slice(8), matched: false },
        ],
      },
      attachTo: document.body,
      global: { stubs: realPopover },
    })

    const marker = wrapper.get('button')
    expect(marker.text()).toBe(`${i18ns.t('relay.catalogMappingMarker')} (2)`)
    expect(getDetails()).toBeNull()
    await marker.trigger('mouseenter')
    expect(getDetails()).toBeNull()
    await marker.trigger('click')
    const details = await waitForDetails()
    expect(marker.attributes('aria-expanded')).toBe('true')
    expect(details.textContent).toContain('Public channel')
    expect(details.textContent).toContain('friendly-model')
    expect(details.textContent).toContain('→')
    expect(details.textContent).toContain('Catalog Model')
    expect(details.textContent).toContain('billing-model-id')
    expect(details.textContent).toContain('openai-chat-completions, anthropic')
    expect(details.textContent).toContain(i18ns.t('relay.catalogMappingBillingHint'))
    expect(details.textContent).toContain(i18ns.t('relay.catalogMappingTokenHint'))
    expect(details.querySelector('mark')?.textContent).toBe('friendly')
    expect(details.querySelector('.model-mapping-exclusions')?.textContent).toContain(
      `${i18ns.t('relay.catalogMappingExclusions')}:`,
    )
    expect(details.querySelector('.model-mapping-exclusions')?.textContent).toContain(
      'friendly-disabled, friendly-premium-*',
    )

    await marker.trigger('click')
    await vi.waitFor(() => expect(marker.attributes('aria-expanded')).toBe('false'))
    await vi.waitFor(() => expect(getDetails()).toBeNull())
  })

  it('copies the exact request source, preserving the open details', async () => {
    const onCopy = vi.fn()
    const wrapper = mount(ChannelModelMappings, {
      props: { mappings: [exactMapping], onCopy },
      attachTo: document.body,
      global: { stubs: realPopover },
    })
    await wrapper.get('button').trigger('click')
    const details = await waitForDetails()
    const copy = details.querySelector<HTMLButtonElement>('.model-mapping-copy')!
    expect(copy.getAttribute('aria-label')).toContain('friendly-model')
    copy.click()
    expect(onCopy).toHaveBeenCalledExactlyOnceWith('friendly-model')
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
  })

  it.each(['friendly-*', 'friendly-?'])(
    'labels %s as a pattern without a copy action',
    async (pattern) => {
      const onCopy = vi.fn()
      const wrapper = mount(ChannelModelMappings, {
        props: { mappings: [{ ...wildcardMapping, requestModelPattern: pattern }], onCopy },
        attachTo: document.body,
        global: { stubs: realPopover },
      })
      await wrapper.get('button').trigger('click')
      const details = await waitForDetails()
      expect(details.textContent).toContain(i18ns.t('relay.catalogMappingPatternHint'))
      expect(details.querySelector('button')).toBeNull()
      expect(onCopy).not.toHaveBeenCalled()
    },
  )

  it('renders nothing when mappings are empty', () => {
    const wrapper = mount(ChannelModelMappings, {
      props: { mappings: [], onCopy: vi.fn() },
      global: { stubs: realPopover },
    })
    expect(wrapper.find('button').exists()).toBe(false)
    expect(getDetails()).toBeNull()
  })

  it('escapes a clipping container and constrains the popover to the viewport', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'overflow: hidden; width: 180px; height: 24px'
    document.body.append(host)
    const wrapper = mount(ChannelModelMappings, {
      props: { mappings: [wildcardMapping], onCopy: vi.fn() },
      attachTo: host,
      global: { stubs: realPopover },
    })
    try {
      await wrapper.get('button').trigger('click')
      const details = await waitForDetails()
      expect(host.contains(details)).toBe(false)
      const popover = details.closest<HTMLElement>('.el-popover')!
      expect(document.body.contains(popover)).toBe(true)
      expect(popover.style.width).toBe('440px')
      expect(popover.style.maxWidth).toBe('calc(100vw - 32px)')
      expect(popover.style.maxHeight).toBe('calc(100dvh - 32px)')
      expect(popover.style.overflowY).toBe('auto')
    } finally {
      wrapper.unmount()
      host.remove()
    }
  })
})

const row: PricingModelRow = {
  model: 'Catalog Model',
  modelId: 'billing-model-id',
  inputPrice: 1,
  outputPrice: 2,
  supportedFormats: 'openai-chat-completions,anthropic',
}
const channel: RelayCatalogOptionDto = {
  id: 'channel-1',
  name: 'Public channel',
  enabled: true,
  isAutomaticProxyPool: false,
  allowedFormats: 'openai-chat-completions,anthropic',
  modelCapabilities: [],
  modelMappings: [exactMapping, wildcardMapping],
  pricingMode: 'fixed',
  multiplier: 1,
  pricingEffectiveAt: '2026-11-11T00:00:00Z',
  priceMayVary: false,
}
const cell: ChannelPriceCell = {
  available: true,
  channelId: channel.id,
  channelName: channel.name,
  multiplier: 1,
  maximumMultiplier: null,
  fixedPrice: null,
  maximumFixedPrice: null,
  inputPrice: 1,
  maximumInputPrice: null,
  outputPrice: 2,
  maximumOutputPrice: null,
  cacheCreationMultiplier: null,
  cacheReadMultiplier: null,
}
const tableRowsKey = Symbol('pricing table rows')
const tableStub = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    provide(tableRowsKey, () => props.data as PricingModelRow[])
    return () => h('div', slots.default?.())
  },
})
const columnStub = defineComponent({
  setup(_props, { slots }) {
    const rows = inject<() => PricingModelRow[]>(tableRowsKey)!
    return () =>
      h(
        'div',
        rows().map((item) => slots.default?.({ row: item })),
      )
  },
})
const tooltipStub = defineComponent({
  setup(_props, { slots }) {
    return () => h('div', { class: 'price-tooltip-trigger' }, slots.default?.())
  },
})
const mountTable = (
  pricingTableMode: 'summary' | 'channel-columns',
  isDesktop: boolean,
  overrides: Partial<InstanceType<typeof ModelPricingTable>['$props']> = {},
) =>
  mount(ModelPricingTable, {
    props: {
      rows: [row],
      loading: false,
      pricingTableMode,
      isDesktop,
      normalizeFormats: (formats) => formats?.split(',') ?? [],
      getRequestModelId: (item) => item.modelId || item.model,
      getHighlightParts: (text = '') => [{ text, matched: false }],
      getChannelsForModel: () => [channel],
      getDisplayedPriceMultiplier: () => 1,
      getChannelPriceCell: () => cell,
      selectedChannels: [channel],
      priceRanges: {
        fixedPrice: { min: null, max: null },
        inputPrice: { min: null, max: null },
        outputPrice: { min: null, max: null },
      },
      onCopyModelId: vi.fn(),
      ...overrides,
    },
    global: {
      stubs: {
        'el-table': tableStub,
        'el-table-column': columnStub,
        'el-tooltip': tooltipStub,
      },
    },
  })

describe('ModelPricingTable mapping integration', () => {
  it.each([
    ['summary', true],
    ['summary', false],
    ['channel-columns', true],
    ['channel-columns', false],
  ] as const)('uses filtered mappings in %s mode, desktop=%s', (mode, desktop) => {
    const getModelMappings = vi.fn(() => [exactMapping])
    const onCopyModelId = vi.fn()
    const wrapper = mountTable(mode, desktop, { getModelMappings, onCopyModelId })
    const mappings = wrapper.getComponent(ChannelModelMappings)
    expect(getModelMappings).toHaveBeenCalledWith(row, channel)
    expect(mappings.props('mappings')).toEqual([exactMapping])
    expect(mappings.props('channelName')).toBe(channel.name)
    mappings.props('onCopy')(exactMapping.requestModelPattern)
    expect(onCopyModelId).toHaveBeenCalledExactlyOnceWith('friendly-model')
    expect(mappings.element.closest('.price-tooltip-trigger')).toBeNull()
  })

  it('falls back to the catalog helper when the optional callback is absent', () => {
    const wrapper = mountTable('summary', true)
    expect(wrapper.getComponent(ChannelModelMappings).props('mappings')).toEqual([
      exactMapping,
      wildcardMapping,
    ])
  })

  it('preserves an empty filtered result instead of falling back to unfiltered mappings', () => {
    const wrapper = mountTable('summary', true, { getModelMappings: () => [] })
    expect(wrapper.getComponent(ChannelModelMappings).props('mappings')).toEqual([])
    expect(wrapper.find('.model-mappings-marker').exists()).toBe(false)
  })

  it.each([true, false])(
    'omits mappings for unavailable comparison cells, desktop=%s',
    (desktop) => {
      const wrapper = mountTable('channel-columns', desktop, {
        getChannelPriceCell: () => ({ ...cell, available: false }),
      })
      expect(wrapper.findComponent(ChannelModelMappings).exists()).toBe(false)
    },
  )
})
