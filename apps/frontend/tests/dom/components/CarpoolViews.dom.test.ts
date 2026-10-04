// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n, i18ns } from '@/locales'
import { useSessionStore } from '@/stores/sessionStore'
const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  catalog: vi.fn(),
  mine: vi.fn(),
  acceptInvite: vi.fn(),
  allocate: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  confirmBox: vi.fn(),
  notice: vi.fn(),
  warning: vi.fn(),
  push: vi.fn(),
}))
vi.mock('@/service/carpoolService', () => ({ carpoolService: mocks }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'order-1', token: 'test-invite' }, fullPath: '/test-invite' }),
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { success: vi.fn(), warning: mocks.warning },
  ElMessageBox: { confirm: mocks.confirmBox, alert: vi.fn() },
}))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: mocks.notice }))
import CarpoolDetailView from '@/views/relay/CarpoolDetailView.vue'
import CarpoolInviteView from '@/views/relay/CarpoolInviteView.vue'
import CarpoolView from '@/views/relay/CarpoolView.vue'
const member = {
  id: 'member-1',
  userId: 'user-1',
  username: 'Test member',
  role: 'owner',
  state: 'pending',
  paymentRatio: 100,
  quotaRatio: 100,
  payableAmount: 120,
  finalQuota: 900,
  reservedAmount: 0,
}
const order = {
  id: 'order-1',
  state: 'open',
  packageName: 'Test package',
  maxMembers: 3,
  activeMemberCount: 1,
  allConfirmed: false,
  members: [member],
  events: [],
  totalQuota: 900,
  quotaUnit: 'credits',
  salePrice: 120,
  validityDays: 30,
  allocationMode: 'equal',
  viewerActions: { canConfirm: true, canCancel: true, canInvite: true, canAllocate: true },
}
const stubs = {
  'el-table-column': defineComponent({ template: '<div />' }),
  'el-card': defineComponent({
    template: '<div class="el-card"><slot name="header" /><slot /></div>',
  }),
  'el-button': defineComponent({
    props: ['disabled', 'loading'],
    emits: ['click'],
    template: `<button :disabled="disabled || loading" @click="$emit('click')"><slot /></button>`,
  }),
  'router-link': defineComponent({ template: '<a><slot /></a>' }),
}
let wrapper: VueWrapper
beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  mocks.detail.mockResolvedValue({ data: structuredClone(order) })
  mocks.mine.mockResolvedValue({ data: { records: [order], total: 1 } })
  mocks.catalog.mockResolvedValue({ data: { records: [], total: 0 } })
  mocks.acceptInvite.mockResolvedValue({ data: order })
  mocks.confirmBox.mockResolvedValue('confirm')
})
afterEach(() => wrapper?.unmount())
const render = async (component: any) => {
  wrapper = mount(component, { global: { plugins: [i18n], stubs } })
  await flushPromises()
  return wrapper.vm as any
}
describe('guided carpool views', () => {
  it('surfaces the primary next step and preserves mobile allocation details', async () => {
    await render(CarpoolDetailView)
    expect(wrapper.find('.next-action-card').text()).toContain(i18ns.t('carpool.next.confirm'))
    expect(wrapper.find('.mobile-members').text()).toContain('100%')
    expect(wrapper.find('.mobile-members').text()).toContain('900 credits')
    expect(wrapper.findAll('.carpool-workflow li')).toHaveLength(5)
    expect(wrapper.find('.member-card').text()).toContain(i18ns.t('carpool.member.pending'))
  })
  it.each(['cancel', 'close'])(
    'does not report a user %s from detail confirmations or mode switching',
    async (dismissal) => {
      const vm = await render(CarpoolDetailView)
      mocks.confirmBox.mockRejectedValue(dismissal)
      await vm.runConfirm('test confirm', () => mocks.cancel('order-1'), 'success')
      await vm.setMode('custom')
      expect(mocks.cancel).not.toHaveBeenCalled()
      expect(mocks.allocate).not.toHaveBeenCalled()
      expect(mocks.notice).not.toHaveBeenCalled()
      expect(vm.order.allocationMode).toBe('equal')
    },
  )
  it('shows real API failures locally instead of treating them as cancellation', async () => {
    const vm = await render(CarpoolDetailView)
    const error = new Error('API failed')
    await vm.runConfirm(
      'test confirm',
      async () => {
        throw error
      },
      'success',
    )
    expect(mocks.notice).toHaveBeenCalledWith(error, i18ns.t('operationFailed'))
  })
  it('displays five steps and an accessible mobile next-action button in the catalog', async () => {
    await render(CarpoolView)
    expect(wrapper.findAll('.carpool-workflow li')).toHaveLength(5)
    expect(wrapper.find('.mobile-order-list').text()).toContain(i18ns.t('carpool.next.confirm'))
    await wrapper.find('.mobile-order-list button').trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({ name: 'carpoolDetail', params: { id: 'order-1' } })
  })
  it('reacts to login state and displays the actual order summary only after acceptance', async () => {
    const vm = await render(CarpoolInviteView)
    expect(wrapper.text()).not.toContain(order.packageName)
    expect(wrapper.text()).toContain(i18ns.t('carpool.invite.previewUnavailable'))
    await vm.accept()
    expect(mocks.acceptInvite).not.toHaveBeenCalled()
    useSessionStore().setAuthenticated('test-token')
    await flushPromises()
    await vm.accept()
    expect(mocks.acceptInvite).toHaveBeenCalledWith('test-invite')
    await flushPromises()
    expect(wrapper.text()).toContain(order.packageName)
    expect(wrapper.text()).toContain('900 credits')
    await vm.continueToOrder()
    expect(mocks.push).toHaveBeenCalledWith({ name: 'carpoolDetail', params: { id: 'order-1' } })
  })
})
