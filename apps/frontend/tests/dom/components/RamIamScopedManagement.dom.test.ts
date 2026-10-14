// @vitest-environment jsdom
import { computed, defineComponent, inject, provide } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { api, confirm, notice } = vi.hoisted(() => ({
  api: {
    listAuthorizationPage: vi.fn(),
    listUsersPage: vi.fn(),
    listRolesPage: vi.fn(),
    listPoliciesPage: vi.fn(),
    listVisibleGroupPage: vi.fn(),
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
const checkbox = defineComponent({
  props: ['modelValue', 'disabled'],
  emits: ['change'],
  template:
    '<label><input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'change\', $event.target.checked)" /><slot /></label>',
})
const stubs = {
  'el-input': input,
  'el-checkbox': checkbox,
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
  api.listResourceGroupPage.mockResolvedValue(page([{ id: 'group-1', name: 'Development' }]))
  api.listUsersPage.mockResolvedValue(page([{ id: 'user-1', username: 'User one' }]))
  api.listRolesPage.mockResolvedValue(page())
  api.listVisibleGroupPage.mockResolvedValue(page())
  api.listPoliciesPage.mockResolvedValue(
    page([{ id: 'policy-1', name: 'Policy one', permissions: [] }]),
  )
  api.listResourceGroupMemberPage.mockResolvedValue(page())
  confirm.mockResolvedValue('confirm')
})
describe('scoped RAM management', () => {
  it('submits exact group scope, reloads after creation and retains no stale rows after a list failure', async () => {
    const wrapper = mount(Authorizations, { global: { stubs } })
    await flushPromises()
    await wrapper.setProps({ selectedResourceGroup: { id: 'group-1' } })
    await flushPromises()
    await wrapper.get('[data-test="pick-user-1"] input').setValue(true)
    await wrapper.get('[data-test="pick-policy-1"] input').setValue(true)
    api.createAuthorization.mockResolvedValue({ id: 'authorization-1' })
    await wrapper.get('[data-test="authorization-create"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalled()
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
  it('requires confirmation, snapshots the full selection and retries only unsaved authorizations', async () => {
    api.listUsersPage.mockResolvedValue(
      page([
        { id: 'one', username: 'One' },
        { id: 'two', username: 'Two' },
      ]),
    )
    api.listPoliciesPage.mockResolvedValue(
      page([
        { id: 'a', name: 'A', permissions: [] },
        { id: 'b', name: 'B', permissions: [] },
      ]),
    )
    const wrapper = mount(Authorizations, { global: { stubs } })
    await flushPromises()
    expect(wrapper.get('[data-test="authorization-create"]').attributes('disabled')).toBeDefined()
    for (const id of ['one', 'two', 'a', 'b'])
      await wrapper.get('[data-test="pick-' + id + '"] input').setValue(true)
    confirm.mockRejectedValueOnce('cancel')
    await wrapper.get('[data-test="authorization-create"]').trigger('click')
    await flushPromises()
    expect(api.createAuthorization).not.toHaveBeenCalled()
    api.createAuthorization
      .mockResolvedValueOnce({ id: 'first' })
      .mockRejectedValueOnce(Error('fixture denied'))
      .mockResolvedValue({ id: 'remaining' })
    await wrapper.get('[data-test="authorization-create"]').trigger('click')
    await flushPromises()
    expect(api.createAuthorization).toHaveBeenCalledTimes(2)
    expect(notice).toHaveBeenCalled()
    expect(wrapper.get('[data-test="authorization-progress"]').text()).toContain(
      'RamManagement.authorizationProgress',
    )
    expect(wrapper.get('[data-test="pick-two"] input').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-test="authorization-create"]').trigger('click')
    await flushPromises()
    expect(
      api.createAuthorization.mock.calls.map(([body]) => [body.principalId, body.policyId]),
    ).toEqual([
      ['one', 'a'],
      ['one', 'b'],
      ['one', 'b'],
      ['two', 'a'],
      ['two', 'b'],
    ])
    expect(
      api.createAuthorization.mock.calls.every(
        ([body]) => body.scopeType === 'account' && !body.scopeArn && !body.scopeResourceId,
      ),
    ).toBe(true)
    expect(api.listAuthorizationPage).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })
  it('marks broad policies as high risk and requires a warning confirmation', async () => {
    api.listPoliciesPage.mockResolvedValue(
      page([
        {
          id: 'broad',
          name: 'Administrator',
          permissions: [],
          document: { Version: '1', Statement: { Effect: 'Allow', Action: '*', Resource: '*' } },
        },
      ]),
    )
    const wrapper = mount(Authorizations, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('RamManagement.authorizationHighRisk')
    await wrapper.get('[data-test="pick-user-1"] input').setValue(true)
    await wrapper.get('[data-test="pick-broad"] input').setValue(true)
    expect(wrapper.text()).toContain('RamManagement.authorizationHighRiskHint')
    api.createAuthorization.mockResolvedValue({ id: 'broad-relation' })
    await wrapper.get('[data-test="authorization-create"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(
      'RamManagement.authorizationConfirm',
      'RamManagement.scopedCreateAuthorization',
      { type: 'warning' },
    )
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
