// @vitest-environment jsdom
import { defineComponent, h, provide } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import RemoteTerminalManagementPagination from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/components/RemoteTerminalManagementPagination.vue'
import RemoteTerminalEntitlementSelect from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/components/RemoteTerminalEntitlementSelect.vue'
import { remoteTerminalProductManagementContextKey } from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/context'
import { useRemoteTerminalManagementList } from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/useRemoteTerminalManagementList'
import type { RemoteTerminalProductManagementState } from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/useRemoteTerminalProductManagement'
const Pagination = defineComponent({
  name: 'PaginationFixture',
  props: ['currentPage', 'pageSize', 'total', 'disabled'],
  emits: ['current-change', 'size-change'],
  template: '<div class="pagination-fixture" />',
})
const Select = defineComponent({
  name: 'SelectFixture',
  emits: ['visible-change'],
  template: '<div><slot/><slot name="footer"/></div>',
})
const Button = defineComponent({ template: '<button><slot/></button>' })
const Option = defineComponent({ props: ['label', 'value'], template: '<span>{{ label }}</span>' })
const fixture = async (selector = false) => {
  const source = vi.fn(async ({ page, pageSize }) => ({
    page,
    pageSize,
    total: 42,
    records: Array.from({ length: Math.min(pageSize, 42 - (page - 1) * pageSize) }, (_, index) => ({
      id: `row-${(page - 1) * pageSize + index}`,
      name: `Entitlement ${(page - 1) * pageSize + index}`,
    })),
  }))
  let state!: ReturnType<typeof useRemoteTerminalManagementList<{ id: string; name: string }>>
  const Host = defineComponent({
    setup() {
      state = useRemoteTerminalManagementList(
        source,
        () => 'actor',
        () => true,
      )
      provide(remoteTerminalProductManagementContextKey, {
        templateList: state,
        entitlementOptions: state,
      } as unknown as RemoteTerminalProductManagementState)
      return () =>
        h(
          selector ? RemoteTerminalEntitlementSelect : RemoteTerminalManagementPagination,
          selector ? {} : { section: 'templates' },
        )
    },
  })
  const wrapper = mount(Host, {
    global: {
      stubs: {
        'el-pagination': Pagination,
        'el-select': Select,
        'el-button': Button,
        'el-option': Option,
      },
    },
  })
  await state.load()
  await flushPromises()
  return { wrapper, state, source }
}
describe('terminal management pagination controls', () => {
  it('shows the authorized total and requests a page change', async () => {
    const { wrapper, source } = await fixture()
    expect(wrapper.findComponent(Pagination).props()).toMatchObject({
      currentPage: 1,
      pageSize: 20,
      total: 42,
      disabled: false,
    })
    wrapper.findComponent(Pagination).vm.$emit('current-change', 2)
    await flushPromises()
    expect(source).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 })
  })
  it('changes page size by fetching the first page', async () => {
    const { wrapper, source } = await fixture()
    wrapper.findComponent(Pagination).vm.$emit('size-change', 50)
    await flushPromises()
    expect(source).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 })
  })
  it('displays a failed refresh and retries without old totals', async () => {
    const { wrapper, state, source } = await fixture()
    source.mockRejectedValueOnce(new Error('denied'))
    await state.load()
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.findComponent(Pagination).props('total')).toBe(0)
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
  it('pages entitlement selector options independently of the table', async () => {
    const { wrapper, source } = await fixture(true)
    expect(wrapper.text()).toContain('Entitlement 0')
    wrapper.findComponent(Pagination).vm.$emit('current-change', 2)
    await flushPromises()
    expect(source).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 })
    expect(wrapper.text()).toContain('Entitlement 20')
    expect(wrapper.text()).not.toContain('Entitlement 0')
  })
  it('ignores pagination events caused by clearing a pending total', async () => {
    const { wrapper, state, source } = await fixture()
    state.loading.value = true
    await flushPromises()
    wrapper.findComponent(Pagination).vm.$emit('current-change', 1)
    wrapper.findComponent(Pagination).vm.$emit('size-change', 50)
    await flushPromises()
    expect(source).toHaveBeenCalledTimes(1)
  })
})
