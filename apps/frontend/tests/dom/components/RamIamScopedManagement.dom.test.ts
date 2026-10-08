// @vitest-environment jsdom
import { computed, defineComponent, inject, provide } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { api, confirm, notice } = vi.hoisted(() => ({
  api: {
    listAuthorizationPage: vi.fn(),
    createAuthorization: vi.fn(),
    deleteAuthorization: vi.fn(),
    listResourceGroupPage: vi.fn(),
    createResourceGroup: vi.fn(),
    listResourceGroupMemberPage: vi.fn(),
    addResourceGroupMember: vi.fn(),
    removeResourceGroupMember: vi.fn(),
  },
  confirm: vi.fn(),
  notice: vi.fn(),
}))
vi.mock('@/service/ramService', () => ({ ramService: api }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessageBox: { confirm } }))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: notice }))
import Authorizations from '@/views/management/ram-management/components/RamIamScopedAuthorizations.vue'
import Groups from '@/views/management/ram-management/components/RamIamResourceGroups.vue'
const input = defineComponent({
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
})
const button = defineComponent({
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
})
const table = defineComponent({
  props: ['data'],
  setup(props) {
    provide('fixtureRows', () => props.data)
  },
  template: '<div><slot /></div>',
})
const column = defineComponent({
  setup() {
    const read = inject<() => unknown[]>('fixtureRows')!
    return { rows: computed(read) }
  },
  template: '<div><template v-for="row in rows"><slot :row="row" /></template></div>',
})
const stubs = {
  'el-input': input,
  'el-button': button,
  'el-table': table,
  'el-table-column': column,
  'el-alert': { props: ['title'], template: '<div>{{ title }}</div>' },
  RamIamPageControls: { template: '<div />' },
}
const page = (items: unknown[] = []) => ({ items, page: 1, pageSize: 50, hasNext: false })
const clickByText = (wrapper: ReturnType<typeof mount>, key: string) =>
  wrapper
    .findAll('button')
    .find((item) => item.text() === key)!
    .trigger('click')
beforeEach(() => {
  vi.resetAllMocks()
  api.listAuthorizationPage.mockResolvedValue(page())
  api.listResourceGroupPage.mockResolvedValue(page())
  api.listResourceGroupMemberPage.mockResolvedValue(page())
  confirm.mockResolvedValue('confirm')
})
describe('scoped RAM management', () => {
  it('submits exact group scope, reloads after creation and retains no stale rows after a list failure', async () => {
    const wrapper = mount(Authorizations, { global: { stubs } })
    await flushPromises()
    await wrapper.setProps({ selectedResourceGroup: { id: 'group-1' } })
    await wrapper.get('[data-test="authorization-principal"]').setValue('user-1')
    await wrapper.get('[data-test="authorization-policy"]').setValue('policy-1')
    api.createAuthorization.mockResolvedValue({ id: 'authorization-1' })
    await wrapper.get('[data-test="authorization-create"]').trigger('click')
    await flushPromises()
    expect(api.createAuthorization).toHaveBeenCalledWith({
      principalType: 'user',
      principalId: 'user-1',
      policyId: 'policy-1',
      scopeType: 'resource-group',
      scopeResourceId: 'group-1',
    })
    expect(api.listAuthorizationPage).toHaveBeenCalledTimes(2)
    api.listAuthorizationPage.mockRejectedValueOnce(new Error('fixture denied'))
    await wrapper.get('[data-test="authorization-load"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('RamManagement.scopedLoadFailed')
    wrapper.unmount()
  })
  it('requires confirmation before revocation and does not turn a denied mutation into success', async () => {
    api.listAuthorizationPage.mockResolvedValue(page([{ id: 'authorization-1' }]))
    const wrapper = mount(Authorizations, { global: { stubs } })
    await flushPromises()
    confirm.mockRejectedValueOnce('cancel')
    await clickByText(wrapper, 'RamManagement.scopedRevoke')
    await flushPromises()
    expect(api.deleteAuthorization).not.toHaveBeenCalled()
    api.deleteAuthorization.mockRejectedValueOnce(new Error('fixture deny'))
    await clickByText(wrapper, 'RamManagement.scopedRevoke')
    await flushPromises()
    expect(api.deleteAuthorization).toHaveBeenCalledWith('authorization-1')
    expect(notice).toHaveBeenCalled()
    expect(api.listAuthorizationPage).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('loads members only on selection, offers the group to authorization and refreshes after member changes', async () => {
    const group = { id: 'group-1', name: 'Development' }
    api.listResourceGroupPage.mockResolvedValue(page([group]))
    api.listResourceGroupMemberPage.mockResolvedValue(
      page([{ id: 'member-1', resourceArn: 'acs:quyan:*:owner:user/one' }]),
    )
    const wrapper = mount(Groups, { global: { stubs } })
    await flushPromises()
    expect(api.listResourceGroupMemberPage).not.toHaveBeenCalled()
    await clickByText(wrapper, 'RamManagement.scopedUseGroup')
    expect(wrapper.emitted('select')).toEqual([['group-1']])
    await clickByText(wrapper, 'RamManagement.scopedMembers')
    await flushPromises()
    expect(api.listResourceGroupMemberPage).toHaveBeenCalledWith('group-1', {
      page: 1,
      pageSize: 50,
    })
    await wrapper.get('[data-test="resource-member-arn"]').setValue('acs:quyan:*:owner:user/two')
    await wrapper.get('[data-test="resource-member-add"]').trigger('click')
    await flushPromises()
    expect(api.addResourceGroupMember).toHaveBeenCalledWith('group-1', 'acs:quyan:*:owner:user/two')
    await clickByText(wrapper, 'RamManagement.scopedRemoveMember')
    await flushPromises()
    expect(api.removeResourceGroupMember).toHaveBeenCalledWith('group-1', 'member-1')
    expect(api.listResourceGroupMemberPage).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })
  it('creates a resource group and loads its members through the paged endpoint', async () => {
    const wrapper = mount(Groups, { global: { stubs } })
    await flushPromises()
    api.createResourceGroup.mockResolvedValue({ id: 'new-group', name: 'Development' })
    await wrapper.get('[data-test="resource-group-name"]').setValue('Development')
    await wrapper.get('[data-test="resource-group-create"]').trigger('click')
    await flushPromises()
    expect(api.createResourceGroup).toHaveBeenCalledWith({ name: 'Development' })
    expect(api.listResourceGroupMemberPage).toHaveBeenCalledWith('new-group', {
      page: 1,
      pageSize: 50,
    })
    wrapper.unmount()
  })
})
