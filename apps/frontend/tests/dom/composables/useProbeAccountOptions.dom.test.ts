// @vitest-environment jsdom
import { computed, defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProbeAccountOptions } from '@/views/relay/relay-channel-probe/useProbeAccountOptions'
const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/service/relayChannelProbeService', () => ({
  relayChannelProbeService: { listAccountPage: list },
}))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: vi.fn() }))
function setup() {
  const allowed = ref(true)
  let state!: ReturnType<typeof useProbeAccountOptions>
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useProbeAccountOptions(computed(() => allowed.value))
        return () => null
      },
    }),
  )
  return { state, wrapper, allowed }
}
beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.useRealTimers())
describe('paginated probe account selector', () => {
  it('deduplicates concurrent requests and appends only the requested next page', async () => {
    list
      .mockResolvedValueOnce({ items: [{ id: 'first' }], total: 2 })
      .mockResolvedValueOnce({ items: [{ id: 'second' }], total: 2 })
    const { state, wrapper } = setup()
    await Promise.all([state.loadAccounts(), state.loadAccounts()])
    expect(list).toHaveBeenCalledTimes(1)
    expect(state.accountsHasMore.value).toBe(true)
    await state.loadMoreAccounts()
    expect(list).toHaveBeenLastCalledWith(2, 20, undefined)
    expect(state.accounts.value.map((account) => account.id)).toEqual(['first', 'second'])
    expect(state.accountsHasMore.value).toBe(false)
    wrapper.unmount()
  })
  it('ignores an old search response and responses after the selector is disposed', async () => {
    vi.useFakeTimers()
    let finish!: (value: object) => void
    list
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      .mockResolvedValueOnce({ items: [{ id: 'new' }], total: 1 })
    const { state, wrapper } = setup()
    const old = state.loadAccounts()
    state.searchAccounts('new')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    finish({ items: [{ id: 'stale' }], total: 1 })
    await old
    expect(state.accounts.value[0]?.id).toBe('new')
    wrapper.unmount()
    await state.loadAccounts()
    expect(list).toHaveBeenCalledTimes(2)
  })
  it('does not load account options without management permission', async () => {
    const { state, wrapper, allowed } = setup()
    allowed.value = false
    await state.loadAccounts()
    expect(list).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
