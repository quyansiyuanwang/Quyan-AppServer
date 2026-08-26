// @vitest-environment jsdom
import { defineComponent, nextTick, shallowRef } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  useRelayChannelProbeManagement,
  type RelayChannelProbeManagementState,
} from '@/views/relay/relay-channel-probe/useRelayChannelProbeManagement'

const { createRunsMock, listOverviewMock, listChannelsMock } = vi.hoisted(() => ({
  createRunsMock: vi.fn(),
  listOverviewMock: vi.fn(),
  listChannelsMock: vi.fn(),
}))

vi.mock('@/service/relayChannelProbeService', () => ({
  relayChannelProbeService: {
    listOverview: listOverviewMock,
    getProfile: vi.fn(),
    saveProfile: vi.fn(),
    clearProfile: vi.fn(),
    createRun: vi.fn(),
    resetRunState: vi.fn(),
    createRuns: createRunsMock,
    copyProfile: vi.fn(),
    listRuns: vi.fn(),
    clearRunHistory: vi.fn(),
    applyRuns: vi.fn(),
  },
}))

vi.mock('@/service/relayChannelService', () => ({
  relayChannelService: {
    listChannels: listChannelsMock,
  },
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({
    hasPermission: vi.fn(() => true),
  }),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
  ElMessageBox: {
    confirm: vi.fn(),
  },
}))

const createItem = (overrides: Record<string, unknown> = {}) => ({
  channelId: 'channel-1',
  channelName: 'Channel 1',
  enabled: true,
  visibilityMode: 'public',
  customerFacingTargets: [],
  allowedProbeFormats: ['openai'],
  allowedProbeModels: ['gpt-test'],
  multiplier: 1,
  profile: undefined,
  latestRun: undefined,
  ...overrides,
})

const mountComposable = async () => {
  const state = shallowRef<RelayChannelProbeManagementState | null>(null)
  const Host = defineComponent({
    setup() {
      state.value = useRelayChannelProbeManagement()
      return () => null
    },
  })
  const wrapper = mount(Host)
  await flushPromises()
  if (!state.value) throw new Error('Failed to initialize relay channel probe composable')
  return { state: state.value, wrapper }
}

describe('useRelayChannelProbeManagement', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    listChannelsMock.mockResolvedValue([
      { id: 'channel-1', name: 'Customer target', enabled: true, channelType: 'standalone' },
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads legacy customer-facing targets through the channel topology fallback', async () => {
    listOverviewMock.mockResolvedValue({
      hasCustomerFacingTargets: false,
      items: [createItem()],
    })

    const { state, wrapper } = await mountComposable()

    expect(listChannelsMock).toHaveBeenCalledWith({ includeDisabled: true })
    expect(state.items.value[0]?.customerFacingTargets).toEqual([
      { channelId: 'channel-1', channelName: 'Customer target' },
    ])
    wrapper.unmount()
  })

  it('clears selected overview rows when a filter changes', async () => {
    listOverviewMock.mockResolvedValue({
      hasCustomerFacingTargets: true,
      items: [createItem()],
    })

    const { state, wrapper } = await mountComposable()
    state.selectedRows.value = [state.items.value[0]!]
    state.keyword.value = 'channel'
    await nextTick()

    expect(state.selectedRows.value).toEqual([])
    wrapper.unmount()
  })

  it('polls overview data while a queued probe run is active', async () => {
    vi.useFakeTimers()
    listOverviewMock.mockResolvedValue({
      hasCustomerFacingTargets: true,
      items: [
        createItem({
          latestRun: { id: 'run-1', status: 'queued' },
        }),
      ],
    })

    const { wrapper } = await mountComposable()
    expect(listOverviewMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3000)
    expect(listOverviewMock).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('waits for a polling refresh to finish before scheduling the next one', async () => {
    vi.useFakeTimers()
    let resolveRefresh:
      | ((value: { hasCustomerFacingTargets: boolean; items: object[] }) => void)
      | undefined
    const activeOverview = {
      hasCustomerFacingTargets: true,
      items: [createItem({ latestRun: { id: 'run-1', status: 'queued' } })],
    }
    listOverviewMock
      .mockResolvedValueOnce(activeOverview)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve
          }),
      )
      .mockResolvedValue(activeOverview)

    const { wrapper } = await mountComposable()
    await vi.advanceTimersByTimeAsync(3000)
    expect(listOverviewMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(9000)
    expect(listOverviewMock).toHaveBeenCalledTimes(2)

    resolveRefresh?.(activeOverview)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2999)
    expect(listOverviewMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(listOverviewMock).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('queues selected pooled members as explicit targets', async () => {
    listOverviewMock.mockResolvedValue({
      hasCustomerFacingTargets: true,
      items: [
        createItem({
          channelId: 'pool-1',
          channelType: 'pooled',
          profile: { enabled: true },
          members: [
            {
              channelId: 'member-available',
              channelName: 'Available account',
              enabled: true,
              compatible: true,
              hasCredentials: true,
            },
            {
              channelId: 'member-disabled',
              channelName: 'Disabled account',
              enabled: false,
              compatible: true,
              hasCredentials: true,
            },
          ],
        }),
      ],
    })
    createRunsMock.mockResolvedValue({ queued: [], rejected: [] })

    const { state, wrapper } = await mountComposable()
    state.selectedRows.value = [state.items.value[0]!]
    await state.confirmBatchRun()

    expect(createRunsMock).toHaveBeenCalledWith({
      targets: [{ channelId: 'pool-1', memberChannelId: 'member-available' }],
      forceWithoutCacheBuster: false,
    })
    wrapper.unmount()
  })
})
