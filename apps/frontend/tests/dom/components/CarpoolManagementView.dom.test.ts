// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n, i18ns } from '@/locales'
import { CustomCode } from '@/constant/custom-code'
const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  adminDetail: vi.fn(),
  deliveryChannels: vi.fn(),
  fulfill: vi.fn(),
  accept: vi.fn(),
  fail: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  notice: vi.fn(),
  vueError: vi.fn(),
}))
vi.mock('@/service/carpoolService', () => ({ carpoolService: mocks }))
vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { warning: mocks.warning, success: mocks.success },
  ElMessageBox: { confirm: mocks.confirm, prompt: mocks.prompt },
}))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: mocks.notice }))
import CarpoolManagementView from '@/views/relay/CarpoolManagementView.vue'
const order = (id = 'order-1', state = 'accepted') => ({
  id,
  state,
  packageName: 'Test carpool',
  members: [],
  events: [],
  maxMembers: 3,
  activeMemberCount: 1,
  totalQuota: 900,
  salePrice: 120,
})
const missing = () => ({ response: { status: 404, data: { code: CustomCode.NOT_FOUND } } })
let wrapper: VueWrapper
const mountView = async () => {
  wrapper = mount(CarpoolManagementView, {
    global: {
      plugins: [i18n],
      config: { errorHandler: mocks.vueError },
      stubs: {
        'el-table-column': defineComponent({ template: '<div />' }),
        'el-card': defineComponent({ template: '<div><slot name="header" /><slot /></div>' }),
      },
    },
  })
  await flushPromises()
  return wrapper.vm as any
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.admin.mockResolvedValue({ data: { records: [], total: 0 } })
  mocks.adminDetail.mockImplementation(async (id: string) => ({ data: order(id) }))
  mocks.deliveryChannels.mockResolvedValue({
    data: {
      records: [{ id: 'channel-1', name: 'Test channel', channelType: 'standalone' }],
      total: 1,
    },
  })
  mocks.confirm.mockResolvedValue('confirm')
  mocks.prompt.mockResolvedValue({ value: 'test reason' })
  mocks.fulfill.mockResolvedValue({ data: order('order-1', 'fulfilled') })
})
afterEach(() => wrapper?.unmount())
describe('carpool delivery lifecycle', () => {
  it('loads fresh detail and uses one normalized ID for channels, delivery, and detail refresh', async () => {
    const vm = await mountView()
    await vm.openDetail('order-1')
    await vm.openFulfill(order(' order-1 '))
    expect(mocks.adminDetail).toHaveBeenLastCalledWith('order-1')
    expect(mocks.deliveryChannels).toHaveBeenCalledWith(1, 10, undefined, 'order-1')
    vm.selectedChannelId = 'channel-1'
    await vm.fulfill()
    expect(mocks.fulfill).toHaveBeenCalledWith('order-1', { relayChannelId: 'channel-1' })
    expect(mocks.adminDetail).toHaveBeenLastCalledWith('order-1')
    expect(mocks.admin).toHaveBeenCalledTimes(2)
    expect(vm.fulfillmentVisible).toBe(false)
    expect(mocks.vueError).not.toHaveBeenCalled()
  })
  it('does not switch the delivery ID when the drawer detail changes during confirmation', async () => {
    const vm = await mountView()
    await vm.openFulfill(order())
    vm.selectedChannelId = 'channel-1'
    mocks.confirm.mockImplementation(async () => {
      vm.detail = order('other-order')
      return 'confirm'
    })
    await vm.fulfill()
    expect(mocks.fulfill).toHaveBeenCalledWith('order-1', { relayChannelId: 'channel-1' })
  })
  it('resets an unavailable order without loading unscoped channels or raising a Vue error', async () => {
    const vm = await mountView()
    mocks.adminDetail.mockRejectedValueOnce(missing())
    await vm.openFulfill(order())
    expect(vm.fulfillmentOrderId).toBe('')
    expect(vm.fulfillmentVisible).toBe(false)
    expect(mocks.deliveryChannels).not.toHaveBeenCalled()
    expect(mocks.warning).toHaveBeenCalledWith(i18ns.t('carpool.manage.orderChanged'))
    expect(mocks.admin).toHaveBeenCalledTimes(2)
    expect(mocks.vueError).not.toHaveBeenCalled()
  })
  it('rejects a stale accepted list row when latest order state has changed', async () => {
    const vm = await mountView()
    mocks.adminDetail.mockResolvedValueOnce({ data: order('order-1', 'fulfilled') })
    await vm.openFulfill(order())
    expect(mocks.deliveryChannels).not.toHaveBeenCalled()
    expect(mocks.warning).toHaveBeenCalledWith(i18ns.t('carpool.manage.orderChanged'))
  })
  it('rechecks missing or changed orders after a final delivery failure', async () => {
    const vm = await mountView()
    await vm.openFulfill(order())
    vm.selectedChannelId = 'channel-1'
    mocks.fulfill.mockRejectedValueOnce(missing())
    mocks.adminDetail.mockRejectedValueOnce(missing())
    await vm.fulfill()
    expect(vm.fulfillmentVisible).toBe(false)
    expect(mocks.warning).toHaveBeenCalledWith(i18ns.t('carpool.manage.orderChanged'))
    expect(mocks.vueError).not.toHaveBeenCalled()
  })
  it('does not mislabel a channel 404 as a missing order', async () => {
    const vm = await mountView()
    const error = missing()
    mocks.deliveryChannels.mockRejectedValueOnce(error)
    await vm.openFulfill(order())
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(mocks.notice).toHaveBeenCalledWith(error, i18ns.t('carpool.manage.operationFailed'))
  })
  it('does not label successful delivery as failed when the subsequent refresh fails', async () => {
    const vm = await mountView()
    await vm.openDetail('order-1')
    await vm.openFulfill(order())
    vm.selectedChannelId = 'channel-1'
    mocks.adminDetail.mockRejectedValueOnce(missing())
    await vm.fulfill()
    expect(mocks.success).toHaveBeenCalledWith(i18ns.t('carpool.manage.delivered'))
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(mocks.notice).toHaveBeenCalledWith(
      expect.anything(),
      i18ns.t('carpool.common.loadFailed'),
    )
  })
  it.each(['cancel', 'close'])(
    'handles a user %s in delivery, accept, and refund confirmation',
    async (dismissal) => {
      const vm = await mountView()
      await vm.openFulfill(order())
      vm.selectedChannelId = 'channel-1'
      mocks.confirm.mockRejectedValue(dismissal)
      mocks.prompt.mockRejectedValue(dismissal)
      await vm.fulfill()
      await vm.accept(order())
      await vm.fail(order())
      expect(mocks.fulfill).not.toHaveBeenCalled()
      expect(mocks.accept).not.toHaveBeenCalled()
      expect(mocks.fail).not.toHaveBeenCalled()
      expect(mocks.notice).not.toHaveBeenCalled()
      expect(mocks.vueError).not.toHaveBeenCalled()
    },
  )
  it('does not reopen the dialog after its channel request was invalidated', async () => {
    const vm = await mountView()
    let resolve!: (value: unknown) => void
    mocks.deliveryChannels.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const pending = vm.openFulfill(order())
    await flushPromises()
    vm.resetFulfillment()
    resolve({ data: { records: [], total: 0 } })
    await pending
    expect(vm.fulfillmentVisible).toBe(false)
    expect(vm.channels).toEqual([])
  })
})
