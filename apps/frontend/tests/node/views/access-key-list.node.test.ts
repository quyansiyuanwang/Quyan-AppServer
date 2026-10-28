import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ page: vi.fn(), all: vi.fn() }))
vi.mock('@/service/accesskeyService', () => ({
  AccessKeyService: {
    getInstance: () => ({ getAccessKeysPage: mocks.page, getAccessKeys: mocks.all }),
  },
}))
import { useAccessKeyList } from '@/views/settings/access-key-management/useAccessKeyList'
beforeEach(() => vi.clearAllMocks())
const result = (page: number, items: unknown[] = [], hasNext = false) => ({
  items,
  page,
  pageSize: 50,
  hasNext,
})
describe('resource-filtered access key navigation', () => {
  it('uses server pages and advances past an empty authorized page without guessing a total', async () => {
    mocks.page
      .mockResolvedValueOnce(result(1, [], true))
      .mockResolvedValueOnce(result(2, [{ id: 'visible', key: 'masked' }]))
    const state = useAccessKeyList()
    await state.load()
    expect(state.hasNext.value).toBe(true)
    await state.next()
    expect(mocks.page).toHaveBeenLastCalledWith({ page: 2, pageSize: 50 })
    expect(state.items.value).toEqual([{ id: 'visible', key: 'masked' }])
    expect(mocks.all).not.toHaveBeenCalled()
  })
  it('changes page size through a fresh first-page request', async () => {
    mocks.page.mockResolvedValue({ items: [], page: 1, pageSize: 25, hasNext: false })
    const state = useAccessKeyList()
    state.pageSize.value = 25
    await state.load(1)
    expect(mocks.page).toHaveBeenCalledWith({ page: 1, pageSize: 25 })
  })
  it('does not display a late prior-page response', async () => {
    let finish!: (value: unknown) => void
    mocks.page
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        }),
      )
      .mockResolvedValueOnce(result(2, [{ id: 'current' }]))
    const state = useAccessKeyList(),
      old = state.load()
    await state.load(2)
    finish(result(1, [{ id: 'stale' }], true))
    await old
    expect(state.items.value).toEqual([{ id: 'current' }])
    expect(state.hasNext.value).toBe(false)
  })
  it('clears previous keys on failure and supports retry', async () => {
    mocks.page
      .mockResolvedValueOnce(result(1, [{ id: 'old' }]))
      .mockRejectedValueOnce(new Error('fixture'))
      .mockResolvedValueOnce(result(1, [{ id: 'retry' }]))
    const state = useAccessKeyList()
    await state.load()
    await state.load()
    expect(state.items.value).toEqual([])
    expect(state.failed.value).toBe(true)
    await state.load()
    expect(state.items.value).toEqual([{ id: 'retry' }])
  })
})
