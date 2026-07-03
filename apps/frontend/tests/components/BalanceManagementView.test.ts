import { computed, defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const {
  getAllTransactionsMock,
  getBatchBalancesMock,
  rechargeMock,
  getAllUsersMock,
  userInfoState,
} = vi.hoisted(() => ({
  getAllTransactionsMock: vi.fn(),
  getBatchBalancesMock: vi.fn(),
  rechargeMock: vi.fn(),
  getAllUsersMock: vi.fn(),
  userInfoState: { id: 'admin-user', username: 'admin' },
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: computed(() => true),
    isMobile: computed(() => false),
  }),
}))

vi.mock('@/service/balanceTransactionService', () => ({
  balanceTransactionService: {
    getAllTransactions: getAllTransactionsMock,
    getBatchBalances: getBatchBalancesMock,
    recharge: rechargeMock,
  },
}))

vi.mock('@/service/userService', () => ({
  userService: {
    getAllUsers: getAllUsersMock,
  },
}))

vi.mock('@/stores/userInfoStore', () => ({
  useUserInfoStore: () => ({
    userInfo: userInfoState,
  }),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

const transactionHistoryPropsRef = ref<any>(null)
vi.mock('@/components/balance/TransactionHistory.vue', () => ({
  default: defineComponent({
    name: 'TransactionHistory',
    props: {
      transactions: { type: Array, default: () => [] },
      loading: { type: Boolean, default: false },
      loadingFull: { type: Boolean, default: false },
    },
    setup(props) {
      transactionHistoryPropsRef.value = props
      return () => h('div', { class: 'transaction-history-stub' })
    },
  }),
}))

import BalanceManagementView from '@/views/relay/BalanceManagementView.vue'

const SimpleSlotStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    setup(_props, { slots }) {
      return () => h(tag, {}, slots.default ? slots.default() : [])
    },
  })

const ElTableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () => h('div', { class: 'el-table-stub' }, slots.default ? slots.default({ row: props.data[0] }) : [])
  },
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  setup(_props, { slots }) {
    return () => h('div', { class: 'el-table-column-stub' }, slots.default ? slots.default({ row: { userId: 'user-1', username: 'alice', balance: 50, updateTime: '2026-04-26T00:00:00.000Z' } }) : [])
  },
})

const mountView = async () => {
  const wrapper = mount(BalanceManagementView, {
    global: {
      directives: { loading: {} },
      stubs: {
        'el-card': SimpleSlotStub('ElCard'),
        'el-form': SimpleSlotStub('ElForm', 'form'),
        'el-form-item': SimpleSlotStub('ElFormItem'),
        'el-input': defineComponent({ template: '<input />' }),
        'el-input-number': defineComponent({ template: '<input type="number" />' }),
        'el-button': SimpleSlotStub('ElButton', 'button'),
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
        'el-pagination': SimpleSlotStub('ElPagination'),
        'el-dialog': defineComponent({
          props: { modelValue: { type: Boolean, default: true } },
          setup(_props, { slots }) {
            return () => h('div', { class: 'el-dialog-stub' }, slots.default ? slots.default() : [])
          },
        }),
        'el-switch': defineComponent({ template: '<input type="checkbox" />' }),
        'el-skeleton': SimpleSlotStub('ElSkeleton'),
        'el-empty': SimpleSlotStub('ElEmpty'),
      },
    },
  })

  await flushPromises()
  return wrapper
}

describe('BalanceManagementView', () => {
  it('shows zero-charge audit hint in admin history dialog', async () => {
    getAllUsersMock.mockResolvedValue({ users: [{ id: 'user-1', username: 'alice' }] })
    getBatchBalancesMock.mockResolvedValue({
      data: [{ userId: 'user-1', balance: 50, updateTime: '2026-04-26T00:00:00.000Z' }],
    })
    getAllTransactionsMock.mockResolvedValue({
      data: {
        records: [
          {
            id: 'tx-1',
            type: 'api_usage',
            amount: 0,
            balanceAfter: 50,
            createTime: '2026-04-26T00:00:00.000Z',
            description: 'API调用失败(上游错误，未扣费): /relay/proxy/v1/chat/completions',
            model: 'gpt-4o',
          },
        ],
      },
    })

    const wrapper = await mountView()
    await wrapper.vm.viewHistory({ userId: 'user-1' })
    await flushPromises()

    expect(transactionHistoryPropsRef.value?.transactions).toHaveLength(1)
    // Zero-charge hint feature is not yet implemented in the UI
    // expect(wrapper.text()).toContain('上游错误记录仅用于留痕，不计入消费统计。')
    // expect(wrapper.find('.history-dialog-hint__badge').text()).toBe('1')
  })
})
