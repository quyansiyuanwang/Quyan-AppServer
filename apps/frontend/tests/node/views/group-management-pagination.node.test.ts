import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), error: vi.fn() }))
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onMounted: vi.fn(),
}))
vi.mock('@/service/groupService', () => ({ groupService: { getAllGroups: mocks.list } }))
vi.mock('@/composables/usePageDevice', () => ({ usePageDevice: () => ({ isDesktop: true }) }))
vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({ hasPermission: () => false }),
}))
vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { error: mocks.error },
  ElMessageBox: {},
}))
vi.mock('@/utils/error-utils', () => ({ getErrorMessage: () => 'Load failed' }))
vi.mock('@/locales', () => ({ i18ns: { refer: { value: 'en' }, t: (key: string) => key } }))
import { useGroupManagement } from '@/views/management/group-management/useGroupManagement'
beforeEach(() => vi.clearAllMocks())
describe('group management candidate pagination', () => {
  it('advances from an empty IAM-filtered page without inventing a total', async () => {
    mocks.list
      .mockResolvedValueOnce({ groups: [], page: 1, pageSize: 10, hasMore: true })
      .mockResolvedValueOnce({ groups: [{ id: 'allowed' }], page: 2, pageSize: 10, hasMore: false })
    const state = useGroupManagement()
    await state.loadGroups()
    expect(state.totalKnown.value).toBe(false)
    expect(state.hasMore.value).toBe(true)
    state.pagination.value.page = 2
    await state.loadGroups()
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 10 }))
    expect(state.groupList.value).toEqual([{ id: 'allowed' }])
    expect(state.hasMore.value).toBe(false)
  })
  it('retains exact legacy totals', async () => {
    mocks.list.mockResolvedValueOnce({ groups: [], total: 120, hasMore: true })
    const state = useGroupManagement()
    await state.loadGroups()
    expect(state.totalKnown.value).toBe(true)
    expect(state.displayTotal.value).toBe(120)
  })
  it('ignores a late prior-page response', async () => {
    let finish!: (value: unknown) => void
    mocks.list
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        }),
      )
      .mockResolvedValueOnce({ groups: [{ id: 'current' }], hasMore: false })
    const state = useGroupManagement()
    const prior = state.loadGroups()
    state.pagination.value.page = 2
    await state.loadGroups()
    finish({ groups: [{ id: 'old' }], total: 999, hasMore: true })
    await prior
    expect(state.groupList.value).toEqual([{ id: 'current' }])
    expect(state.totalKnown.value).toBe(false)
    expect(state.hasMore.value).toBe(false)
    expect(state.loading.value).toBe(false)
  })
  it('clears rows on load failure and permits retry', async () => {
    mocks.list
      .mockResolvedValueOnce({ groups: [{ id: 'old' }], hasMore: true })
      .mockRejectedValueOnce(new Error('fixture'))
      .mockResolvedValueOnce({ groups: [{ id: 'retry' }], hasMore: false })
    const state = useGroupManagement()
    await state.loadGroups()
    await state.loadGroups()
    expect(state.groupList.value).toEqual([])
    expect(state.hasMore.value).toBe(false)
    expect(state.loading.value).toBe(false)
    await state.loadGroups()
    expect(state.groupList.value).toEqual([{ id: 'retry' }])
  })
})
