// @vitest-environment jsdom
import { defineComponent, h, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({
  identity: 'actor:v1',
  session: {} as any,
  permissions: {} as any,
  allowed: true,
  listTemplates: vi.fn(),
  listEntitlements: vi.fn(),
  listDevices: vi.fn(),
  getFilterOptions: vi.fn(),
  getAllUsers: vi.fn(),
  deleteTemplate: vi.fn(),
}))
vi.mock('@/service/remoteTerminalProductService', () => ({ remoteTerminalProductService: fixture }))
vi.mock('@/service/userService', () => ({ userService: { getAllUsers: fixture.getAllUsers } }))
vi.mock('@/service/permissionService', () => ({
  permissionService: { ensureLoaded: async () => {} },
}))
vi.mock('@/service/sessionCoordinator', () => ({
  sessionCoordinator: { getAuthorizationIdentity: () => fixture.identity },
}))
vi.mock('@/stores/sessionStore', () => ({ useSessionStore: () => fixture.session }))
vi.mock('@/stores/permissionStore', () => ({ usePermissionStore: () => fixture.permissions }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: async () => {} },
}))
import {
  useRemoteTerminalProductManagement,
  type RemoteTerminalProductManagementSection,
  type RemoteTerminalProductManagementState,
} from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/useRemoteTerminalProductManagement'
const mounted: ReturnType<typeof mount>[] = []
const page = ({ page, pageSize }: { page: number; pageSize: number }) => ({
  page,
  pageSize,
  total: 45,
  records: Array.from({ length: Math.min(pageSize, 45 - (page - 1) * pageSize) }, (_, index) => ({
    id: `row-${(page - 1) * pageSize + index}`,
    userId: 'customer',
    name: 'fixture',
  })),
})
const host = async (section: RemoteTerminalProductManagementSection) => {
  let state!: RemoteTerminalProductManagementState
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useRemoteTerminalProductManagement(section)
        return () => h('div')
      },
    }),
  )
  mounted.push(wrapper)
  await flushPromises()
  return state
}
beforeEach(() => {
  vi.resetAllMocks()
  fixture.identity = 'actor:v1'
  fixture.allowed = true
  fixture.session = reactive({ accessToken: 'fixture-token' })
  fixture.permissions = reactive({
    currentUserPermissions: { version: 1 },
    hasPermission: () => {
      void fixture.permissions.currentUserPermissions
      return fixture.allowed
    },
  })
  for (const method of [fixture.listTemplates, fixture.listEntitlements, fixture.listDevices])
    method.mockImplementation(async (params) => page(params))
  fixture.getFilterOptions.mockImplementation(async (params) => ({
    templateStatusOptions: [],
    assignmentStatusOptions: [],
    deviceStatusOptions: [],
    publishStatusOptions: [],
    templates: [],
    templatePage: params.page,
    templatePageSize: params.pageSize,
    templateTotal: 0,
  }))
  fixture.getAllUsers.mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 20 })
  fixture.deleteTemplate.mockResolvedValue(undefined)
})
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
})
describe('terminal management list integration', () => {
  it.each(['templates', 'entitlements', 'devices'] as const)(
    'requests paginated %s on mount',
    async (section) => {
      await host(section)
      const method =
        section === 'templates'
          ? fixture.listTemplates
          : section === 'entitlements'
            ? fixture.listEntitlements
            : fixture.listDevices
      expect(method).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }))
    },
  )
  it('resets template filters to page one with new server criteria', async () => {
    const state = await host('templates')
    await state.templateList.changePage(2)
    state.templateKeyword.value = 'updated'
    await flushPromises()
    expect(fixture.listTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, keyword: 'updated' }),
    )
  })
  it('resets entitlement filters without borrowing another section page', async () => {
    const state = await host('entitlements')
    await state.entitlementList.changePage(2)
    state.entitlementFilter.status = 0
    await flushPromises()
    expect(fixture.listEntitlements).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, status: 0 }),
    )
  })
  it('has independent entitlement options and clears selection when device user changes', async () => {
    const state = await host('devices')
    await state.deviceList.changePage(2)
    await state.entitlementOptions.changePage(2)
    state.deviceFilter.entitlementId = 'old-selection'
    state.deviceFilter.userId = 'selected-user'
    await flushPromises()
    expect(state.deviceFilter.entitlementId).toBeUndefined()
    expect(fixture.listDevices).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, userId: 'selected-user' }),
    )
    expect(fixture.listEntitlements).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, userId: 'selected-user' }),
    )
  })
  it('refreshes the current table page after a successful mutation', async () => {
    const state = await host('templates')
    await state.templateList.changePage(2)
    await state.handleDeleteTemplate('row-20')
    expect(fixture.deleteTemplate).toHaveBeenCalledWith('row-20')
    expect(fixture.listTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, pageSize: 20 }),
    )
  })
  it.each(['identity', 'permission'])(
    'clears all cached views and dialogs on %s changes',
    async (kind) => {
      const state = await host('devices')
      state.templateDialogVisible.value = true
      state.entitlementDialogVisible.value = true
      state.tokenDialogVisible.value = true
      state.limitAdjustDialogVisible.value = true
      if (kind === 'identity') {
        fixture.identity = 'other:v1'
        fixture.session.accessToken = 'changed-fixture-token'
      } else {
        fixture.allowed = false
        fixture.permissions.currentUserPermissions = { version: 2 }
      }
      expect(state.devices.value).toEqual([])
      expect(state.entitlementOptions.records.value).toEqual([])
      expect(state.userOptions.value).toEqual([])
      expect(state.deviceList.total.value).toBe(0)
      expect([
        state.templateDialogVisible.value,
        state.entitlementDialogVisible.value,
        state.tokenDialogVisible.value,
        state.limitAdjustDialogVisible.value,
      ]).toEqual([false, false, false, false])
    },
  )
  it('discards user choices when permissions change during their request', async () => {
    const state = await host('entitlements')
    let finish!: (value: any) => void
    fixture.getAllUsers.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    state.handleUserSearch('customer')
    fixture.permissions.currentUserPermissions = { version: 2 }
    finish({
      users: [{ id: 'old-user', username: 'OLD-PRIVATE-LABEL' }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    await flushPromises()
    expect(state.userOptions.value).toEqual([])
  })
  it('pages server user candidates without widening management permissions', async () => {
    fixture.getAllUsers.mockImplementation(async (params) => {
      const result = page(params)
      return { ...result, users: result.records.map((row) => ({ id: row.id, username: row.id })) }
    })
    const state = await host('entitlements')
    expect(state.userChoices.total.value).toBe(45)
    await state.userChoices.changePage(2)
    expect(fixture.getAllUsers).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 20,
      keyword: undefined,
    })
    expect(state.userOptions.value[0]!.id).toBe('row-20')
    state.handleUserSearch('customer')
    await flushPromises()
    expect(fixture.getAllUsers).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      keyword: 'customer',
    })
  })
  it('does not substitute table usernames when the user directory denies access', async () => {
    fixture.getAllUsers.mockRejectedValue(new Error('denied user directory'))
    const state = await host('devices')
    expect(state.devices.value).toHaveLength(20)
    expect(state.userOptions.value).toEqual([])
    expect(state.userChoices.failed.value).toBe(true)
  })
})
