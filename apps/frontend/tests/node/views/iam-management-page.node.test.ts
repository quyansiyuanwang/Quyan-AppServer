import { describe, expect, it, vi } from 'vitest'
import { useIamManagementPage } from '@/views/management/ram-management/useIamManagementPage'
describe('IAM candidate page navigation', () => {
  it('can advance from an empty filtered page without guessing a total', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ items: [], page: 1, pageSize: 50, hasNext: true })
      .mockResolvedValueOnce({ items: [{ id: 'allowed' }], page: 2, pageSize: 50, hasNext: false })
    const state = useIamManagementPage(fetch)
    expect(await state.load()).toBe(true)
    expect(state.items.value).toEqual([])
    expect(state.hasNext.value).toBe(true)
    expect(await state.next()).toBe(true)
    expect(fetch).toHaveBeenLastCalledWith({ page: 2, pageSize: 50 })
    expect(state.items.value).toEqual([{ id: 'allowed' }])
    expect(await state.next()).toBe(false)
  })
  it('ignores stale results after a source change or a newer request', async () => {
    let finish!: (value: unknown) => void
    const fetch = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        }),
      )
      .mockResolvedValue({ items: ['new'], page: 1, pageSize: 50, hasNext: false })
    const state = useIamManagementPage(fetch)
    const old = state.load()
    state.clear()
    await state.load()
    finish({ items: ['old'], page: 1, pageSize: 50, hasNext: true })
    await old
    expect(state.items.value).toEqual(['new'])
    expect(state.hasNext.value).toBe(false)
  })
  it('clears stale rows on failure, keeps a retry path and does not request pages below one', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ items: ['first'], page: 1, pageSize: 50, hasNext: true })
      .mockRejectedValueOnce(new Error('fixture'))
    const state = useIamManagementPage(fetch)
    await state.load()
    expect(await state.previous()).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await state.next()).toBe(false)
    expect(state.failed.value).toBe(true)
    expect(state.items.value).toEqual([])
    expect(state.loading.value).toBe(false)
    state.clear()
    expect(state.failed.value).toBe(false)
    expect(state.page.value).toBe(1)
  })
})
