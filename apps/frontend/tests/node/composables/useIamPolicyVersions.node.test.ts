import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIamPolicyVersions } from '@/views/management/ram-management/useIamPolicyVersions'
import type { RamPolicyDto, RamPolicyVersionDto, RamPolicyVersionPageDto } from '@/client/types.gen'
const { listPolicyVersions, setDefaultPolicyVersion, confirm } = vi.hoisted(() => ({
  listPolicyVersions: vi.fn(),
  setDefaultPolicyVersion: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('@/service/ramService', () => ({
  ramService: { listPolicyVersions, setDefaultPolicyVersion },
}))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessageBox: { confirm } }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
const policy: RamPolicyDto = {
  id: 'p1',
  accountOwnerId: 'owner',
  status: 1,
  name: 'policy',
  permissions: [],
  type: 'custom',
  documentHash: 'old-list-hash',
  createTime: '',
  updateTime: '',
}
const version: RamPolicyVersionDto = {
  id: 'v1',
  version: 1,
  isDefault: false,
  documentHash: 'b'.repeat(64),
  createdBy: 'owner',
  createTime: '',
  document: { Version: '1', Statement: { Effect: 'Deny', Action: '*', Resource: '*' } },
}
const page: RamPolicyVersionPageDto = {
  items: [version],
  page: 1,
  pageSize: 20,
  total: 41,
  defaultDocumentHash: 'a'.repeat(64),
}
beforeEach(() => {
  vi.resetAllMocks()
  listPolicyVersions.mockResolvedValue(page)
  confirm.mockResolvedValue(undefined)
})
const createState = () => {
  const onChanged = vi.fn().mockResolvedValue(undefined)
  return { state: useIamPolicyVersions({ canUpdate: () => true, onChanged }), onChanged }
}
describe('IAM policy version history', () => {
  it('requests pages from the server and resets to page 1 when page size changes', async () => {
    const { state } = createState()
    await state.openIamPolicyVersions(policy)
    expect(state.iamVersionTotal.value).toBe(41)
    listPolicyVersions.mockResolvedValueOnce({ ...page, page: 3 })
    await state.changeIamVersionPage(3)
    expect(listPolicyVersions).toHaveBeenLastCalledWith('p1', { page: 3, pageSize: 20 })
    await state.changeIamVersionPageSize(50)
    expect(listPolicyVersions).toHaveBeenLastCalledWith('p1', { page: 1, pageSize: 50 })
  })
  it('requires confirmation and restores with the history snapshot hash, then refreshes both lists', async () => {
    const { state, onChanged } = createState()
    await state.openIamPolicyVersions(policy)
    await state.restoreIamPolicyVersion(version)
    expect(confirm).toHaveBeenCalledOnce()
    expect(setDefaultPolicyVersion).toHaveBeenCalledWith('p1', {
      versionId: 'v1',
      expectedDocumentHash: page.defaultDocumentHash,
    })
    expect(listPolicyVersions).toHaveBeenCalledTimes(2)
    expect(onChanged).toHaveBeenCalledOnce()
  })
  it('never retries a conflict automatically and requires an explicit refresh', async () => {
    const { state } = createState()
    await state.openIamPolicyVersions(policy)
    setDefaultPolicyVersion.mockRejectedValue(new Error('Conflict'))
    await state.restoreIamPolicyVersion(version)
    expect(state.iamVersionRestoreFailed.value).toBe(true)
    expect(state.iamDefaultDocumentHash.value).toBeUndefined()
    await state.restoreIamPolicyVersion(version)
    expect(setDefaultPolicyVersion).toHaveBeenCalledOnce()
    await state.loadIamPolicyVersions()
    expect(state.iamVersionRestoreFailed.value).toBe(false)
    expect(state.iamDefaultDocumentHash.value).toBe(page.defaultDocumentHash)
  })
  it('does not restore managed policies, default versions, arbitrary versions or without update permission', async () => {
    for (const [canUpdate, type, selected] of [
      [false, 'custom', version],
      [true, 'system', version],
      [true, 'custom', { ...version, isDefault: true }],
      [true, 'custom', { ...version, id: 'other' }],
    ] as const) {
      const state = useIamPolicyVersions({ canUpdate: () => canUpdate, onChanged: vi.fn() })
      await state.openIamPolicyVersions({ ...policy, type })
      await state.restoreIamPolicyVersion(selected)
    }
    expect(setDefaultPolicyVersion).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
  it('does not mutate when confirmation is cancelled', async () => {
    const { state } = createState()
    await state.openIamPolicyVersions(policy)
    confirm.mockRejectedValueOnce('cancel')
    await state.restoreIamPolicyVersion(version)
    expect(setDefaultPolicyVersion).not.toHaveBeenCalled()
    expect(state.iamVersionRestoring.value).toBe(false)
  })
  it('clears previous page data and the hash when loading fails', async () => {
    const { state } = createState()
    await state.openIamPolicyVersions(policy)
    listPolicyVersions.mockRejectedValueOnce(new Error('Forbidden'))
    await state.changeIamVersionPage(2)
    expect(state.iamVersions.value).toEqual([])
    expect(state.iamDefaultDocumentHash.value).toBeUndefined()
    expect(state.iamVersionsFailed.value).toBe(true)
  })
  it('discards responses from closed drawers or a different selected policy', async () => {
    for (const close of [true, false]) {
      const { state } = createState()
      let finish!: (page: RamPolicyVersionPageDto) => void
      listPolicyVersions.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const pending = state.openIamPolicyVersions(policy)
      if (close) state.resetIamPolicyVersions()
      else await state.openIamPolicyVersions({ ...policy, id: 'p2' })
      finish({ ...page, defaultDocumentHash: 'stale-hash' })
      await pending
      expect(state.iamDefaultDocumentHash.value).toBe(close ? undefined : page.defaultDocumentHash)
    }
  })
})
