// @vitest-environment jsdom
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useProbeRounds } from '@/views/relay/relay-channel-probe/useProbeRounds'
const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  save: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  replace: vi.fn(),
  notice: vi.fn(),
}))
vi.mock('@/service/relayProbeRoundService', () => ({ default: mocks }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessage: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: mocks.notice }))
const schedule = {
  enabled: true,
  minuteOfDay: 180,
  version: 2,
  timezone: 'Asia/Shanghai',
  nextRunAt: '2026-11-03T19:00:00Z',
}
function setup() {
  const active = ref(true)
  let state!: ReturnType<typeof useProbeRounds>
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useProbeRounds(active)
        return () => null
      },
    }),
  )
  return { active, state, wrapper }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.schedule.mockResolvedValue(schedule)
  mocks.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
})
afterEach(() => {
  vi.useRealTimers()
})
describe('daily probe plan and report state', () => {
  it('saves the displayed version and preserves edits on a failed save', async () => {
    const { state, wrapper } = setup()
    await flushPromises()
    state.time.value = '04:15'
    mocks.save.mockRejectedValueOnce(new Error('fixture version conflict'))
    await state.save()
    expect(mocks.save).toHaveBeenCalledWith({ enabled: true, minuteOfDay: 255, expectedVersion: 2 })
    expect(state.time.value).toBe('04:15')
    expect(state.schedule.value?.version).toBe(2)
    expect(mocks.notice).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('discards the previous report when its response arrives after a newer selection', async () => {
    const { state, wrapper } = setup()
    await flushPromises()
    let completeOld!: (value: unknown) => void
    mocks.detail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOld = resolve
        }),
    )
    const first = state.selectRound('older')
    await flushPromises()
    mocks.detail.mockResolvedValueOnce({ round: { id: 'newer' }, items: [], total: 0 })
    await state.selectRound('newer')
    completeOld({ round: { id: 'older' }, items: [], total: 0 })
    await first
    expect(state.detail.value?.round.id).toBe('newer')
    wrapper.unmount()
  })
  it('stops polling when the plan tab is inactive', async () => {
    vi.useFakeTimers()
    mocks.list.mockResolvedValue({ items: [{ id: 'active', state: 'running' }], total: 1 })
    const { active, wrapper } = setup()
    await flushPromises()
    active.value = false
    await flushPromises()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.list).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
