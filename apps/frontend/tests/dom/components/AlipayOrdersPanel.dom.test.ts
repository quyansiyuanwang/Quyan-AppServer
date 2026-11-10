// @vitest-environment jsdom
import { computed, defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Permission } from '@quyan/shared'
import { i18ns } from '@/locales'
import { ALIPAY_POLL_POLICY } from '@/utils/alipay-payment'

const mocks = vi.hoisted(() => ({
  publicConfig: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  order: vi.fn(),
  refresh: vi.fn(),
  refund: vi.fn(),
  refunds: vi.fn(),
  refreshRefund: vi.fn(),
  hasPermission: vi.fn(),
  notice: vi.fn(),
  replace: vi.fn(),
  query: {} as Record<string, string>,
}))
vi.mock('@/service/alipayService', () => ({ alipayService: mocks }))
vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({ hasPermission: mocks.hasPermission }),
}))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: mocks.notice }))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessage: { success: vi.fn() } }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: mocks.query }),
  useRouter: () => ({ replace: mocks.replace }),
}))

import AlipayOrdersPanel from '@/components/balance/AlipayOrdersPanel.vue'

const row = (state = 'paid') => ({
  id: 'order-fixture',
  userId: 'user-fixture',
  outTradeNo: 'AP-fixture',
  tradeNo: 'trade-fixture',
  amount: '10.00',
  creditAmount: '1000.0000',
  rechargeRatio: '100.0000',
  refundedAmount: '0.00',
  state,
  sandbox: true,
  createTime: '2026-11-08T00:00:00Z',
  expiresAt: '2026-11-08T00:30:00Z',
  paidAt: null,
  refunds: [],
})
const stubs = {
  'el-form-item': defineComponent({
    props: ['error'],
    template: '<div><slot /><span role="alert" v-if="error">{{ error }}</span></div>',
  }),
  'el-button': defineComponent({
    props: ['disabled'],
    template: '<button :disabled="disabled"><slot /></button>',
  }),
  'el-input': defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  }),
  'el-alert': defineComponent({
    props: ['title', 'description'],
    template: '<div>{{ title }} {{ description }}</div>',
  }),
  'el-table': defineComponent({
    props: ['data'],
    setup(props) {
      provide(
        'alipayRows',
        computed(() => props.data),
      )
    },
    template: '<div><slot /></div>',
  }),
  'el-table-column': defineComponent({
    setup() {
      return { rows: inject('alipayRows', ref([])) }
    },
    template:
      '<div><template v-for="(row, index) in rows" :key="index"><slot :row="row" /></template></div>',
  }),
  'el-dialog': defineComponent({
    props: ['modelValue'],
    template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
  }),
}
const mounted: ReturnType<typeof mount>[] = []
async function panel(management = false) {
  const wrapper = mount(AlipayOrdersPanel, { props: { management }, global: { stubs } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}
function button(wrapper: ReturnType<typeof mount>, key: Parameters<typeof i18ns.t>[0]) {
  const found = wrapper.findAll('button').find((item) => item.text() === i18ns.t(key))
  if (!found) throw new Error('Missing button: ' + key)
  return found
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.query = {}
  mocks.hasPermission.mockReturnValue(true)
  mocks.publicConfig.mockResolvedValue({
    enabled: true,
    sandbox: true,
    minAmount: '0.01',
    maxAmount: '100',
    rechargeRatio: '100',
  })
  mocks.list.mockResolvedValue({ records: [row()], total: 21, page: 1, pageSize: 10 })
  mocks.refunds.mockResolvedValue({ records: [], total: 0, page: 1, pageSize: 10 })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.useRealTimers()
})

describe('Alipay order interactions', () => {
  it('hides the entire user panel and skips order listing when payments are disabled', async () => {
    mocks.publicConfig.mockResolvedValueOnce({ enabled: false, sandbox: true })
    const wrapper = await panel()
    expect(wrapper.find('.alipay-orders').exists()).toBe(false)
    expect(wrapper.findAll('input')).toHaveLength(0)
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('does not flash the user panel while payment configuration is loading', async () => {
    let resolve!: (value: { enabled: boolean }) => void
    mocks.publicConfig.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const wrapper = await panel()
    expect(wrapper.find('.alipay-orders').exists()).toBe(false)
    expect(mocks.list).not.toHaveBeenCalled()
    resolve({ enabled: false })
    await flushPromises()
    expect(wrapper.find('.alipay-orders').exists()).toBe(false)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('keeps the user panel hidden when payment configuration cannot be loaded', async () => {
    mocks.publicConfig.mockRejectedValueOnce(new Error('fixture configuration failure'))
    const wrapper = await panel()
    expect(wrapper.find('.alipay-orders').exists()).toBe(false)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.notice).toHaveBeenCalledTimes(1)
  })
  it('shows the recharge form when payments are enabled', async () => {
    const wrapper = await panel()
    expect(wrapper.find('.alipay-orders').exists()).toBe(true)
    expect(wrapper.find('input').exists()).toBe(true)
    expect(button(wrapper, 'alipay.pay').exists()).toBe(true)
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(1, 10, false, undefined)
  })
  it('keeps permitted management history available independently of the payment switch', async () => {
    mocks.publicConfig.mockResolvedValue({ enabled: false })
    const wrapper = await panel(true)
    expect(wrapper.find('.alipay-orders').exists()).toBe(true)
    expect(mocks.publicConfig).not.toHaveBeenCalled()
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(1, 10, true, undefined)
    expect(wrapper.findAll('button').some((item) => item.text() === i18ns.t('alipay.pay'))).toBe(
      false,
    )
  })
  it('still confirms a returning order without exposing payment UI after payments are disabled', async () => {
    mocks.publicConfig.mockResolvedValueOnce({ enabled: false })
    mocks.query = { paymentOrder: 'order-fixture' }
    mocks.order.mockResolvedValueOnce(row('pending'))
    mocks.refresh.mockResolvedValueOnce(row('paid'))
    const wrapper = await panel()
    expect(wrapper.find('.alipay-orders').exists()).toBe(false)
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith('order-fixture')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('does not load management data without payment read permission', async () => {
    mocks.hasPermission.mockReturnValue(false)
    const wrapper = await panel(true)
    expect(wrapper.find('.alipay-orders').exists()).toBe(false)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('hides refunds from read-only payment administrators', async () => {
    mocks.hasPermission.mockImplementation(
      (permission: Permission) => permission === Permission.PAYMENT_READ,
    )
    const wrapper = await panel(true)
    expect(wrapper.findAll('button').some((item) => item.text() === i18ns.t('alipay.refund'))).toBe(
      false,
    )
    expect(mocks.list).toHaveBeenCalledWith(1, 10, true, undefined)
  })
  it('fetches subsequent pages from the server', async () => {
    const wrapper = await panel()
    const pagination = wrapper.findComponent({ name: 'ElPagination' })
    pagination.vm.$emit('update:current-page', 2)
    pagination.vm.$emit('current-change', 2)
    await flushPromises()
    expect(mocks.list).toHaveBeenLastCalledWith(2, 10, false, undefined)
  })
  it('keeps a stable checkout id after a network error and prevents double submission', async () => {
    let reject!: (error: Error) => void
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    const wrapper = await panel()
    await wrapper.find('input').setValue(' 0.29 ')
    expect(wrapper.text()).toContain('29.0000')
    await button(wrapper, 'alipay.pay').trigger('click')
    await button(wrapper, 'alipay.pay').trigger('click')
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const first = mocks.create.mock.calls[0][0]
    expect(first).toEqual({
      amount: '0.29',
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{16,64}$/),
    })
    reject(new Error('fixture timeout'))
    await flushPromises()
    mocks.create.mockRejectedValueOnce(new Error('fixture retry'))
    await button(wrapper, 'alipay.pay').trigger('click')
    await flushPromises()
    expect(mocks.create.mock.calls[1][0]).toEqual(first)
    expect(mocks.notice).toHaveBeenCalledTimes(2)
  })
  it('shows an inline required error without creating an order when amount is empty', async () => {
    const wrapper = await panel()
    await button(wrapper, 'alipay.pay').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(i18ns.t('alipay.amountRequired'))
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.notice).not.toHaveBeenCalled()
  })
  it('clears the required error and submits once after a valid amount is entered', async () => {
    const wrapper = await panel()
    await button(wrapper, 'alipay.pay').trigger('click')
    await wrapper.find('input').setValue('0.01')
    expect(wrapper.text()).not.toContain(i18ns.t('alipay.amountRequired'))
    mocks.create.mockResolvedValueOnce({ order: row('pending'), paymentUrl: '' })
    await button(wrapper, 'alipay.pay').trigger('click')
    await flushPromises()
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      amount: '0.01',
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{16,64}$/),
    })
    expect(mocks.notice).not.toHaveBeenCalled()
  })
  it.each(['0', '-1', '1e2', '0.001', '01', '1.'])(
    'rejects invalid amount %s before contacting the backend',
    async (value) => {
      const wrapper = await panel()
      await wrapper.find('input').setValue(value)
      await button(wrapper, 'alipay.pay').trigger('click')
      expect(wrapper.text()).toContain(i18ns.t('alipay.amountInvalid'))
      expect(mocks.create).not.toHaveBeenCalled()
    },
  )
  it.each(['0.99', '10.01'])(
    'rejects out-of-range amount %s using the loaded configuration',
    async (value) => {
      mocks.publicConfig.mockResolvedValueOnce({
        enabled: true,
        sandbox: true,
        minAmount: '1.00',
        maxAmount: '10.00',
        rechargeRatio: '100',
      })
      const wrapper = await panel()
      await wrapper.find('input').setValue(value)
      await button(wrapper, 'alipay.pay').trigger('click')
      expect(wrapper.text()).toContain(
        i18ns.t('alipay.amountOutOfRange', { min: '1.00', max: '10.00' }),
      )
      expect(mocks.create).not.toHaveBeenCalled()
    },
  )
  it('never treats return query parameters as payment proof and stops polling when paid', async () => {
    vi.useFakeTimers()
    mocks.query = {
      paymentOrder: 'order-fixture',
      trade_status: 'TRADE_SUCCESS',
      sign: 'untrusted',
    }
    mocks.order.mockResolvedValue(row('pending'))
    mocks.refresh.mockResolvedValueOnce(row('pending')).mockResolvedValueOnce(row('paid'))
    const wrapper = await panel()
    expect(wrapper.text()).toContain(i18ns.t('alipay.pendingHelp'))
    expect(mocks.replace).toHaveBeenCalledWith({ query: { paymentOrder: 'order-fixture' } })
    await vi.advanceTimersByTimeAsync(ALIPAY_POLL_POLICY.intervalMs)
    await flushPromises()
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(ALIPAY_POLL_POLICY.intervalMs * 2)
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('changed')).toHaveLength(2)
  })
  it('cleans up polling on unmount', async () => {
    vi.useFakeTimers()
    mocks.query = { paymentOrder: 'order-fixture' }
    mocks.order.mockResolvedValue(row('pending'))
    mocks.refresh.mockResolvedValue(row('pending'))
    const wrapper = await panel()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(ALIPAY_POLL_POLICY.intervalMs * 2)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
  it('submits a partial refund once and retains its idempotency key for retry', async () => {
    const wrapper = await panel(true)
    await button(wrapper, 'alipay.refund').trigger('click')
    const inputs = wrapper.findAll('input')
    await inputs[1].setValue('2.00')
    await inputs[2].setValue('fixture reason')
    let reject!: (error: Error) => void
    mocks.refund.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    await button(wrapper, 'confirm').trigger('click')
    await button(wrapper, 'confirm').trigger('click')
    expect(mocks.refund).toHaveBeenCalledTimes(1)
    expect(mocks.refund.mock.calls[0]).toEqual([
      'order-fixture',
      expect.objectContaining({ amount: '2.00', reason: 'fixture reason' }),
    ])
    reject(new Error('fixture timeout'))
    await flushPromises()
    mocks.refund.mockResolvedValueOnce({ state: 'processing' })
    await button(wrapper, 'confirm').trigger('click')
    await flushPromises()
    expect(mocks.refund.mock.calls[1]).toEqual(mocks.refund.mock.calls[0])
  })
})
