// @vitest-environment jsdom
import { defineComponent, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useProbeOverview } from '@/views/relay/relay-channel-probe/useProbeOverview'
const { page, members } = vi.hoisted(() => ({ page: vi.fn(), members: vi.fn() }))
vi.mock('@/service/relayChannelProbeService', () => ({
  relayChannelProbeService: { listOverviewPage: page, listMemberPage: members },
}))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: vi.fn() }))
const result = (name: string) => ({
  items: [{ channelId: name, channelName: name, memberCount: 200 }],
  total: 200,
})
function setup() {
  let state!: ReturnType<typeof useProbeOverview>
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useProbeOverview()
        return () => null
      },
    }),
  )
  return { state, wrapper }
}
beforeEach(() => {
  vi.clearAllMocks()
  page.mockResolvedValue(result('fixture'))
  members.mockResolvedValue({ items: [], total: 200 })
})
afterEach(() => vi.useRealTimers())
describe('probe overview request lifecycle', () => {
  it('refreshes with active filters and removes a row that no longer matches', async () => {
    const { state, wrapper } = setup()
    await state.loadOverview()
    page
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [], total: 0 })
    await state.refreshOverviewRow('fixture')
    expect(page).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        channelId: 'fixture',
        enabled: 'enabled',
        page: 1,
        pageSize: 1,
      }),
    )
    expect(state.items.value).toEqual([])
    expect(state.overviewTotal.value).toBe(0)
    wrapper.unmount()
  })
  it('deduplicates a request, pages on the server, and only loads members after expansion', async () => {
    const { state, wrapper } = setup()
    await Promise.all([state.loadOverview(), state.loadOverview()])
    expect(page).toHaveBeenCalledOnce()
    expect(members).not.toHaveBeenCalled()
    state.overviewPage.value = 2
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 20 }))
    state.onExpandChange(
      { channelId: 'fixture', channelType: 'pooled' } as never,
      [{ channelId: 'fixture' }] as never,
    )
    await flushPromises()
    expect(members).toHaveBeenCalledWith('fixture', 1, 20)
    wrapper.unmount()
  })
  it('ignores a slow result after filters change and recovers when the same search is selected again', async () => {
    vi.useFakeTimers()
    let resolve!: (value: ReturnType<typeof result>) => void
    page.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const { state, wrapper } = setup()
    const old = state.loadOverview()
    state.keyword.value = 'new'
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    expect(state.items.value[0]?.channelId).toBe('fixture')
    resolve(result('stale'))
    await old
    expect(state.items.value[0]?.channelId).toBe('fixture')
    state.keyword.value = ''
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    expect(page).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })
  it('ignores a member response from a previous page', async () => {
    let resolve!: (value: object) => void
    members.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const { state, wrapper } = setup()
    await state.loadOverview()
    const old = state.loadMembers('fixture', 1)
    members.mockResolvedValueOnce({ items: [{ channelId: 'page-2' }], total: 200 })
    await state.loadMembers('fixture', 2)
    resolve({ items: [{ channelId: 'stale' }], total: 200 })
    await old
    expect(state.items.value[0]?.members?.[0]?.channelId).toBe('page-2')
    wrapper.unmount()
  })
})
