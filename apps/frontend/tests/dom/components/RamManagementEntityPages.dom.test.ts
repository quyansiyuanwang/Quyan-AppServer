// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { api } = vi.hoisted(() => ({
  api: {
    listRolesPage: vi.fn(),
    listPoliciesPage: vi.fn(),
    listUsers: vi.fn(),
    listGroups: vi.fn(),
    listRoleBindings: vi.fn(),
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
const host = async (section: 'roles' | 'policies' | 'bindings') => {
  const component = section === 'roles' ? Roles : section === 'policies' ? Policies : Bindings
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
  api.listUsers.mockResolvedValue([])
  api.listGroups.mockResolvedValue([])
  api.listRoleBindings.mockResolvedValue([])
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
    let finish!: (rows: unknown[]) => void
    api.listRoleBindings.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const old = context.loadBindings()
    await view.get('[data-test="page-next"]').trigger('click')
    await flushPromises()
    expect(api.listRoleBindings).toHaveBeenLastCalledWith('second')
    finish([{ id: 'stale-binding' }])
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
})
