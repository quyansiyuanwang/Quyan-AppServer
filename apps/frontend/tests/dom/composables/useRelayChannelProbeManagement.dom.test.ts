// @vitest-environment jsdom
import { defineComponent, nextTick, shallowRef } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  useRelayChannelProbeManagement,
  type RelayChannelProbeManagementState,
} from '@/views/relay/relay-channel-probe/useRelayChannelProbeManagement'

const {
  createRunsMock,
  listLatestRunsMock,
  listOverviewMock,
  listChannelsMock,
  configureTargetsMock,
  getProfileMock,
  saveConfigurationMock,
  getConfigurationMock,
} = vi.hoisted(() => ({
  getConfigurationMock: vi.fn(),
  getProfileMock: vi.fn(),
  saveConfigurationMock: vi.fn(),
  createRunsMock: vi.fn(),
  configureTargetsMock: vi.fn(),
  listLatestRunsMock: vi.fn(),
  listOverviewMock: vi.fn(),
  listChannelsMock: vi.fn(),
}))

vi.mock('@/service/relayChannelProbeService', () => ({
  relayChannelProbeService: {
    listOverviewPage: async (...args: unknown[]) => {
      const result = await listOverviewMock(...args)
      return { ...result, total: result.total ?? result.items.length, page: 1, pageSize: 20 }
    },
    listMemberPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getProfile: getProfileMock,
    getConfiguration: getConfigurationMock,
    saveConfiguration: saveConfigurationMock,
    saveProfile: vi.fn(),
    clearProfile: vi.fn(),
    createRun: vi.fn(),
    resetRunState: vi.fn(),
    createRuns: createRunsMock,
    listLatestRuns: listLatestRunsMock,
    copyProfile: vi.fn(),
    listAccounts: vi.fn().mockResolvedValue([]),
    listAccountPage: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
    configureTargets: configureTargetsMock,
    bindAccounts: vi.fn().mockResolvedValue({ configured: [], rejected: [] }),
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
vi.mock('@/utils/requestErrorNotice', () => ({ showRequestErrorNotice: vi.fn() }))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({
    hasPermission: vi.fn(() => true),
  }),
}))

vi.mock('@/utils/elementPlusRuntime', () => ({
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

  const prepareEditor = async () => {
    listOverviewMock.mockResolvedValue({ items: [createItem()] })
    const mounted = await mountComposable()
    const profile = {
      ...mounted.state.form.value,
      id: 'profile',
      relayChannelId: 'channel-1',
      probeModel: 'gpt-test',
      probePayload: { messages: [] },
      credentialNames: ['password'],
      workflow: [
        {
          name: 'balance',
          method: 'GET',
          url: 'https://fixture.invalid/balance',
          balancePath: 'data.balance',
        },
      ],
      updateTime: '2026-11-03T00:00:00.000Z',
    }
    getConfigurationMock.mockResolvedValue(createItem({ profile }))
    await mounted.state.openDrawer(createItem() as never)
    return { ...mounted, profile }
  }

  it('rejects duplicate credential names instead of silently replacing a value', async () => {
    const { state, wrapper } = await prepareEditor()
    state.credentials.value = [
      { name: 'password', value: 'fixture-one' },
      { name: 'password', value: 'fixture-two' },
    ] as never
    await state.saveProfile()
    expect(saveConfigurationMock).not.toHaveBeenCalled()
    expect(state.credentials.value).toHaveLength(2)
    wrapper.unmount()
  })

  it('keeps user input and saved revisions after an atomic save conflict', async () => {
    const { state, wrapper, profile } = await prepareEditor()
    state.credentials.value = [{ name: 'password', value: 'fixture-replacement' }] as never
    saveConfigurationMock.mockRejectedValueOnce({ status: 409 })
    await state.saveProfile()
    expect(saveConfigurationMock).toHaveBeenCalledOnce()
    expect(saveConfigurationMock).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        expectedProfileUpdatedAt: profile.updateTime,
        expectedTargetUpdatedAt: null,
        profile: expect.objectContaining({ credentials: { password: 'fixture-replacement' } }),
      }),
    )
    expect(state.credentials.value[0]?.value).toBe('fixture-replacement')
    expect(state.selected.value?.profile?.updateTime).toBe(profile.updateTime)
    wrapper.unmount()
  })

  it('loads and saves standalone overrides together with the shared profile', async () => {
    const { state, wrapper, profile } = await prepareEditor()
    const targetConfig = {
      probeModel: 'override-model',
      probePayload: { max_tokens: 9 },
      probeGroup: 'override',
      updateTime: profile.updateTime,
    }
    getConfigurationMock.mockResolvedValueOnce(createItem({ profile, targetConfig }))
    await state.openDrawer(createItem() as never)
    expect(state.form.value.probeModel).toBe('override-model')
    expect(JSON.parse(state.payloadText.value)).toEqual({ max_tokens: 9 })
    state.form.value.probeModel = 'edited-model'
    saveConfigurationMock.mockResolvedValueOnce({
      profile,
      targetConfig: { ...targetConfig, probeModel: 'edited-model' },
    })
    await state.saveProfile()
    expect(saveConfigurationMock).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        expectedTargetUpdatedAt: targetConfig.updateTime,
        target: expect.objectContaining({
          probeModel: 'edited-model',
          probePayload: { max_tokens: 9 },
        }),
      }),
    )
    wrapper.unmount()
  })

  it('does not replace a newly opened drawer when a previous save finishes late', async () => {
    const { state, wrapper, profile } = await prepareEditor()
    let finish!: (result: object) => void
    saveConfigurationMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const saving = state.saveProfile()
    getConfigurationMock.mockResolvedValueOnce(
      createItem({ channelId: 'channel-2', profile: { ...profile, id: 'profile-2' } }),
    )
    await state.openDrawer(createItem({ channelId: 'channel-2' }) as never)
    finish({ profile: { ...profile, id: 'old-save' } })
    await saving
    expect(state.selected.value?.channelId).toBe('channel-2')
    expect(state.selected.value?.profile?.id).toBe('profile-2')
    wrapper.unmount()
  })

  it('uses authorized summary metadata without loading the legacy full channel list', async () => {
    listOverviewMock.mockResolvedValue({
      items: [
        createItem({ customerFacingTargets: [{ channelId: 'pool', channelName: 'Public pool' }] }),
      ],
    })
    const { state, wrapper } = await mountComposable()
    expect(listChannelsMock).not.toHaveBeenCalled()
    expect(state.items.value[0]?.customerFacingTargets).toEqual([
      { channelId: 'pool', channelName: 'Public pool' },
    ])
    expect(listOverviewMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20, enabled: 'enabled' }),
    )
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

  it('polls only active probe targets instead of reloading the overview', async () => {
    vi.useFakeTimers()
    listOverviewMock.mockResolvedValue({
      hasCustomerFacingTargets: true,
      items: [
        createItem({
          latestRun: { id: 'run-1', status: 'queued' },
        }),
      ],
    })
    listLatestRunsMock.mockResolvedValue([
      { channelId: 'channel-1', latestRun: { id: 'run-1', status: 'running' } },
    ])

    const { wrapper } = await mountComposable()
    expect(listOverviewMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3000)
    expect(listOverviewMock).toHaveBeenCalledTimes(1)
    expect(listLatestRunsMock).toHaveBeenCalledWith({ targets: [{ channelId: 'channel-1' }] })
    wrapper.unmount()
  })

  it('waits for a polling refresh to finish before scheduling the next one', async () => {
    vi.useFakeTimers()
    let resolveRefresh: ((value: object[]) => void) | undefined
    const activeOverview = {
      hasCustomerFacingTargets: true,
      items: [createItem({ latestRun: { id: 'run-1', status: 'queued' } })],
    }
    listOverviewMock.mockResolvedValue(activeOverview)
    listLatestRunsMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve
          }),
      )
      .mockResolvedValue([{ channelId: 'channel-1', latestRun: { id: 'run-1', status: 'queued' } }])

    const { wrapper } = await mountComposable()
    await vi.advanceTimersByTimeAsync(3000)
    expect(listLatestRunsMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(9000)
    expect(listLatestRunsMock).toHaveBeenCalledTimes(1)

    resolveRefresh?.([{ channelId: 'channel-1', latestRun: { id: 'run-1', status: 'queued' } }])
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2999)
    expect(listLatestRunsMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(listLatestRunsMock).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('adapts unsupported formats and models per batch target without copying secrets', async () => {
    const source = createItem({
      profile: {
        enabled: true,
        probeFormat: 'openai-chat-completions',
        probeModel: 'gpt-test',
        probePayload: { messages: [] },
        probeGroup: 'source-group',
      },
      allowedProbeFormats: ['openai-chat-completions'],
    })
    const target = createItem({
      channelId: 'channel-2',
      channelName: 'Anthropic channel',
      allowedProbeFormats: ['anthropic'],
      allowedProbeModels: ['claude-test'],
    })
    listOverviewMock.mockResolvedValue({ hasCustomerFacingTargets: true, items: [source, target] })
    configureTargetsMock.mockResolvedValue({
      configured: [{ channelId: 'channel-2' }],
      rejected: [],
    })
    const { state, wrapper } = await mountComposable()
    state.selectedRows.value = [...state.items.value]
    getProfileMock.mockResolvedValue(source.profile)
    await state.openBatchProfileDialog()
    expect(state.batchProfileTargets.value[0]).toMatchObject({
      channelId: 'channel-2',
      probeFormat: 'anthropic',
      probeModel: 'claude-test',
    })
    await state.submitBatchProfileCopy()
    expect(configureTargetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceChannelId: 'channel-1',
        targets: [
          expect.objectContaining({
            channelId: 'channel-2',
            probeFormat: 'anthropic',
            probeModel: 'claude-test',
          }),
        ],
      }),
    )
    wrapper.unmount()
  })

  it('asks the backend to expand selected pools independently of the member page', async () => {
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
      channelIds: ['pool-1'],
      forceWithoutCacheBuster: false,
    })
    wrapper.unmount()
  })
})
