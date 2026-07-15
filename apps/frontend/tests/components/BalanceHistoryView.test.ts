import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getUsageStatisticsMock,
  getMyBalanceMock,
  getMyTransactionsMock,
  redeemCodeMock,
  setUserInfoMock,
  messageErrorMock,
  messageSuccessMock,
  sessionGetRecentMock,
  sessionGetAllByIndexMock,
  sessionSaveMock,
  transactionHistoryPropsRef,
  transactionHistoryEmitRef,
} = vi.hoisted(() => ({
  getUsageStatisticsMock: vi.fn(),
  getMyBalanceMock: vi.fn(),
  getMyTransactionsMock: vi.fn(),
  redeemCodeMock: vi.fn(),
  setUserInfoMock: vi.fn(),
  messageErrorMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  sessionGetRecentMock: vi.fn(),
  sessionGetAllByIndexMock: vi.fn(),
  sessionSaveMock: vi.fn(),
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
  },
  sessionDB: {
    getRecent: sessionGetRecentMock,
    getAllByIndex: sessionGetAllByIndexMock,
    save: sessionSaveMock,
  },
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: messageErrorMock,
    success: messageSuccessMock,
  },
}))

vi.mock('@element-plus/icons-vue', () => ({
  Wallet: defineComponent({ name: 'WalletIcon', template: '<span />' }),
  Refresh: defineComponent({ name: 'RefreshIcon', template: '<span />' }),
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

import BalanceHistoryView from '@/views/relay/BalanceHistoryView.vue'

const createTransactions = () => [
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

const mountView = async () => {
  const wrapper = mount(BalanceHistoryView, {
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
    transactionHistoryPropsRef.value = null
    transactionHistoryEmitRef.value = null
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
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
    const statValues = wrapper.findAll('.stat-value')

    expect(statValues[1]?.text()).toBe('1')
    expect(statValues[2]?.text()).toBe('30.00')
    expect(statValues[3]?.text()).toBe('0.10')
    expect(transactionHistoryPropsRef.value?.transactions).toHaveLength(2)
  })

  it('refreshes existing cached records with backfilled display channels', async () => {
    const staleRecord = {
      ...createTransactions()[0],
      id: 'historical-channel',
      displayChannelName: undefined,
    }
    const refreshedRecord = {
      ...staleRecord,
      displayChannelName: '历史混池渠道',
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

    expect(getMyTransactionsMock).toHaveBeenCalledTimes(2)
    expect(transactionHistoryPropsRef.value?.transactions).toEqual([refreshedRecord])
    expect(sessionSaveMock).toHaveBeenLastCalledWith('BALANCE_TRANSACTIONS', [refreshedRecord])
    wrapper.unmount()
  })
})
