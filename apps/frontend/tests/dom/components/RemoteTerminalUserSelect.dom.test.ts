// @vitest-environment jsdom
import { defineComponent, h, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import RemoteTerminalUserSelect from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/components/RemoteTerminalUserSelect.vue'
import RemoteTerminalProductDevicesTab from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/components/RemoteTerminalProductDevicesTab.vue'
import { remoteTerminalProductManagementContextKey } from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/context'
import { useRemoteTerminalManagementList } from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/useRemoteTerminalManagementList'
import type { RemoteTerminalProductManagementState } from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/useRemoteTerminalProductManagement'
const Pagination = defineComponent({
  name: 'UserPaginationFixture',
  props: ['currentPage', 'pageSize', 'total', 'disabled'],
  emits: ['current-change'],
  template: '<div/>',
})
const Select = defineComponent({
  name: 'UserSelectFixture',
  props: ['remoteMethod'],
  emits: ['visible-change'],
  template: '<div><slot/><slot name="footer"/></div>',
})
const Option = defineComponent({ props: ['label', 'value'], template: '<span>{{ label }}</span>' })
const Button = defineComponent({ template: '<button><slot/></button>' })
const fixture = async () => {
  let identity = 'actor',
    choices!: ReturnType<typeof useRemoteTerminalManagementList<{ id: string; username: string }>>
  const selected = ref<{ id: string; username: string }>(),
    model = ref<string>(),
    source = vi.fn(async ({ page, pageSize }) => ({
      page,
      pageSize,
      total: 42,
      records: Array.from(
        { length: Math.min(pageSize, 42 - (page - 1) * pageSize) },
        (_, index) => ({
          id: `user-${(page - 1) * pageSize + index}`,
          username: `User ${(page - 1) * pageSize + index}`,
        }),
      ),
    }))
  const search = vi.fn()
  const Host = defineComponent({
    setup() {
      choices = useRemoteTerminalManagementList(
        source,
        () => identity,
        () => true,
      )
      provide(remoteTerminalProductManagementContextKey, {
        userChoices: choices,
        selectedUserOption: selected,
        handleUserSearch: search,
      } as unknown as RemoteTerminalProductManagementState)
      return () =>
        h(RemoteTerminalUserSelect, {
          modelValue: model.value,
          'onUpdate:modelValue': (value) => {
            model.value = value
          },
        })
    },
  })
  const wrapper = mount(Host, {
    global: {
      stubs: {
        'el-pagination': Pagination,
        'el-select': Select,
        'el-option': Option,
        'el-button': Button,
      },
    },
  })
  await choices.load()
  await flushPromises()
  return {
    wrapper,
    choices,
    source,
    selected,
    model,
    search,
    invalidate: () => {
      identity = 'other'
      choices.reset()
      selected.value = undefined
    },
  }
}
describe('terminal management user selector', () => {
  it('fetches later user pages and displays the authorized total', async () => {
    const { wrapper, source } = await fixture()
    expect(wrapper.findComponent(Pagination).props('total')).toBe(42)
    wrapper.findComponent(Pagination).vm.$emit('current-change', 2)
    await flushPromises()
    expect(source).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 })
    expect(wrapper.text()).toContain('User 20')
    expect(wrapper.text()).not.toContain('User 0')
  })
  it('sends remote search through the management source', async () => {
    const { wrapper, search } = await fixture()
    wrapper.findComponent(Select).props('remoteMethod')('customer')
    expect(search).toHaveBeenCalledWith('customer')
  })
  it('retains only the currently selected permitted record label', async () => {
    const { wrapper, selected, model } = await fixture()
    selected.value = { id: 'known-user', username: 'Permitted selected label' }
    model.value = 'known-user'
    await flushPromises()
    expect(wrapper.text()).toContain('Permitted selected label')
    model.value = 'other-user'
    await flushPromises()
    expect(wrapper.text()).not.toContain('Permitted selected label')
  })
  it('clears selected and candidate labels on identity invalidation', async () => {
    const { wrapper, selected, model, invalidate } = await fixture()
    selected.value = { id: 'known-user', username: 'Old label' }
    model.value = 'known-user'
    await flushPromises()
    invalidate()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Old label')
    expect(wrapper.text()).not.toContain('User 0')
  })
  it('displays a retry after directory denial without keeping old choices', async () => {
    const { wrapper, source, choices } = await fixture()
    source.mockRejectedValueOnce(new Error('denied'))
    await choices.load()
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('User 0')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
  it('binds device columns to the actual DTO rather than legacy display fields', () => {
    const Column = defineComponent({
        name: 'DeviceColumnFixture',
        props: ['prop'],
        template: '<span/>',
      }),
      Table = defineComponent({ template: '<div><slot/></div>' })
    const Host = defineComponent({
      setup() {
        provide(remoteTerminalProductManagementContextKey, {
          deviceFilter: {},
          filterOptions: { deviceStatusOptions: [] },
          devices: ref([]),
          deviceList: { loading: ref(false) },
          canWriteDevice: ref(false),
          formatDateTime: vi.fn(),
          handleRevokeDevice: vi.fn(),
        } as unknown as RemoteTerminalProductManagementState)
        return () => h(RemoteTerminalProductDevicesTab)
      },
    })
    const wrapper = mount(Host, {
      global: {
        stubs: {
          RemoteTerminalUserSelect: true,
          RemoteTerminalEntitlementSelect: true,
          RemoteTerminalManagementPagination: true,
          'el-table': Table,
          'el-table-column': Column,
        },
      },
    })
    const properties = wrapper.findAllComponents(Column).map((column) => column.props('prop'))
    expect(properties).toContain('hostname')
    expect(properties).toContain('deviceId')
    expect(properties).not.toContain('deviceName')
    expect(properties).not.toContain('clientDeviceId')
    expect(properties).not.toContain('bindingStatusLabel')
  })
})
