// @vitest-environment jsdom
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), error: vi.fn() }))
const desktop = ref(true)
vi.mock('@/composables/usePageDevice', () => ({ usePageDevice: () => ({ isDesktop: desktop }) }))
vi.mock('@/service/accesskeyService', () => ({
  AccessKeyService: { getInstance: () => ({ getAccessKeysPage: mocks.list }) },
}))
vi.mock('@/service/twoFactor/twoFactorManagementService', () => ({
  twoFactorManagementService: { getStatus: async () => ({ enabled: false }) },
}))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { error: mocks.error },
  ElMessageBox: {},
}))
import View from '@/views/settings/AccessKeyManagementView.vue'
const Controls = defineComponent({
  name: 'RamIamPageControls',
  props: ['page', 'pageSize', 'hasNext', 'loading'],
  emits: ['previous', 'next', 'size'],
  template: '<div />',
})
const Slot = defineComponent({ template: '<div><slot name="header" /><slot /></div>' })
const mountView = () =>
  mount(View, {
    global: {
      stubs: {
        RamIamPageControls: Controls,
        TwoFactorGuardedVerificationField: true,
        ElCard: Slot,
        ElSkeleton: Slot,
        ElTable: true,
        ElTableColumn: true,
        ElDialog: true,
        ElButton: Slot,
        ElEmpty: true,
      },
      directives: { loading: () => undefined },
    },
  })
let view: ReturnType<typeof mountView> | undefined
beforeEach(() => {
  vi.clearAllMocks()
  desktop.value = true
})
afterEach(() => {
  view?.unmount()
  view = undefined
})
describe('AccessKey view server pagination wiring', () => {
  it.each([true, false])(
    'keeps empty filtered pages navigable on desktop=%s',
    async (isDesktop) => {
      desktop.value = isDesktop
      mocks.list
        .mockResolvedValueOnce({ items: [], page: 1, pageSize: 50, hasNext: true })
        .mockResolvedValueOnce({ items: [], page: 2, pageSize: 50, hasNext: false })
        .mockResolvedValueOnce({ items: [], page: 1, pageSize: 25, hasNext: false })
      view = mountView()
      await flushPromises()
      const controls = view.findComponent(Controls)
      expect(controls.props()).toMatchObject({ page: 1, hasNext: true, loading: false })
      controls.vm.$emit('next')
      await flushPromises()
      expect(mocks.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 50 })
      controls.vm.$emit('size', 25)
      await flushPromises()
      expect(mocks.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 25 })
      expect(controls.props()).toMatchObject({ page: 1, pageSize: 25, hasNext: false })
    },
  )
  it('shows a retryable load error and never displays stale mobile key rows', async () => {
    desktop.value = false
    mocks.list
      .mockResolvedValueOnce({
        items: [{ id: 'visible', name: 'Visible key', key: 'masked-value', requestCount: 0 }],
        page: 1,
        pageSize: 50,
        hasNext: true,
      })
      .mockRejectedValueOnce(new Error('fixture'))
    view = mountView()
    await flushPromises()
    expect(view.text()).toContain('masked-value')
    view.findComponent(Controls).vm.$emit('next')
    await flushPromises()
    expect(view.text()).not.toContain('masked-value')
    expect(mocks.error).toHaveBeenCalledWith('accesskey.loadFailed')
    expect(view.findComponent(Controls).props('loading')).toBe(false)
  })
})
