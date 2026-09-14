// @vitest-environment jsdom
import { computed, defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getConfigMock,
  listGiftCodesMock,
  createGiftCodeMock,
  cancelGiftCodeMock,
  setUserInfoMock,
  messageErrorMock,
  messageSuccessMock,
  confirmMock,
  clipboardWriteMock,
} = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  listGiftCodesMock: vi.fn(),
  createGiftCodeMock: vi.fn(),
  cancelGiftCodeMock: vi.fn(),
  setUserInfoMock: vi.fn(),
  messageErrorMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  confirmMock: vi.fn(),
  clipboardWriteMock: vi.fn(),
}))

vi.mock('@/service/balanceTransferService', () => ({
  balanceTransferService: {
    getConfig: getConfigMock,
    listGiftCodes: listGiftCodesMock,
    createGiftCode: createGiftCodeMock,
    cancelGiftCode: cancelGiftCodeMock,
  },
}))

vi.mock('@/stores/userInfoStore', () => ({
  useUserInfoStore: () => ({
    userInfo: { balance: 100 },
    setUserInfo: setUserInfoMock,
  }),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    success: messageSuccessMock,
    error: messageErrorMock,
  },
  ElMessageBox: {
    confirm: confirmMock,
  },
}))

vi.mock('@element-plus/icons-vue', () => ({
  Plus: defineComponent({ name: 'PlusIcon', template: '<span />' }),
  Refresh: defineComponent({ name: 'RefreshIcon', template: '<span />' }),
  Switch: defineComponent({ name: 'SwitchIcon', template: '<span />' }),
}))

import BalanceTransferPanel from '@/views/relay/balance-history/components/BalanceTransferPanel.vue'

const ElTableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, default: () => [] } },
  setup(props) {
    provide(
      'tableRows',
      computed(() => props.data as any[]),
    )
  },
  template: '<div class="el-table-stub"><slot /></div>',
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  props: {
    label: { type: String, default: '' },
    prop: { type: String, default: '' },
  },
  setup() {
    const rows = inject<any>('tableRows', ref([]))
    return { rows }
  },
  template:
    '<div class="el-table-column-stub"><template v-for="(row, index) in rows" :key="index"><slot :row="row" /></template></div>',
})

const ElLinkStub = defineComponent({
  name: 'ElLink',
  template: '<a class="el-link-stub"><slot /></a>',
})

const GIFT_CODE = 'ugc_AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const MASKED_GIFT_CODE = 'ugc_AbCdEfGh...2345'

const createGiftCodeRecord = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'gift-code-1',
    code: GIFT_CODE,
    amount: 10,
    feeAmount: 0.5,
    feePercent: 5,
    cancelFeeRefundPercent: 100,
    totalDebit: 10.5,
    state: 'active',
    createTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as any

const mountPanel = async () => {
  const wrapper = mount(BalanceTransferPanel, {
    global: {
      stubs: {
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
        'el-link': ElLinkStub,
      },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  getConfigMock.mockReset()
  listGiftCodesMock.mockReset()
  createGiftCodeMock.mockReset()
  cancelGiftCodeMock.mockReset()
  setUserInfoMock.mockReset()
  messageErrorMock.mockReset()
  messageSuccessMock.mockReset()
  confirmMock.mockReset()
  clipboardWriteMock.mockReset()

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteMock },
  })

  getConfigMock.mockResolvedValue({
    giftCodeEnabled: true,
    directTransferEnabled: true,
    giftCodeFeePercent: 5,
    giftCodeCancelFeeRefundPercent: 100,
    directTransferFeePercent: 5,
  })
  listGiftCodesMock.mockResolvedValue({
    records: [createGiftCodeRecord()],
    total: 1,
    page: 1,
    pageSize: 20,
  })
})

describe('BalanceTransferPanel gift code table', () => {
  it('shows only the head and tail of a gift code instead of the full value', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain(MASKED_GIFT_CODE)
    expect(wrapper.text()).not.toContain(GIFT_CODE)
  })

  it('copies the full gift code when the masked value is clicked', async () => {
    const wrapper = await mountPanel()

    const link = wrapper.find('a.el-link-stub')
    expect(link.exists()).toBe(true)
    expect(link.text()).toBe(MASKED_GIFT_CODE)

    await link.trigger('click')
    await flushPromises()

    expect(clipboardWriteMock).toHaveBeenCalledWith(GIFT_CODE)
    expect(messageSuccessMock).toHaveBeenCalled()
  })

  it('keeps short codes untouched', async () => {
    listGiftCodesMock.mockResolvedValue({
      records: [createGiftCodeRecord({ code: 'ugc_shortcode' })],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('ugc_shortcode')
    expect(wrapper.text()).not.toContain('ugc_shortcode...')
  })
})
