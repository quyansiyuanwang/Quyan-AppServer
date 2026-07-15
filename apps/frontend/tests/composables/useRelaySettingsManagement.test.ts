import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRelaySettingsManagement, type RelaySettingsManagementState } from '@/views/relay/relay-settings/useRelaySettingsManagement'
import type { RelayChannelDto } from '@/client/types.gen'

const {
  createChannelMock,
  updateChannelMock,
  listChannelsMock,
  exportChannelsMock,
  batchDuplicateChannelsMock,
  getRelayConfigMock,
  updateRelayConfigMock,
  getSystemRelayConfigMock,
  setRelayConfigMock,
  getAllUsersMock,
  getAllGroupsMock,
  listRolesMock,
  messageSuccessMock,
  messageErrorMock,
  copyTextWithFallbackMock,
} = vi.hoisted(() => ({
  createChannelMock: vi.fn(),
  updateChannelMock: vi.fn(),
  listChannelsMock: vi.fn(),
  exportChannelsMock: vi.fn(),
  batchDuplicateChannelsMock: vi.fn(),
  getRelayConfigMock: vi.fn(),
  updateRelayConfigMock: vi.fn(),
  getSystemRelayConfigMock: vi.fn(),
  setRelayConfigMock: vi.fn(),
  getAllUsersMock: vi.fn(),
  getAllGroupsMock: vi.fn(),
  listRolesMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  messageErrorMock: vi.fn(),
  copyTextWithFallbackMock: vi.fn(),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    success: messageSuccessMock,
    error: messageErrorMock,
    warning: vi.fn(),
  },
  ElMessageBox: {
    confirm: vi.fn(),
  },
}))

vi.mock('@/service/relayChannelService', () => ({
  relayChannelService: {
    listChannels: listChannelsMock,
    createChannel: createChannelMock,
    updateChannel: updateChannelMock,
    exportChannels: exportChannelsMock,
    importChannels: vi.fn(),
    duplicateChannel: vi.fn(),
    batchDuplicateChannels: batchDuplicateChannelsMock,
    batchSetChannelStatus: vi.fn(),
    batchDeleteChannels: vi.fn(),
    toggleChannelStatus: vi.fn(),
    deleteChannel: vi.fn(),
  },
}))

vi.mock('@/service/relayConfigService', () => ({
  relayConfigService: {
    getRelayConfig: getRelayConfigMock,
    updateRelayConfig: updateRelayConfigMock,
  },
}))

vi.mock('@/service/configService', () => ({
  configService: {
    getRelayConfig: getSystemRelayConfigMock,
    setRelayConfig: setRelayConfigMock,
  },
}))

vi.mock('@/service/userService', () => ({
  userService: {
    getAllUsers: getAllUsersMock,
  },
}))

vi.mock('@/service/groupService', () => ({
  groupService: {
    getAllGroups: getAllGroupsMock,
  },
}))

vi.mock('@/service/ramService', () => ({
  ramService: {
    listRoles: listRolesMock,
  },
}))

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({
    isDesktop: ref(true),
    isMobile: ref(false),
  }),
}))

vi.mock('@/utils/clipboard', () => ({
  copyTextWithFallback: copyTextWithFallbackMock,
}))

const createRelayConfigResponse = () => ({
  globalMultiplier: 1,
  uptimeStatusUrl: '',
  enableQueue: true,
  maxConcurrency: 5,
  queueTimeout: 30000,
  upstreamStreamTimeout: 120000,
  modelRates: [
    {
      model: 'gpt-4o-mini',
      modelId: 'openai/gpt-4o-mini',
      provider: 'openai/gpt-4o-mini',
      pricingType: 'token-based',
      inputPrice: 1,
      outputPrice: 2,
      cacheCreationMultiplier: 1.25,
      cacheReadMultiplier: 0.1,
      supportedFormats: 'openai',
    },
  ],
  monitorNameMapping: null,
  showOnlyConfigured: false,
})

const createSystemRelayConfigResponse = () => ({
  upstreamUrl: '',
  upstreamApiKey: '',
  allowedModels: '',
  customKeyEnabled: true,
  customKeyMaxTokensPerUser: 3,
  customKeyCreateLimitWindowMinutes: 10,
  customKeyCreateLimitMaxCount: 5,
})

const createChannelRow = (overrides: Partial<RelayChannelDto> = {}): RelayChannelDto =>
  ({
    id: 'channel-1',
    name: 'Test Channel',
    enabled: true,
    channelType: 'standalone',
    routingStrategy: 'priority',
    visibilityMode: 'public',
    poolMembers: [],
    multiplier: 1,
    allowedFormats: 'openai',
    allowedModels: [],
    openaiUpstreamUrl: 'https://example.com/v1',
    hasOpenaiUpstreamApiKey: true,
    hasAnthropicUpstreamApiKey: false,
    hasGeminiUpstreamApiKey: false,
    inputTokensIncludeCacheRead: false,
    timePeriodMultipliers: [],
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    ...overrides,
  })

const mountComposable = async () => {
  const api = shallowRef<RelaySettingsManagementState | null>(null)

  const Host = defineComponent({
    name: 'RelaySettingsManagementHost',
    setup() {
      api.value = useRelaySettingsManagement()
      return () => null
    },
  })

  const wrapper = mount(Host)
  await flushPromises()

  const state = api.value
  if (!state) throw new Error('Failed to initialize relay settings composable')

  return {
    api: state,
    wrapper,
  }
}

describe('useRelaySettingsManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRelayConfigMock.mockResolvedValue(createRelayConfigResponse())
    updateRelayConfigMock.mockResolvedValue(undefined)
    getSystemRelayConfigMock.mockResolvedValue(createSystemRelayConfigResponse())
    setRelayConfigMock.mockResolvedValue(undefined)
    listChannelsMock.mockResolvedValue([])
    exportChannelsMock.mockResolvedValue({ channels: [] })
    createChannelMock.mockResolvedValue({ id: 'created-channel' })
    updateChannelMock.mockResolvedValue({ id: 'updated-channel' })
    getAllUsersMock.mockResolvedValue({ users: [] })
    getAllGroupsMock.mockResolvedValue([])
    listRolesMock.mockResolvedValue([])
    copyTextWithFallbackMock.mockResolvedValue(true)
  })

  it('loads pooled edit state with auto allowed-model mode and null thresholds', async () => {
    const { api, wrapper } = await mountComposable()

    api.openEditChannelDialog(
      createChannelRow({
        id: 'pooled-channel',
        channelType: 'pooled',
        routingStrategy: 'round-robin',
        routingConfig: {
          maxRetries: 3,
          healthScoreThreshold: null,
          latencyThresholdMs: null,
          circuitBreakerThreshold: null,
          allowedModelsMode: 'auto',
        },
        poolMembers: [
          { memberChannelId: 'member-1', priority: 1, weight: 2, enabled: true },
          { memberChannelId: 'member-2', priority: 2, weight: 1, enabled: false },
        ],
        visibilityMode: 'whitelist',
        visibilityConfig: { groupIds: ['group-1'] },
        openaiUpstreamUrl: undefined,
      }),
    )

    expect(api.channelForm.value.channelType).toBe('pooled')
    expect(api.channelForm.value.pooledAllowedModelsMode).toBe('auto')
    expect(api.channelForm.value.routingConfig.healthScoreThreshold).toBeNull()
    expect(api.channelForm.value.routingConfig.latencyThresholdMs).toBeNull()
    expect(api.channelForm.value.routingConfig.circuitBreakerThreshold).toBeNull()
    expect(api.channelForm.value.poolMembers).toHaveLength(2)
    expect(api.channelForm.value.visibilityConfig.groupIds).toEqual(['group-1'])

    wrapper.unmount()
  })

  it('clears optional routing thresholds to explicit null values', async () => {
    const { api, wrapper } = await mountComposable()

    api.channelForm.value.routingConfig.healthScoreThreshold = 0.7
    api.channelForm.value.routingConfig.latencyThresholdMs = 1200
    api.channelForm.value.routingConfig.circuitBreakerThreshold = 6

    api.clearOptionalRoutingThresholds()

    expect(api.channelForm.value.routingConfig.healthScoreThreshold).toBeNull()
    expect(api.channelForm.value.routingConfig.latencyThresholdMs).toBeNull()
    expect(api.channelForm.value.routingConfig.circuitBreakerThreshold).toBeNull()

    wrapper.unmount()
  })

  it('copies selected channel export JSON to the clipboard', async () => {
    const channel = createChannelRow()
    const { api, wrapper } = await mountComposable()
    api.channels.value = [channel]
    api.toggleChannelSelection(channel.id, true)
    exportChannelsMock.mockResolvedValue({ channels: [channel] })

    await api.copyChannelsAsJson()

    expect(exportChannelsMock).toHaveBeenCalledWith({
      ids: [channel.id],
      includeDisabled: true,
    })
    expect(copyTextWithFallbackMock).toHaveBeenCalledWith(
      JSON.stringify({ channels: [channel] }, null, 2),
    )
    expect(batchDuplicateChannelsMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('clones selected channels through the batch duplication API', async () => {
    const channel = createChannelRow()
    const { api, wrapper } = await mountComposable()
    api.channels.value = [channel]
    api.toggleChannelSelection(channel.id, true)
    batchDuplicateChannelsMock.mockResolvedValue([channel])

    await api.handleBatchDuplicateChannels()

    expect(batchDuplicateChannelsMock).toHaveBeenCalledWith([channel.id])
    expect(exportChannelsMock).not.toHaveBeenCalled()
    expect(copyTextWithFallbackMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('sends pooled channel payload with auto allowed-model mode, explicit null thresholds, and deduped whitelist fields', async () => {
    const { api, wrapper } = await mountComposable()

    listChannelsMock.mockResolvedValue([
      createChannelRow({ id: 'member-1', name: 'Member 1' }),
      createChannelRow({ id: 'member-2', name: 'Member 2' }),
    ])

    api.channelForm.value = {
      ...api.channelForm.value,
      name: 'Pooled Channel',
      channelType: 'pooled',
      routingStrategy: 'weighted-random',
      pooledAllowedModelsMode: 'auto',
      visibilityMode: 'whitelist',
      visibilityConfig: {
        userIds: ['user-1', 'user-1', ''],
        groupIds: ['group-1', ' group-2 ', 'group-1'],
        roleIds: ['role-1', '', 'role-1'],
      },
      poolMembers: [
        { memberChannelId: 'member-1', priority: 1, weight: 3, enabled: true },
        { memberChannelId: 'member-1', priority: 2, weight: 5, enabled: true },
        { memberChannelId: 'member-2', priority: 3, weight: 1, enabled: false },
        { memberChannelId: '', priority: 4, weight: 1, enabled: true },
      ],
      allowedFormats: ['openai'],
      allowedModelsArray: ['gpt-4o-mini'],
      routingConfig: {
        maxRetries: 2,
        failoverThreshold: 0,
        retryStatusCodes: ['5xx'],
        failbackCooldownMinutes: 5,
        healthScoreThreshold: null,
        latencyThresholdMs: null,
        circuitBreakerThreshold: null,
        stickyByModel: false,
        stickyByFormat: false,
      },
      openaiUpstreamUrl: '',
      openaiUpstreamApiKey: '',
      anthropicUpstreamUrl: '',
      anthropicUpstreamApiKey: '',
      geminiUpstreamUrl: '',
      geminiUpstreamApiKey: '',
    }

    await api.handleSaveChannel()
    await flushPromises()

    expect(createChannelMock).toHaveBeenCalledTimes(1)
    expect(createChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: 'pooled',
        routingStrategy: 'weighted-random',
        allowedModels: null,
        openaiUpstreamUrl: '',
        routingConfig: expect.objectContaining({
          maxRetries: 2,
          retryStatusCodes: ['5xx'],
          healthScoreThreshold: null,
          latencyThresholdMs: null,
          circuitBreakerThreshold: null,
          allowedModelsMode: 'auto',
        }),
        visibilityConfig: {
          userIds: ['user-1'],
          groupIds: ['group-1', 'group-2'],
          roleIds: ['role-1'],
        },
        poolMembers: [
          { memberChannelId: 'member-1', priority: 1, weight: 3, enabled: true },
          { memberChannelId: 'member-2', priority: 3, weight: 1, enabled: false },
        ],
      }),
    )

    wrapper.unmount()
  })

  it('sends pooled manual mode with explicit allowedModels JSON and all mode with null allowedModels', async () => {
    const { api, wrapper } = await mountComposable()

    api.channelForm.value = {
      ...api.channelForm.value,
      name: 'Pooled Manual Channel',
      channelType: 'pooled',
      pooledAllowedModelsMode: 'manual',
      allowedModelsArray: ['gpt-4o-mini', 'claude-3-5-sonnet'],
      poolMembers: [{ memberChannelId: 'member-1', priority: 1, weight: 1, enabled: true }],
      routingConfig: {
        maxRetries: 2,
        failoverThreshold: 0,
        retryStatusCodes: ['4xx', '5xx'],
        failbackCooldownMinutes: 5,
        healthScoreThreshold: null,
        latencyThresholdMs: null,
        circuitBreakerThreshold: null,
        stickyByModel: false,
        stickyByFormat: false,
      },
    }

    await api.handleSaveChannel()
    await flushPromises()

    expect(createChannelMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allowedModels: JSON.stringify(['gpt-4o-mini', 'claude-3-5-sonnet']),
        routingConfig: expect.objectContaining({
          allowedModelsMode: 'manual',
        }),
      }),
    )

    api.channelForm.value = {
      ...api.channelForm.value,
      name: 'Pooled All Channel',
      pooledAllowedModelsMode: 'all',
      allowedModelsArray: ['gpt-4o-mini'],
    }

    await api.handleSaveChannel()
    await flushPromises()

    expect(createChannelMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allowedModels: null,
        routingConfig: expect.objectContaining({
          allowedModelsMode: 'all',
        }),
      }),
    )

    wrapper.unmount()
  })

  it('sends standalone channel payload without pooled-only routing config and respects manual model restriction', async () => {
    const { api, wrapper } = await mountComposable()

    api.channelForm.value = {
      ...api.channelForm.value,
      name: 'Standalone Channel',
      channelType: 'standalone',
      pooledAllowedModelsMode: 'auto',
      routingStrategy: 'priority',
      restrictModels: true,
      allowedModelsArray: ['gpt-4o-mini'],
      visibilityMode: 'private',
      visibilityConfig: {
        userIds: ['user-1'],
        groupIds: ['group-1'],
        roleIds: ['role-1'],
      },
      poolMembers: [{ memberChannelId: 'member-1', priority: 1, weight: 1, enabled: true }],
      openaiUpstreamUrl: 'https://openai.example.com/v1',
      openaiUpstreamApiKey: 'openai-key',
      anthropicUpstreamUrl: '',
      anthropicUpstreamApiKey: '',
      geminiUpstreamUrl: '',
      geminiUpstreamApiKey: '',
      allowedFormats: ['openai'],
      routingConfig: {
        maxRetries: 9,
        failoverThreshold: 2,
        retryStatusCodes: ['5xx'],
        failbackCooldownMinutes: 10,
        healthScoreThreshold: 0.9,
        latencyThresholdMs: 1000,
        circuitBreakerThreshold: 5,
        stickyByModel: true,
        stickyByFormat: true,
      },
    }

    await api.handleSaveChannel()
    await flushPromises()

    expect(createChannelMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        channelType: 'standalone',
        routingConfig: null,
        poolMembers: [],
        allowedModels: JSON.stringify(['gpt-4o-mini']),
        visibilityMode: 'private',
        visibilityConfig: {
          userIds: ['user-1'],
          groupIds: ['group-1'],
          roleIds: ['role-1'],
        },
        openaiUpstreamUrl: 'https://openai.example.com/v1',
        openaiUpstreamApiKey: 'openai-key',
      }),
    )

    wrapper.unmount()
  })
})