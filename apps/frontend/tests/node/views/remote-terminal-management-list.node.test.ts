import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteTerminalManagementList } from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/useRemoteTerminalManagementList'
const source = vi.fn()
let identity: string, permitted: boolean
const scopes: ReturnType<typeof effectScope>[] = []
const list = () => {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() =>
    useRemoteTerminalManagementList<{ id: string }>(
      source,
      () => identity,
      () => permitted,
    ),
  )!
}
const page = (number: number, size: number, total = 43) => ({
  page: number,
  pageSize: size,
  total,
  records: Array.from(
    { length: Math.min(size, Math.max(0, total - (number - 1) * size)) },
    (_, index) => ({ id: `row-${(number - 1) * size + index}` }),
  ),
})
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.resetAllMocks()
  identity = 'actor:v1'
  permitted = true
  source.mockImplementation(async (params) => page(params.page, params.pageSize))
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
})
describe('terminal management server pagination', () => {
  it('loads one server page with its authorized total', async () => {
    const state = list()
    expect(await state.load()).toBe(true)
    expect(source).toHaveBeenCalledWith({ page: 1, pageSize: 20 })
    expect(state.records.value).toHaveLength(20)
    expect(state.total.value).toBe(43)
  })
  it('requests another page rather than slicing the old page', async () => {
    const state = list()
    await state.load()
    await state.changePage(2)
    expect(source).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 })
    expect(state.records.value[0]!.id).toBe('row-20')
  })
  it('resets to the first page when changing size or filters', async () => {
    const state = list()
    await state.load()
    await state.changePage(2)
    await state.changePageSize(50)
    expect(source).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 })
    expect(state.records.value).toHaveLength(43)
    await state.reloadFirst()
    expect(source).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 })
  })
  it('refetches the last available page after deletion or a reduced grant', async () => {
    const state = list()
    await state.load()
    await state.changePage(3)
    source.mockImplementation(async (params) => page(params.page, params.pageSize, 21))
    await state.load()
    expect(source).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 })
    expect(state.page.value).toBe(2)
    expect(state.records.value).toEqual([{ id: 'row-20' }])
  })
  it('refetches page one when all records disappear', async () => {
    const state = list()
    await state.load()
    await state.changePage(3)
    source.mockImplementation(async (params) => page(params.page, params.pageSize, 0))
    await state.load()
    expect(state.page.value).toBe(1)
    expect(state.total.value).toBe(0)
    expect(state.records.value).toEqual([])
  })
  it('clears records and total while a new page is pending', async () => {
    const state = list()
    await state.load()
    const pending = deferred<ReturnType<typeof page>>()
    source.mockReturnValueOnce(pending.promise)
    const loading = state.changePage(2)
    expect(state.records.value).toEqual([])
    expect(state.total.value).toBe(0)
    expect(state.loading.value).toBe(true)
    pending.resolve(page(2, 20))
    await loading
    expect(state.loading.value).toBe(false)
  })
  it('discards a late response after a newer request', async () => {
    const state = list(),
      old = deferred<ReturnType<typeof page>>()
    source.mockReturnValueOnce(old.promise)
    const first = state.load()
    source.mockResolvedValueOnce(page(1, 20, 2))
    await state.reloadFirst()
    old.resolve(page(1, 20))
    expect(await first).toBe(false)
    expect(state.total.value).toBe(2)
    expect(state.records.value).toHaveLength(2)
  })
  it('does not let an old failure clear a newer page', async () => {
    const state = list(),
      old = deferred<ReturnType<typeof page>>()
    source.mockReturnValueOnce(old.promise)
    const first = state.load()
    await state.load()
    old.reject(new Error('old failure'))
    await first
    expect(state.records.value).toHaveLength(20)
    expect(state.failed.value).toBe(false)
  })
  it.each(['identity', 'permission', 'reset', 'dispose'])(
    'discards a pending page after %s changes',
    async (fault) => {
      const state = list(),
        pending = deferred<ReturnType<typeof page>>()
      source.mockReturnValueOnce(pending.promise)
      const loading = state.load()
      if (fault === 'identity') identity = 'other:v1'
      if (fault === 'permission') permitted = false
      if (fault === 'reset') state.reset()
      if (fault === 'dispose') scopes[0]!.stop()
      pending.resolve(page(1, 20))
      expect(await loading).toBe(false)
      expect(state.records.value).toEqual([])
      expect(state.total.value).toBe(0)
      expect(state.loading.value).toBe(false)
    },
  )
  it('never sends a request without current view permission', async () => {
    permitted = false
    const state = list()
    expect(await state.load()).toBe(false)
    expect(source).not.toHaveBeenCalled()
  })
  it('offers retry after a denied refresh without retaining old data', async () => {
    const state = list()
    await state.load()
    source.mockRejectedValueOnce(new Error('denied'))
    expect(await state.load()).toBe(false)
    expect(state.records.value).toEqual([])
    expect(state.total.value).toBe(0)
    expect(state.failed.value).toBe(true)
    await state.load()
    expect(state.failed.value).toBe(false)
  })
  it.each([
    'wrong-page',
    'wrong-size',
    'negative-total',
    'unsafe-total',
    'duplicates',
    'incomplete',
    'missing-id',
  ])('refuses malformed %s responses', async (fault) => {
    const result = page(1, 20)
    if (fault === 'wrong-page') result.page = 2
    if (fault === 'wrong-size') result.pageSize = 100
    if (fault === 'negative-total') result.total = -1
    if (fault === 'unsafe-total') result.total = Number.MAX_SAFE_INTEGER + 1
    if (fault === 'duplicates') result.records[1] = result.records[0]!
    if (fault === 'incomplete') result.records.pop()
    if (fault === 'missing-id') result.records[0] = { id: '' }
    source.mockResolvedValueOnce(result)
    const state = list()
    expect(await state.load()).toBe(false)
    expect(state.records.value).toEqual([])
    expect(state.failed.value).toBe(true)
  })
  it('keeps independent section pages and failure states', async () => {
    const templates = list(),
      entitlements = list()
    await templates.load()
    await templates.changePage(2)
    source.mockRejectedValueOnce(new Error('denied'))
    await entitlements.load()
    expect(templates.page.value).toBe(2)
    expect(templates.records.value).toHaveLength(20)
    expect(entitlements.records.value).toEqual([])
  })
})
