// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { api } = vi.hoisted(() => ({
  api: {
    listRolesPage: vi.fn(),
    listPoliciesPage: vi.fn(),
    listUsersPage: vi.fn(),
    listSessionsPage: vi.fn(),
    getUserEffectivePermissions: vi.fn(),
    listVisibleGroupPage: vi.fn(),
    listRoleBindingsPage: vi.fn(),
  },
}))
vi.mock('@/service/ramService', () => ({ ramService: api }))
vi.mock('@/stores/userInfoStore', () => ({
  useUserInfoStore: () => ({ userInfo: { accountOwnerId: 'owner' } }),
}))
vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({ hasPermission: () => true, effectivePermissions: [] }),
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key, refer: { value: 'en' } } }))
vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { success: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: vi.fn() }))
vi.mock('@/views/management/ram-management/useIamPolicyEditor', () => ({
  useIamPolicyEditor: () => ({}),
  policyAuthorizationPayload: vi.fn(),
}))
vi.mock('@/views/management/ram-management/useIamPolicyTools', () => ({
  useIamPolicyTools: () => ({}),
}))
vi.mock('@/views/management/ram-management/useIamPolicyVersions', () => ({
  useIamPolicyVersions: () => ({}),
}))
import {
  useRamManagement,
  type RamManagementState,
} from '@/views/management/ram-management/useRamManagement'
let context: RamManagementState
vi.mock('@/views/management/ram-management/context', () => ({
  useRamManagementContext: () => context,
}))
import Roles from '@/views/management/ram-management/components/RamManagementRolesTab.vue'
import Policies from '@/views/management/ram-management/components/RamManagementPoliciesTab.vue'
import Users from '@/views/management/ram-management/components/RamManagementUsersTab.vue'
import Sessions from '@/views/management/ram-management/components/RamManagementSessionsTab.vue'
import Bindings from '@/views/management/ram-management/components/RamManagementBindingsTab.vue'
const role = (id: string) => ({
  id,
  name: id,
  permissions: [],
  accountOwnerId: 'owner',
  status: 1,
  createdAt: '',
  updatedAt: '',
  maxSessionDuration: 3600,
})
const page = (items: unknown[], number = 1, hasNext = false) => ({
  items,
  page: number,
  pageSize: 50,
  hasNext,
})
const button = defineComponent({
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
})
const stubs = {
  'el-button': button,
  'el-alert': { props: ['title'], template: '<div>{{ title }}</div>' },
  RamIamRoleTrustEditor: true,
}
const mounts: ReturnType<typeof mount>[] = []
const host = async (section: 'roles' | 'policies' | 'bindings' | 'users' | 'sessions') => {
  const component =
    section === 'roles'
      ? Roles
      : section === 'policies'
        ? Policies
        : section === 'users'
          ? Users
          : section === 'sessions'
            ? Sessions
            : Bindings
  const wrapper = mount(
    defineComponent({
      setup() {
        context = useRamManagement(section)
        return () => null
      },
    }),
  )
  mounts.push(wrapper)
  await flushPromises()
  const view = mount(component, { global: { stubs } })
  mounts.push(view)
  return view
}
beforeEach(() => {
  vi.resetAllMocks()
  api.listRolesPage.mockResolvedValue(page([]))
  api.listPoliciesPage.mockResolvedValue(page([]))
  api.listUsersPage.mockResolvedValue(page([]))
  api.listSessionsPage.mockResolvedValue(page([]))
  api.listVisibleGroupPage.mockResolvedValue(page([]))
  api.listRoleBindingsPage.mockResolvedValue(page([]))
})
afterEach(() => {
  for (const wrapper of mounts.splice(0)) wrapper.unmount()
})
describe('RAM role and policy candidate pages', () => {
  it('moves across an empty role page and clears selection from the previous page', async () => {
    api.listRolesPage
      .mockResolvedValueOnce(page([], 1, true))
      .mockResolvedValueOnce(page([role('later')], 2))
    const view = await host('roles')
    context.selectedRoles.value = [role('stale')]
    await view.get('[data-test="page-next"]').trigger('click')
    await flushPromises()
    expect(api.listRolesPage).toHaveBeenLastCalledWith({ page: 2, pageSize: 50 })
    expect(context.roles.value.map((item) => item.id)).toEqual(['later'])
    expect(context.selectedRoles.value).toEqual([])
    expect(context.selectedRoleId.value).toBe('later')
    expect(view.get('[data-test="page-next"]').attributes('disabled')).toBeDefined()
  })
  it('shows policy page failures with retry and does not keep stale documents', async () => {
    api.listPoliciesPage
      .mockResolvedValueOnce(page([{ id: 'policy' }], 1, true))
      .mockRejectedValueOnce(new Error('denied'))
    const view = await host('policies')
    await view.get('[data-test="page-next"]').trigger('click')
    await flushPromises()
    expect(context.policies.value).toEqual([])
    expect(view.text()).toContain('RamManagement.scopedLoadFailed')
    api.listPoliciesPage.mockResolvedValueOnce(page([], 1))
    await context.loadPolicies()
    await flushPromises()
    expect(context.policyPage.failed.value).toBe(false)
  })
  it('keeps role bindings selectable after page one and ignores a late response for the old role', async () => {
    api.listRolesPage
      .mockResolvedValueOnce(page([role('first')], 1, true))
      .mockResolvedValueOnce(page([role('second')], 2))
    const view = await host('bindings')
    let finish!: (result: unknown) => void
    api.listRoleBindingsPage.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const old = context.loadBindings()
    await view.get('[data-test="page-next"]').trigger('click')
    await flushPromises()
    expect(api.listRoleBindingsPage).toHaveBeenLastCalledWith('second', { page: 1, pageSize: 50 })
    finish(page([{ id: 'stale-binding' }]))
    await old
    expect(context.selectedRoleId.value).toBe('second')
    expect(context.bindings.value).toEqual([])
  })
  it('invalidates a role attachment target that is no longer on the displayed page', async () => {
    api.listRolesPage
      .mockResolvedValueOnce(page([role('first')], 1, true))
      .mockResolvedValueOnce(page([role('second')], 2))
    await host('roles')
    context.attachForm.targetType = 'role'
    context.attachForm.targetId = 'first'
    await context.loadRoles(2)
    expect(context.attachTargetOptions.value.map((item) => item.id)).toEqual(['second'])
    expect(context.attachForm.targetId).toBe('')
  })
  it('pages group options and clears targets that could otherwise refer to an old page', async () => {
    api.listVisibleGroupPage
      .mockResolvedValueOnce(page([{ id: 'first', name: 'First' }], 1, true))
      .mockResolvedValueOnce(page([{ id: 'second', name: 'Second' }], 2))
    await host('roles')
    context.bindMode.value = 'group'
    context.bindTargetId.value = 'first'
    context.attachForm.targetType = 'group'
    context.attachForm.targetId = 'first'
    context.userForm.groupId = 'first'
    await context.loadGroups(2)
    expect(api.listVisibleGroupPage).toHaveBeenLastCalledWith({ page: 2, pageSize: 50 })
    expect(context.bindOptions.value.map((item) => item.id)).toEqual(['second'])
    expect(context.attachTargetOptions.value.map((item) => item.id)).toEqual(['second'])
    expect(context.bindTargetId.value).toBe('')
    expect(context.attachForm.targetId).toBe('')
    expect(context.userForm.groupId).toBe('')
    api.listVisibleGroupPage.mockRejectedValueOnce(new Error('denied'))
    await context.loadGroups()
    expect(context.groups.value).toEqual([])
    expect(context.groupPage.failed.value).toBe(true)
  })
  it('pages users and clears selections, attachment targets and stale permission explanations', async () => {
    api.listUsersPage
      .mockResolvedValueOnce(page([{ id: 'first', username: 'first' }], 1, true))
      .mockResolvedValueOnce(page([{ id: 'second', username: 'second' }], 2))
    const view = await host('users')
    context.authUserId.value = 'first'
    let finish!: (result: unknown) => void
    api.getUserEffectivePermissions.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const old = context.loadEffectivePermissions()
    context.bindMode.value = 'user'
    context.bindTargetId.value = 'first'
    context.attachForm.targetType = 'user'
    context.attachForm.targetId = 'first'
    await view.get('[data-test="page-next"]').trigger('click')
    await flushPromises()
    finish({ ramUsername: 'first' })
    await old
    expect(api.listUsersPage).toHaveBeenLastCalledWith({ page: 2, pageSize: 50 })
    expect(context.users.value.map((item) => item.id)).toEqual(['second'])
    expect(context.effectivePerms.value).toBeNull()
    expect(context.authUserId.value).toBe('')
    expect(context.bindTargetId.value).toBe('')
    expect(context.attachForm.targetId).toBe('')
  })
  it('advances empty filtered session pages and clears stale sessions after denial', async () => {
    api.listSessionsPage
      .mockResolvedValueOnce(page([], 1, true))
      .mockResolvedValueOnce(page([{ id: 'later' }], 2))
      .mockRejectedValueOnce(new Error('denied'))
    const view = await host('sessions')
    await view.get('[data-test="page-next"]').trigger('click')
    await flushPromises()
    expect(api.listSessionsPage).toHaveBeenLastCalledWith({ page: 2, pageSize: 50 })
    expect(context.sessions.value.map((item) => item.id)).toEqual(['later'])
    await context.loadSessions()
    expect(context.sessions.value).toEqual([])
    expect(context.sessionPage.failed.value).toBe(true)
  })
  it('continues an empty binding page and resets to page one after changing its parent role', async () => {
    api.listRolesPage.mockResolvedValue(page([role('first'), role('second')]))
    api.listRoleBindingsPage
      .mockResolvedValueOnce(page([], 1, true))
      .mockResolvedValueOnce(page([{ id: 'visible-binding' }], 2))
    const view = await host('bindings')
    const controls = view.findAllComponents({ name: 'RamIamPageControls' })
    const bindingControls = controls[controls.length - 1]!
    bindingControls.vm.$emit('next')
    await flushPromises()
    expect(api.listRoleBindingsPage).toHaveBeenLastCalledWith('first', { page: 2, pageSize: 50 })
    expect(context.bindings.value.map((item) => item.id)).toEqual(['visible-binding'])
    context.selectedRoleId.value = 'second'
    context.changeBindingRole()
    await flushPromises()
    expect(api.listRoleBindingsPage).toHaveBeenLastCalledWith('second', { page: 1, pageSize: 50 })
    expect(context.bindings.value).toEqual([])
  })
})
