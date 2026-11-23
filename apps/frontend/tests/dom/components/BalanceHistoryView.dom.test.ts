// @vitest-environment jsdom
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/balance/AlipayOrdersPanel.vue', () => ({
  default: defineComponent({ template: '<div class="alipay-orders-stub" />' }),
}))

const {
  getUsageStatisticsMock,
  getConsumptionAmountMock,
  getMyBalanceMock,
  getMyTransactionsMock,
  redeemCodeMock,
  setUserInfoMock,
  messageErrorMock,
  messageSuccessMock,
  sessionGetRecentMock,
  sessionGetAllByIndexMock,
  sessionSaveMock,
  sessionGetItemMock,
  sessionSetItemMock,
  sessionRemoveItemMock,
  transactionHistoryPropsRef,
  transactionHistoryEmitRef,
} = vi.hoisted(() => ({
  getUsageStatisticsMock: vi.fn(),
  getConsumptionAmountMock: vi.fn(),
  getMyBalanceMock: vi.fn(),
  getMyTransactionsMock: vi.fn(),
  redeemCodeMock: vi.fn(),
  setUserInfoMock: vi.fn(),
  messageErrorMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  sessionGetRecentMock: vi.fn(),
  sessionGetAllByIndexMock: vi.fn(),
  sessionSaveMock: vi.fn(),
  sessionGetItemMock: vi.fn(),
  sessionSetItemMock: vi.fn(),
  sessionRemoveItemMock: vi.fn(),
  transactionHistoryPropsRef: { value: null as any },
  transactionHistoryEmitRef: { value: null as any },
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: ref(true),
    isMobile: ref(false),
  }),
}))

vi.mock('@/service/balanceTransactionService', () => ({
  balanceTransactionService: {
    getUsageStatistics: getUsageStatisticsMock,
    getConsumptionAmount: getConsumptionAmountMock,
    getMyBalance: getMyBalanceMock,
    getMyTransactions: getMyTransactionsMock,
  },
}))

vi.mock('@/service/redemptionCodeService', () => ({
  redemptionCodeService: {
    redeemCode: redeemCodeMock,
  },
}))

vi.mock('@/stores/userInfoStore', () => ({
  useUserInfoStore: () => ({
    userInfo: { balance: 88 },
    setUserInfo: setUserInfoMock,
  }),
}))

vi.mock('@/utils/sessionDB', () => ({
  STORE_NAMES: {
    BALANCE_TRANSACTIONS: 'BALANCE_TRANSACTIONS',
    SESSION_META: 'SESSION_META',
  },
  sessionDB: {
    getRecent: sessionGetRecentMock,
    getAllByIndex: sessionGetAllByIndexMock,
    save: sessionSaveMock,
    getItem: sessionGetItemMock,
    setItem: sessionSetItemMock,
    removeItem: sessionRemoveItemMock,
  },
}))

vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: {
    error: messageErrorMock,
    success: messageSuccessMock,
  },
}))

vi.mock('@element-plus/icons-vue', () => ({
  Wallet: defineComponent({ name: 'WalletIcon', template: '<span />' }),
  Refresh: defineComponent({ name: 'RefreshIcon', template: '<span />' }),
  Switch: defineComponent({ name: 'SwitchIcon', template: '<span />' }),
}))

vi.mock('vue-echarts', () => ({
  default: defineComponent({
    name: 'VChart',
    template: '<div class="v-chart-stub" />',
  }),
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

vi.mock('@/components/balance/TransactionHistory.vue', () => ({
  default: defineComponent({
    name: 'TransactionHistory',
    props: {
      transactions: { type: Array, default: () => [] },
      loading: { type: Boolean, default: false },
      loadingFull: { type: Boolean, default: false },
    },
    emits: ['refresh'],
    setup(props, { emit }) {
      transactionHistoryPropsRef.value = props
      transactionHistoryEmitRef.value = emit
      return () => h('div', { class: 'transaction-history-stub' })
    },
  }),
}))

vi.mock('@/components/common/ComponentErrorBoundary.vue', () => ({
  default: defineComponent({
    name: 'ComponentErrorBoundary',
    setup(_props, { slots }) {
      return () => h('div', { class: 'error-boundary-stub' }, slots.default ? slots.default() : [])
    },
  }),
}))

vi.mock('@/views/relay/balance-history/components/BalanceTransferPanel.vue', () => ({
  default: defineComponent({
    name: 'BalanceTransferPanel',
    setup() {
      return () => h('div', { class: 'balance-transfer-panel-stub' })
    },
  }),
}))

import BalanceHistoryView from '@/views/relay/BalanceHistoryView.vue'
import ConsumptionRecordsView from '@/views/relay/ConsumptionRecordsView.vue'
import { configureRequestErrorNotifier } from '@/utils/requestErrorNotice'
import * as requestErrorNotice from '@/utils/requestErrorNotice'
import { i18ns } from '@/locales'

const createTransactions = () =>
  [
    {
      id: 'zero-charge',
      type: 'api_usage',
      amount: 0,
      inputTokens: 999,
      outputTokens: 1,
      balanceAfter: 50,
      createTime: '2026-04-26T00:00:00.000Z',
      description: 'API调用失败(上游错误，未扣费): /relay/proxy/v1/chat/completions',
      model: 'gpt-4o',
    },
    {
      id: 'charged',
      type: 'api_usage',
      amount: -2,
      inputTokens: 100,
      outputTokens: 200,
      balanceAfter: 48,
      createTime: '2026-04-26T00:10:00.000Z',
      description: 'API调用: /relay/proxy/v1/chat/completions',
      model: 'gpt-4o',
    },
  ] as any[]

const ElColStub = defineComponent({
  name: 'ElCol',
  setup(_props, { slots }) {
    return () => h('div', { class: 'el-col-stub' }, slots.default ? slots.default() : [])
  },
})

const mountView = async (view = BalanceHistoryView) => {
  const wrapper = mount(view, {
    global: {
      directives: { loading: {} },
      stubs: {
        'el-card': defineComponent({ template: '<div><slot name="header" /><slot /></div>' }),
        'el-row': defineComponent({ template: '<div><slot /></div>' }),
        'el-col': ElColStub,
        'el-form': defineComponent({ template: '<form><slot /></form>' }),
        'el-form-item': defineComponent({ template: '<div><slot /></div>' }),
        'el-input': defineComponent({ template: '<input />' }),
        'el-button': defineComponent({ template: '<button><slot /></button>' }),
        'el-divider': defineComponent({ template: '<hr />' }),
        'el-progress': defineComponent({ template: '<div class="el-progress-stub" />' }),
        'el-icon': defineComponent({ template: '<i><slot /></i>' }),
      },
    },
  })

  await flushPromises()
  return wrapper
}

describe('BalanceHistoryView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-26T00:15:00.000Z'))
    configureRequestErrorNotifier((_title, message) => messageErrorMock(message))
    transactionHistoryPropsRef.value = null
    transactionHistoryEmitRef.value = null
    sessionGetItemMock.mockResolvedValue(false)
    sessionSetItemMock.mockResolvedValue(undefined)
    sessionRemoveItemMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const setupCredit = (overrides: Record<string, unknown> = {}) => {
    const overdraft = {
      overdraftLimit: 20,
      usedOverdraft: 5.1234,
      remainingOverdraft: 14.8766,
      categories: ['relay', 'chat'],
      calculationError: false,
      accountActive: true,
      ...overrides,
    }
    getMyBalanceMock.mockResolvedValue({ data: { balance: -5.1234, overdraft } })
    getUsageStatisticsMock.mockResolvedValue({ data: { total: 100, used: 10, remaining: 90 } })
    getMyTransactionsMock.mockResolvedValue({ data: { records: [], total: 0 } })
    sessionGetRecentMock.mockResolvedValue([])
    sessionGetAllByIndexMock.mockResolvedValue([])
    return overdraft
  }

  it('shows the server credit limit, used amount, remaining amount, and permitted categories', async () => {
    setupCredit()
    const wrapper = await mountView()
    expect(wrapper.find('[data-credit="limit"] dd').text()).toContain('20')
    expect(wrapper.find('[data-credit="used"] dd').text()).toContain('5.1234')
    expect(wrapper.find('[data-credit="remaining"] dd').text()).toContain('14.8766')
    expect(wrapper.find('.balance-credit').text()).toContain(
      i18ns.t('balance.overdraft.category.relay'),
    )
    expect(wrapper.find('.balance-credit').text()).toContain(
      i18ns.t('balance.overdraft.category.chat'),
    )
    expect(wrapper.find('[role="status"]').text()).toBe(i18ns.t('balance.overdraft.hint'))
    wrapper.unmount()
  })

  it.each([
    [{ overdraftLimit: 0, remainingOverdraft: 0 }, 'disabled'],
    [{ categories: [], remainingOverdraft: 0 }, 'disabled'],
    [{ accountActive: false, remainingOverdraft: 0 }, 'accountInactive'],
    [{ calculationError: true, overdraftLimit: 0, remainingOverdraft: 0 }, 'calculationError'],
  ])('explains unavailable credit: %j', async (overrides, status) => {
    setupCredit(overrides)
    const wrapper = await mountView()
    expect(wrapper.find('[data-credit="remaining"] dd').text()).toContain('0')
    expect(wrapper.find('[role="status"]').text()).toBe(
      i18ns.t(`balance.overdraft.${status}` as any),
    )
    wrapper.unmount()
  })

  it('uses placeholders while refreshing and after failure instead of showing stale or zero credit', async () => {
    const notice = vi
      .spyOn(requestErrorNotice, 'showRequestErrorNotice')
      .mockImplementationOnce(() => {})
    setupCredit()
    const wrapper = await mountView()
    let rejectLoad!: (error: Error) => void
    getMyBalanceMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject
        }),
    )
    const refresh = (wrapper.vm as any).refreshBalanceAndStats()
    await flushPromises()
    expect(wrapper.find('[data-credit="remaining"] dd').text()).toContain('—')
    expect(wrapper.find('.balance-credit').attributes('aria-busy')).toBe('true')
    rejectLoad(new Error('Balance credit refresh unavailable'))
    await refresh
    await flushPromises()
    expect(wrapper.find('[data-credit="remaining"] dd').text()).toContain('—')
    expect(wrapper.find('[role="status"]').text()).toBe(i18ns.t('balance.overdraft.unavailable'))
    expect(notice).toHaveBeenCalled()
    notice.mockRestore()
    wrapper.unmount()
  })

  it('refreshes percentage-based credit after a successful redemption', async () => {
    const overdraft = setupCredit()
    const wrapper = await mountView()
    getMyBalanceMock.mockResolvedValueOnce({
      data: {
        balance: 94.8766,
        overdraft: { ...overdraft, overdraftLimit: 40, usedOverdraft: 0, remainingOverdraft: 40 },
      },
    })
    redeemCodeMock.mockResolvedValue({ code: 0, data: { balance: 94.8766 } })
    ;(wrapper.vm as any).redeemCode = 'test-credit-redemption'
    await (wrapper.vm as any).handleRedeem()
    await flushPromises()
    expect(getMyBalanceMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-credit="remaining"] dd').text()).toContain('40')
    wrapper.unmount()
  })

  it('does not treat an older server without credit fields as a zero limit', async () => {
    setupCredit()
    getMyBalanceMock.mockResolvedValue({ data: { balance: 88 } })
    const wrapper = await mountView()
    expect(wrapper.find('[data-credit="limit"] dd').text()).toContain('—')
    expect(wrapper.find('[role="status"]').text()).toBe(i18ns.t('balance.overdraft.unavailable'))
    wrapper.unmount()
  })

  it('excludes zero-charge upstream errors from request and token stats', async () => {
    const records = createTransactions()

    getUsageStatisticsMock.mockResolvedValue({ data: { total: 100, used: 10, remaining: 90 } })
    getMyBalanceMock.mockResolvedValue({ data: { balance: 88 } })
    getMyTransactionsMock.mockResolvedValue({ data: { records, total: records.length } })
    sessionGetRecentMock.mockResolvedValue([])
    sessionGetAllByIndexMock.mockResolvedValue([])
    sessionSaveMock.mockResolvedValue(undefined)
    redeemCodeMock.mockResolvedValue({ code: 0, data: { balance: 88 } })

    const wrapper = await mountView()

    expect((wrapper.vm as any).requestCount).toBe(1)
    expect((wrapper.vm as any).avgTPM).toBe(30)
    expect((wrapper.vm as any).avgRPM).toBe(0.1)
    expect(transactionHistoryPropsRef.value?.transactions).toHaveLength(2)
  })

  it('does not reload the selected time range when no IndexedDB cursor is available', async () => {
    const staleRecord = {
      ...createTransactions()[0],
      id: 'historical-channel',
      displayChannelName: undefined,
    }
    const refreshedRecord = {
      ...staleRecord,
      displayChannelName: 'Original Physical Member',
    }

    getUsageStatisticsMock.mockResolvedValue({ data: { total: 100, used: 10, remaining: 90 } })
    getMyBalanceMock.mockResolvedValue({ data: { balance: 88 } })
    getMyTransactionsMock
      .mockResolvedValueOnce({ data: { records: [staleRecord], total: 1 } })
      .mockResolvedValueOnce({ data: { records: [refreshedRecord], total: 1 } })
    sessionGetRecentMock.mockResolvedValue([])
    sessionGetAllByIndexMock.mockResolvedValue([])
    sessionSaveMock.mockResolvedValue(undefined)
    redeemCodeMock.mockResolvedValue({ code: 0, data: { balance: 88 } })

    const wrapper = await mountView()
    transactionHistoryEmitRef.value('refresh')
    await flushPromises()

    expect(getMyTransactionsMock).toHaveBeenCalledTimes(1)
    expect(transactionHistoryPropsRef.value?.transactions).toEqual([staleRecord])
    wrapper.unmount()
  })

  it('refreshes only from the latest IndexedDB record through now and upserts the overlap', async () => {
    const cachedRecord = {
      ...createTransactions()[0],
      id: 'latest-cached',
      createTime: '2026-04-26T00:10:00.000Z',
      displayChannelName: undefined,
    }
    const updatedRecord = {
      ...cachedRecord,
      displayChannelName: 'Automatic Pool',
    }

    getUsageStatisticsMock.mockResolvedValue({ data: { total: 100, used: 10, remaining: 90 } })
    getMyBalanceMock.mockResolvedValue({ data: { balance: 88 } })
    getMyTransactionsMock.mockResolvedValue({ data: { records: [updatedRecord], total: 1 } })
    sessionGetRecentMock.mockResolvedValue([cachedRecord])
    sessionGetAllByIndexMock.mockResolvedValue([cachedRecord])
    sessionSaveMock.mockResolvedValue(undefined)
    redeemCodeMock.mockResolvedValue({ code: 0, data: { balance: 88 } })

    const wrapper = await mountView()
    await flushPromises()
    await (wrapper.vm as any).incrementalUpdateTransactions()

    expect(getMyTransactionsMock).toHaveBeenCalled()
    for (const [params] of getMyTransactionsMock.mock.calls) {
      expect(params.startTime).toBe('2026-04-26T00:10:00.000Z')
      expect(params.endTime).toBe('2026-04-26T00:15:00.000Z')
    }
    expect((wrapper.vm as any).allTransactions[0].displayChannelName).toBe('Automatic Pool')
  })

  it('allows returning to a smaller range without loading older records again', async () => {
    const recentRecord = {
      ...createTransactions()[0],
      id: 'recent',
      createTime: '2026-04-26T00:10:00.000Z',
    }
    const olderRecord = {
      ...createTransactions()[1],
      id: 'older',
      createTime: '2026-04-24T00:10:00.000Z',
    }

    getUsageStatisticsMock.mockResolvedValue({ data: { total: 100, used: 10, remaining: 90 } })
    getMyBalanceMock.mockResolvedValue({ data: { balance: 88 } })
    getMyTransactionsMock.mockImplementation(({ startTime }) => {
      const records = [recentRecord, olderRecord].filter(
        (record) => !startTime || new Date(record.createTime) >= new Date(startTime),
      )
      return Promise.resolve({ data: { records, total: records.length } })
    })
    sessionGetRecentMock.mockResolvedValue([])
    sessionGetAllByIndexMock.mockResolvedValue([])
    sessionSaveMock.mockResolvedValue(undefined)
    redeemCodeMock.mockResolvedValue({ code: 0, data: { balance: 88 } })

    const wrapper = await mountView()
    await (wrapper.vm as any).handleHistorySliderChange(1)
    expect((wrapper.vm as any).allTransactions).toHaveLength(2)

    await (wrapper.vm as any).handleHistorySliderChange(0)
    expect(getMyTransactionsMock).toHaveBeenCalledTimes(2)
    expect((wrapper.vm as any).allTransactions).toEqual([recentRecord])
  })

  it('uses an explicit end time for the 30-day range boundary', async () => {
    const records = createTransactions()

    getUsageStatisticsMock.mockResolvedValue({ data: { total: 100, used: 10, remaining: 90 } })
    getMyBalanceMock.mockResolvedValue({ data: { balance: 88 } })
    getMyTransactionsMock.mockResolvedValue({ data: { records, total: records.length } })
    sessionGetRecentMock.mockResolvedValue([])
    sessionGetAllByIndexMock.mockResolvedValue([])
    sessionSaveMock.mockResolvedValue(undefined)
    redeemCodeMock.mockResolvedValue({ code: 0, data: { balance: 88 } })

    const wrapper = await mountView()
    getMyTransactionsMock.mockClear()

    await (wrapper.vm as any).handleHistorySliderChange(2)

    const [params] = getMyTransactionsMock.mock.calls[0] ?? []
    expect(params.startTime).toBe('2026-03-27T00:15:00.000Z')
    expect(params.endTime).toBe('2026-04-26T00:15:00.000Z')
  })

  const mountConsumptionView = async () => {
    getUsageStatisticsMock.mockResolvedValue({ data: { total: 100, used: 10, remaining: 90 } })
    getMyBalanceMock.mockResolvedValue({ data: { balance: 88 } })
    getMyTransactionsMock.mockResolvedValue({ data: { records: [], total: 0 } })
    sessionGetRecentMock.mockResolvedValue([])
    sessionGetAllByIndexMock.mockResolvedValue([])
    return mountView(ConsumptionRecordsView)
  }

  it('cycles total, local-calendar today, and seven-day consumption independently of the list', async () => {
    getConsumptionAmountMock.mockResolvedValueOnce(1.25).mockResolvedValueOnce(6.5)
    const wrapper = await mountConsumptionView()
    const metric = wrapper.find('.usage-metric')
    const switchButton = metric.find('button')
    const initialLabel = metric.find('dt span').text()
    expect(metric.find('dd').text()).toBe('10 / 100')
    expect(getConsumptionAmountMock).not.toHaveBeenCalled()
    const listRequests = getMyTransactionsMock.mock.calls.length

    await switchButton.trigger('click')
    await flushPromises()
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    expect(getConsumptionAmountMock).toHaveBeenLastCalledWith(
      midnight.toISOString(),
      '2026-04-26T00:15:00.000Z',
    )
    expect(metric.find('dd').text()).toBe('1.25 / 100')
    expect(metric.find('dt span').text()).not.toBe(initialLabel)

    await switchButton.trigger('click')
    await flushPromises()
    expect(getConsumptionAmountMock).toHaveBeenLastCalledWith(
      '2026-04-19T00:15:00.000Z',
      '2026-04-26T00:15:00.000Z',
    )
    expect(metric.find('dd').text()).toBe('6.5 / 100')

    await switchButton.trigger('click')
    await flushPromises()
    expect(metric.find('dd').text()).toBe('10 / 100')
    expect(metric.find('dt span').text()).toBe(initialLabel)
    expect(getConsumptionAmountMock).toHaveBeenCalledTimes(2)
    expect(getMyTransactionsMock).toHaveBeenCalledTimes(listRequests)
    wrapper.unmount()
  })

  it('does not show zero or the previous amount while loading or after a failed period query', async () => {
    let rejectQuery!: (error: Error) => void
    getConsumptionAmountMock.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectQuery = reject)),
    )
    const wrapper = await mountConsumptionView()
    const metric = wrapper.find('.usage-metric')
    await metric.find('button').trigger('click')
    expect(metric.find('dd').text()).toBe('— / 100')
    expect(metric.find('dd').attributes('aria-busy')).toBe('true')
    rejectQuery(new Error('unavailable'))
    await flushPromises()
    expect(metric.find('dd').text()).toBe('— / 100')
    expect(metric.find('dd').attributes('aria-busy')).toBe('false')
    expect(metric.find('.el-progress-stub').exists()).toBe(false)
    expect(messageErrorMock).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('ignores a late response after switching to another consumption range', async () => {
    let resolveToday!: (amount: number) => void
    getConsumptionAmountMock
      .mockImplementationOnce(() => new Promise((resolve) => (resolveToday = resolve)))
      .mockResolvedValueOnce(7)
    const wrapper = await mountConsumptionView()
    const metric = wrapper.find('.usage-metric')
    await metric.find('button').trigger('click')
    await metric.find('button').trigger('click')
    await flushPromises()
    expect(metric.find('dd').text()).toBe('7 / 100')
    resolveToday(1)
    await flushPromises()
    expect(metric.find('dd').text()).toBe('7 / 100')
    wrapper.unmount()
  })
})
