import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteTerminalTemplateOptions } from '@/views/products/remote-terminal-cloud/remote-terminal-product-management/useRemoteTerminalTemplateOptions'
import type { RemoteTerminalFilterOptionsDto } from '@/client/types.gen'
const source = { getFilterOptions: vi.fn() }
let identity: string
const result = (page = 1, total = 21): RemoteTerminalFilterOptionsDto => ({
  templates: [{ id: 'template-' + page, name: 'Admitted name', publishStatus: 'draft', status: 1 }],
  templateStatusOptions: [],
  assignmentStatusOptions: [],
  deviceStatusOptions: [],
  publishStatusOptions: [],
  templatePage: page,
  templatePageSize: 20,
  templateTotal: total,
})
const deferred = () => {
  let resolve!: (value: RemoteTerminalFilterOptionsDto) => void
  const promise = new Promise<RemoteTerminalFilterOptionsDto>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetAllMocks()
  identity = 'actor:v1'
  source.getFilterOptions.mockResolvedValue(result())
})
const create = () => useRemoteTerminalTemplateOptions(source, () => identity)
describe('server-paginated terminal template options', () => {
  it('searches and changes page without preloading or slicing all choices', async () => {
    const state = create()
    await state.load(1, '  starter  ')
    expect(source.getFilterOptions).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      keyword: 'starter',
    })
    source.getFilterOptions.mockResolvedValue(result(2))
    await state.load(2)
    expect(source.getFilterOptions).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 20,
      keyword: 'starter',
    })
    expect(state.filterOptions.templates.map((row) => row.id)).toEqual(['template-2'])
    expect(state.total.value).toBe(21)
  })
  it('clears old names while the next search is pending', async () => {
    const state = create()
    await state.load()
    const pending = deferred()
    source.getFilterOptions.mockReturnValue(pending.promise)
    const load = state.load(1, 'new')
    expect(state.filterOptions.templates).toEqual([])
    expect(state.loading.value).toBe(true)
    pending.resolve(result())
    await load
  })
  it('ignores late replies from older searches', async () => {
    const state = create(),
      pending = deferred()
    source.getFilterOptions.mockReturnValueOnce(pending.promise)
    const old = state.load(1, 'old')
    source.getFilterOptions.mockResolvedValue(result(2))
    await state.load(2, 'new')
    pending.resolve(result())
    expect(await old).toBe(false)
    expect(state.filterOptions.templates[0]?.id).toBe('template-2')
  })
  it("does not restore another identity\'s names after logout", async () => {
    const state = create(),
      pending = deferred()
    source.getFilterOptions.mockReturnValue(pending.promise)
    const loading = state.load()
    identity = 'other:v1'
    pending.resolve(result())
    expect(await loading).toBe(false)
    expect(state.filterOptions.templates).toEqual([])
    expect(state.total.value).toBe(0)
    expect(state.loading.value).toBe(false)
  })
  it('reset invalidates a pending request after permission changes', async () => {
    const state = create(),
      pending = deferred()
    source.getFilterOptions.mockReturnValue(pending.promise)
    const loading = state.load()
    state.reset()
    pending.resolve(result())
    expect(await loading).toBe(false)
    expect(state.filterOptions.templates).toEqual([])
  })
  it('clears previously admitted data on a refused refresh', async () => {
    const state = create()
    await state.load()
    source.getFilterOptions.mockRejectedValue(new Error('denied'))
    expect(await state.load()).toBe(false)
    expect(state.filterOptions.templates).toEqual([])
    expect(state.failed.value).toBe(true)
  })
  it.each([
    { ...result(), templateTotal: undefined },
    { ...result(), templatePage: 2 },
    { ...result(), templateTotal: -1 },
    { ...result(), templates: [result().templates[0]!, result().templates[0]!] },
  ])('refuses malformed pagination without inventing totals', async (response) => {
    const state = create()
    source.getFilterOptions.mockResolvedValue(response)
    expect(await state.load()).toBe(false)
    expect(state.filterOptions.templates).toEqual([])
    expect(state.total.value).toBe(0)
  })
})
