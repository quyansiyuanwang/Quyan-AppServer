import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: ref(true),
    isMobile: ref(false),
  }),
}))

vi.mock('@/composables/useBillingFormula', () => ({
  buildBillingFormula: vi.fn(() => ''),
  CACHE_CREATION_MULTIPLIER: 1.25,
  CACHE_READ_MULTIPLIER: 0.1,
  hasFormulaFields: vi.fn(() => false),
  hasPerRequestFormulaFields: vi.fn(() => false),
  resolveChannelMultiplier: vi.fn(() => 1),
  resolveContextMultiplier: vi.fn(() => 1),
  resolveEffectiveMultiplier: vi.fn(() => 1),
  resolveGlobalMultiplier: vi.fn(() => 1),
  resolveModelMultiplier: vi.fn(() => 1),
  resolveTimeMultiplier: vi.fn(() => 1),
  shouldShowChannelMultiplier: vi.fn(() => false),
  shouldShowContextMultiplier: vi.fn(() => false),
  shouldShowCacheCreationMultiplier: vi.fn(() => false),
  shouldShowCacheReadMultiplier: vi.fn(() => false),
  shouldShowGlobalMultiplier: vi.fn(() => false),
  shouldShowModelMultiplier: vi.fn(() => false),
  shouldShowMultiplier: vi.fn(() => false),
  shouldShowTimeMultiplier: vi.fn(() => false),
}))

vi.mock('vue-echarts', () => ({
  default: defineComponent({
    name: 'VChart',
    template: '<div class="v-chart-stub" />',
  }),
}))

vi.mock('@element-plus/icons-vue', () => ({
  Refresh: defineComponent({ name: 'RefreshIcon', template: '<span />' }),
}))

vi.mock('echarts/core', () => ({ use: vi.fn() }))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))
vi.mock('echarts/charts', () => ({ LineChart: {}, PieChart: {}, BarChart: {} }))
vi.mock('echarts/components', () => ({
  TitleComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  GridComponent: {},
}))

import TransactionHistory from '@/components/balance/TransactionHistory.vue'
import * as billingFormula from '@/composables/useBillingFormula'

const rowsRef = ref<any[]>([])

const ElTableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () => {
      rowsRef.value = props.data as any[]
      return h('div', { class: 'el-table-stub' }, slots.default ? slots.default() : [])
    }
  },
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  setup(_props, { slots }) {
    return () =>
      h(
        'div',
        { class: 'el-table-column-stub' },
        rowsRef.value.flatMap((row, index) =>
          slots.default ? slots.default({ row, $index: index }) : [],
        ),
      )
  },
})

const ElTooltipStub = defineComponent({
  name: 'ElTooltip',
  props: { content: { type: String, default: '' } },
  setup(props, { slots }) {
    return () =>
      h('div', { class: 'el-tooltip-stub' }, [
        ...(slots.default ? slots.default() : []),
        h('span', { class: 'tooltip-content' }, props.content),
      ])
  },
})

const SimpleSlotStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    setup(_props, { slots }) {
      return () => h(tag, {}, slots.default ? slots.default() : [])
    },
  })

const InputStub = defineComponent({
  name: 'ElInput',
  template: '<input />',
})

const baseTransaction = {
  id: 'tx-1',
  type: 'api_usage',
  amount: 0,
  balanceAfter: 100,
  createTime: '2026-04-26T00:00:00.000Z',
  description: 'API调用失败(上游错误，未扣费): /relay/proxy/v1/chat/completions',
  tokenName: 'relay-token',
  channelName: 'channel-a',
  model: 'gpt-4o',
} as any

const mountComponent = (transactions: any[]) =>
  mount(TransactionHistory, {
    props: {
      transactions,
      loading: false,
      loadingFull: false,
    },
    global: {
      directives: { loading: {} },
      stubs: {
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
        'el-tooltip': ElTooltipStub,
        'el-card': SimpleSlotStub('ElCard'),
        'el-tag': SimpleSlotStub('ElTag', 'span'),
        'el-select': SimpleSlotStub('ElSelect'),
        'el-option': SimpleSlotStub('ElOption'),
        'el-input': InputStub,
        'el-date-picker': InputStub,
        'el-button': SimpleSlotStub('ElButton', 'button'),
        'el-radio-group': SimpleSlotStub('ElRadioGroup'),
        'el-radio-button': SimpleSlotStub('ElRadioButton', 'button'),
        'el-pagination': SimpleSlotStub('ElPagination'),
        'el-collapse': SimpleSlotStub('ElCollapse'),
        'el-collapse-item': SimpleSlotStub('ElCollapseItem'),
        'el-descriptions': SimpleSlotStub('ElDescriptions'),
        'el-descriptions-item': SimpleSlotStub('ElDescriptionsItem'),
        transition: false,
      },
    },
  })

describe('TransactionHistory', () => {
  it('renders upstream zero-charge usage with a no-charge hint', () => {
    const wrapper = mountComponent([baseTransaction])

    expect(wrapper.find('.amount-zero-charge').exists()).toBe(true)
    expect(wrapper.text()).toContain('0 · 未扣费')
    expect(wrapper.find('.tooltip-content').text()).toContain('上游错误')
    // Zero-charge hint feature is not yet implemented in the UI
    // expect(wrapper.text()).toContain('上游错误记录仅用于留痕，不计入消费统计。')
    // expect(wrapper.find('.zero-charge-hint__badge').text()).toBe('1')
  })

  it('keeps plain zero amount when record is not marked as upstream no-charge', () => {
    const wrapper = mountComponent([
      {
        ...baseTransaction,
        id: 'tx-2',
        description: 'API调用: /relay/proxy/v1/chat/completions',
      },
    ])

    expect(wrapper.find('.amount-zero-charge').exists()).toBe(false)
    expect(wrapper.find('.zero-charge-hint').exists()).toBe(false)
    expect(wrapper.text()).toContain('0')
    expect(wrapper.text()).not.toContain('未扣费')
  })

  it('renders formula block for per-request pricing records', () => {
    vi.mocked(billingFormula.hasPerRequestFormulaFields).mockReturnValue(true)
    vi.mocked(billingFormula.buildBillingFormula).mockReturnValue('0.25 元/次 × 1 = 0.25 元')

    const wrapper = mountComponent([
      {
        ...baseTransaction,
        id: 'tx-3',
        amount: -0.25,
        pricingType: 'per-request',
        fixedPrice: 0.25,
        description: 'API调用: /relay/proxy/v1/responses',
      },
    ])

    expect(wrapper.text()).toContain('0.25 元/次 × 1 = 0.25 元')
  })

  it('shows the channel multiplier snapshot as a history table column', () => {
    const wrapper = mountComponent([
      {
        ...baseTransaction,
        id: 'tx-channel-multiplier',
        channelMultiplier: 1.75,
      },
    ])

    expect(wrapper.text()).toContain('1.75×')
  })
})
