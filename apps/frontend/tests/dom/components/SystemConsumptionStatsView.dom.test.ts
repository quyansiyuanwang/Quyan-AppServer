// @vitest-environment jsdom
import { computed, defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getConsumptionStatsMock,
  warningMock,
  errorMock,
} = vi.hoisted(() => ({
  getConsumptionStatsMock: vi.fn(),
  warningMock: vi.fn(),
  errorMock: vi.fn(),
}))

vi.mock('@/service/systemService', () => ({
  default: {
    getConsumptionStats: getConsumptionStatsMock,
  },
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: computed(() => true),
    isMobile: computed(() => false),
  }),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    warning: warningMock,
    error: errorMock,
  },
}))

vi.mock('@/utils/asyncChart', () => ({
  AsyncVChart: defineComponent({
    name: 'AsyncVChart',
    props: { option: { type: Object, default: () => ({}) } },
    setup() {
      return () => h('div', { class: 'async-chart-stub' })
    },
  }),
}))

import SystemConsumptionStatsView from '@/views/system/SystemConsumptionStatsView.vue'

const ElCardStub = defineComponent({
  name: 'ElCard',
  setup(_props, { slots }) {
    return () => h('div', { class: 'el-card-stub' }, [slots.header?.(), slots.default?.()])
  },
})

const ElRowStub = defineComponent({
  name: 'ElRow',
  setup(_props, { slots }) {
    return () => h('div', { class: 'el-row-stub' }, slots.default?.())
  },
})

const ElColStub = defineComponent({
  name: 'ElCol',
  setup(_props, { slots }) {
    return () => h('div', { class: 'el-col-stub' }, slots.default?.())
  },
})

const ElTagStub = defineComponent({
  name: 'ElTag',
  setup(_props, { slots }) {
    return () => h('span', { class: 'el-tag-stub' }, slots.default?.())
  },
})

const ElButtonStub = defineComponent({
  name: 'ElButton',
  emits: ['click'],
  setup(_props, { emit, slots }) {
    return () => h('button', { class: 'el-button-stub', onClick: () => emit('click') }, slots.default?.())
  },
})

const ElInputStub = defineComponent({
  name: 'ElInput',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'keyup'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        class: 'el-input-stub',
        value: props.modelValue,
        onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value),
        onKeyup: (event: KeyboardEvent) => emit('keyup', event),
      })
  },
})

const ElDatePickerStub = defineComponent({
  name: 'ElDatePicker',
  props: { modelValue: { type: Array, default: () => [] } },
  emits: ['update:modelValue', 'change'],
  setup() {
    return () => h('div', { class: 'el-date-picker-stub' })
  },
})

const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: {
    label: { type: String, default: '' },
    value: { type: String, default: '' },
  },
  setup(props) {
    return () => h('option', { value: props.value }, props.label)
  },
})

const ElSelectStub = defineComponent({
  name: 'ElSelect',
  props: {
    modelValue: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue'],
  setup(props, { emit, slots }) {
    return () =>
      h(
        'select',
        {
          class: 'el-select-stub',
          multiple: true,
          value: props.modelValue,
          onChange: (event: Event) => {
            const target = event.target as HTMLSelectElement
            const selected = Array.from(target.selectedOptions).map((item) => item.value)
            emit('update:modelValue', selected)
          },
        },
        slots.default?.(),
      )
  },
})

const FilterTableSelectStub = defineComponent({
  name: 'FilterTableSelect',
  props: {
    modelValue: { type: Array, default: () => [] },
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: '' },
    searchPlaceholder: { type: String, default: '' },
    columnLabel: { type: String, default: '' },
    popoverWidth: { type: Number, default: 400 },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('div', { class: 'filter-table-select-stub' }, [
        h('span', { class: 'count' }, `${props.modelValue.length}`),
        h('input', {
          onChange: (e: Event) => {
            const target = e.target as HTMLInputElement
            emit('update:modelValue', target.value.split(','))
          },
        }),
      ])
  },
})

const ElTableStub = defineComponent({
  name: 'ElTable',
  setup(_props, { slots }) {
    return () => h('div', { class: 'el-table-stub' }, slots.default?.())
  },
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  setup() {
    return () => h('div', { class: 'el-table-column-stub' })
  },
})

const ElCollapseStub = defineComponent({
  name: 'ElCollapse',
  setup(_props, { slots }) {
    return () => h('div', { class: 'el-collapse-stub' }, slots.default?.())
  },
})

const ElCollapseItemStub = defineComponent({
  name: 'ElCollapseItem',
  setup(_props, { slots }) {
    return () => h('div', { class: 'el-collapse-item-stub' }, slots.default?.())
  },
})

const baseStatsResponse = {
  range: {
    startDate: '2026-04-01T00:00:00.000Z',
    endDate: '2026-04-07T23:59:59.999Z',
    days: 7,
  },
  filterOptions: {
    users: [
      { key: 'user-1', label: 'Alice' },
      { key: 'user-2', label: 'Bob' },
    ],
    models: [
      { key: 'gpt-4o', label: 'gpt-4o' },
      { key: 'claude-3.5-sonnet', label: 'claude-3.5-sonnet' },
    ],
    channels: [
      { key: 'OpenAI', label: 'OpenAI' },
      { key: 'Anthropic', label: 'Anthropic' },
    ],
    relayTokens: [
      { key: 'rt-1', label: 'Token A' },
      { key: 'rt-2', label: 'Token B' },
    ],
  },
  summary: {
    totalSpend: 3,
    chargedSpend: 2,
    coveredSpend: 1,
    totalRequests: 2,
    zeroChargeRequests: 0,
    totalTokens: 200,
    inputTokens: 120,
    outputTokens: 80,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    activeUsers: 2,
    consumingUsers: 2,
    avgSpendPerRequest: 1.5,
    avgTokensPerRequest: 100,
  },
  daily: [],
  byUser: [{ key: 'user-1', label: 'Alice', totalSpend: 3, chargedSpend: 2, coveredSpend: 1, totalRequests: 2, zeroChargeRequests: 0, totalTokens: 200, inputTokens: 120, outputTokens: 80, cacheCreationTokens: 0, cacheReadTokens: 0, activeUsers: 1, consumingUsers: 1, avgSpendPerRequest: 1.5, avgTokensPerRequest: 100, share: 100 }],
  byChannel: [],
  byModel: [],
  userDailyDistribution: [],
  channelDailyDistribution: [],
  modelDailyDistribution: [],
  generatedAt: '2026-04-07T23:59:59.999Z',
}

const mountView = () =>
  mount(SystemConsumptionStatsView, {
    global: {
      directives: { loading: {} },
      stubs: {
        'el-card': ElCardStub,
        'el-row': ElRowStub,
        'el-col': ElColStub,
        'el-tag': ElTagStub,
        'el-button': ElButtonStub,
        'el-input': ElInputStub,
        'el-date-picker': ElDatePickerStub,
        'el-option': ElOptionStub,
        'el-select': ElSelectStub,
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
        'el-collapse': ElCollapseStub,
        'el-collapse-item': ElCollapseItemStub,
        FilterTableSelect: FilterTableSelectStub,
      },
    },
  })

describe('SystemConsumptionStatsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getConsumptionStatsMock.mockResolvedValue(structuredClone(baseStatsResponse))
  })

  it('loads stats on mount and sends current filters on refresh', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(getConsumptionStatsMock).toHaveBeenCalledTimes(1)
    expect(getConsumptionStatsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userIds: [],
        models: [],
        channels: [],
        relayTokenIds: [],
      }),
      true,
    )

    const vm = wrapper.vm as any
    vm.filterSelections.userIds = ['user-1']
    vm.filterSelections.models = ['gpt-4o']
    await vm.loadStats()

    expect(getConsumptionStatsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userIds: ['user-1'],
        models: ['gpt-4o'],
        channels: [],
        relayTokenIds: [],
      }),
      true,
    )
  })

  it('supports select all, invert, clear, and regex selection for users', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.selectAllFilter('userIds', baseStatsResponse.filterOptions.users)
    expect(vm.filterSelections.userIds).toEqual(['user-1', 'user-2'])

    vm.invertFilterSelection('userIds', baseStatsResponse.filterOptions.users)
    expect(vm.filterSelections.userIds).toEqual([])

    vm.userRegex = 'Alice'
    vm.applyUserRegexSelection()
    expect(vm.filterSelections.userIds).toEqual(['user-1'])

    vm.clearFilterSelection('userIds')
    expect(vm.filterSelections.userIds).toEqual([])
  })

  it('warns on invalid or unmatched user regex', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.userRegex = '['
    vm.applyUserRegexSelection()
    expect(warningMock).toHaveBeenCalledTimes(1)

    vm.userRegex = 'NotFoundUser'
    vm.applyUserRegexSelection()
    expect(warningMock).toHaveBeenCalledTimes(2)
  })

  it('prunes invalid selections from returned filter options and refetches once', async () => {
    getConsumptionStatsMock
      .mockResolvedValueOnce({
        ...structuredClone(baseStatsResponse),
        filterOptions: {
          ...structuredClone(baseStatsResponse.filterOptions),
          users: [{ key: 'user-1', label: 'Alice' }],
        },
      })
      .mockResolvedValueOnce({
        ...structuredClone(baseStatsResponse),
        filterOptions: {
          ...structuredClone(baseStatsResponse.filterOptions),
          users: [{ key: 'user-1', label: 'Alice' }],
        },
      })

    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.filterSelections.userIds = ['user-1', 'user-2']
    await vm.loadStats()
    await flushPromises()

    expect(vm.filterSelections.userIds).toEqual(['user-1'])
    expect(getConsumptionStatsMock).toHaveBeenCalledTimes(3)
    expect(getConsumptionStatsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ userIds: ['user-1'] }),
      true,
    )
  })

  it('resets filters and reports load errors', async () => {
    const wrapper = mountView()
    await flushPromises()
    const vm = wrapper.vm as any

    vm.filterSelections.userIds = ['user-1']
    vm.filterSelections.models = ['gpt-4o']
    vm.userRegex = 'Alice'
    await vm.resetAllFilters()

    expect(vm.filterSelections.userIds).toEqual([])
    expect(vm.filterSelections.models).toEqual([])
    expect(vm.userRegex).toBe('')

    getConsumptionStatsMock.mockRejectedValueOnce(new Error('network failed'))
    await vm.loadStats()
    await flushPromises()

    expect(errorMock).toHaveBeenCalledWith('network failed')
  })

  it('falls back safely when filterOptions is missing', async () => {
    const { filterOptions: _filterOptions, ...responseWithoutFilterOptions } = structuredClone(baseStatsResponse)
    getConsumptionStatsMock.mockResolvedValueOnce(responseWithoutFilterOptions)

    const wrapper = mountView()
    await flushPromises()

    const vm = wrapper.vm as any
    expect(vm.stats.filterOptions).toEqual({
      users: [],
      models: [],
      channels: [],
      relayTokens: [],
    })
    expect(errorMock).not.toHaveBeenCalled()
  })

  it('handles empty filter option groups from the server', async () => {
    getConsumptionStatsMock.mockResolvedValueOnce({
      ...structuredClone(baseStatsResponse),
      filterOptions: {
        users: [],
        models: [],
        channels: [],
        relayTokens: [],
      },
    })

    const wrapper = mountView()
    await flushPromises()

    const vm = wrapper.vm as any
    vm.selectAllFilter('userIds', vm.stats.filterOptions.users)
    vm.invertFilterSelection('relayTokenIds', vm.stats.filterOptions.relayTokens)

    expect(vm.stats.filterOptions.users).toEqual([])
    expect(vm.filterSelections.userIds).toEqual([])
    expect(vm.filterSelections.relayTokenIds).toEqual([])
    expect(errorMock).not.toHaveBeenCalled()
  })
})