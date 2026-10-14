// @vitest-environment jsdom
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RemoteTerminalTemplateSelect from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/components/RemoteTerminalTemplateSelect.vue'
const fixture = vi.hoisted(() => ({ context: null as unknown, load: vi.fn() }))
vi.mock(
  '@/views/products/remote-terminal-cloud/remote-terminal-product-management/context',
  () => ({
    useRemoteTerminalProductManagementContext: () => fixture.context,
  }),
)
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
const select = {
  name: 'OptionsSelectFixture',
  props: ['remoteMethod', 'modelValue', 'loading'],
  emits: ['visible-change', 'update:modelValue'],
  template: '<div><slot /><slot name="footer" /></div>',
}
const pager = {
  name: 'OptionsPagerFixture',
  props: ['currentPage', 'pageSize', 'total', 'disabled'],
  emits: ['current-change'],
  template: '<div />',
}
const mountSelector = () =>
  mount(RemoteTerminalTemplateSelect, {
    global: {
      stubs: {
        'el-select': select,
        'el-pagination': pager,
        'el-option': true,
        'el-button': { template: '<button><slot /></button>' },
      },
    },
  })
beforeEach(() => {
  vi.resetAllMocks()
  fixture.context = {
    filterOptions: { templates: [{ id: 'admitted', name: 'Admitted template' }] },
    templateOptions: {
      page: ref(2),
      pageSize: 20,
      total: ref(45),
      loading: ref(false),
      failed: ref(false),
    },
    loadTemplateOptions: fixture.load,
  }
})
describe('terminal template selector paging', () => {
  it('loads options when opened and restarts search on page one', () => {
    const wrapper = mountSelector(),
      element = wrapper.findComponent({ name: 'OptionsSelectFixture' })
    element.vm.$emit('visible-change', true)
    expect(fixture.load).toHaveBeenCalledWith()
    element.props('remoteMethod')('starter')
    expect(fixture.load).toHaveBeenLastCalledWith(1, 'starter')
  })
  it('shows admitted totals and forwards page changes to the server', () => {
    const wrapper = mountSelector(),
      element = wrapper.findComponent({ name: 'OptionsPagerFixture' })
    expect(element.props()).toMatchObject({
      currentPage: 2,
      pageSize: 20,
      total: 45,
      disabled: false,
    })
    element.vm.$emit('current-change', 3)
    expect(fixture.load).toHaveBeenCalledWith(3)
  })
  it('exposes failure and retries the current page', async () => {
    const state = fixture.context as { templateOptions: { failed: { value: boolean } } }
    state.templateOptions.failed.value = true
    const wrapper = mountSelector()
    expect(wrapper.find('[role="alert"]').text()).toContain('remoteTerminalProduct.refreshFailed')
    expect(wrapper.findComponent({ name: 'OptionsPagerFixture' }).exists()).toBe(false)
    await wrapper.find('button').trigger('click')
    expect(fixture.load).toHaveBeenCalledWith(2)
  })
})
