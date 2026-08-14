// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref, shallowRef } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useRelaySettingsManagement,
  type RelaySettingsManagementState,
} from '@/views/relay/relay-settings/useRelaySettingsManagement'
import type { RelayChannelDto } from '@/client/types.gen'

const {
  createChannelMock,
  updateChannelMock,
  listChannelsMock,
  listManagementChannelsMock,
  getChannelMock,
  listUpstreamModelsMock,
  exportChannelsMock,
  batchDuplicateChannelsMock,
  batchUpdateChannelsMock,
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
  listManagementChannelsMock: vi.fn(),
  getChannelMock: vi.fn(),
  listUpstreamModelsMock: vi.fn(),
  exportChannelsMock: vi.fn(),
  batchDuplicateChannelsMock: vi.fn(),
  batchUpdateChannelsMock: vi.fn(),
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
    listManagementChannels: listManagementChannelsMock,
    getChannel: getChannelMock,
    listUpstreamModels: listUpstreamModelsMock,
    createChannel: createChannelMock,
    updateChannel: updateChannelMock,
    exportChannels: exportChannelsMock,
    importChannels: vi.fn(),
    duplicateChannel: vi.fn(),
    batchDuplicateChannels: batchDuplicateChannelsMock,
    batchUpdateChannels: batchUpdateChannelsMock,
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
  channelTopologyMode: 'strict-two-tier',
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

const createChannelRow = (overrides: Partial<RelayChannelDto> = {}): RelayChannelDto => ({
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
    setActivePinia(createPinia())
    vi.clearAllMocks()
    getRelayConfigMock.mockResolvedValue(createRelayConfigResponse())
    updateRelayConfigMock.mockResolvedValue(undefined)
    getSystemRelayConfigMock.mockResolvedValue(createSystemRelayConfigResponse())
    setRelayConfigMock.mockResolvedValue(undefined)
    listChannelsMock.mockResolvedValue([])
    listManagementChannelsMock.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    getChannelMock.mockResolvedValue(createChannelRow())
    listUpstreamModelsMock.mockResolvedValue({ format: 'openai', models: [] })
    exportChannelsMock.mockResolvedValue({ channels: [] })
    createChannelMock.mockResolvedValue({ id: 'created-channel' })
    updateChannelMock.mockResolvedValue({ id: 'updated-channel' })
    getAllUsersMock.mockResolvedValue({ users: [] })
    getAllGroupsMock.mockResolvedValue([])
    listRolesMock.mockResolvedValue([])
    copyTextWithFallbackMock.mockResolvedValue(true)
  })

  it('shows the OpenAI upstream editor for every explicit OpenAI format', async () => {
    const { api, wrapper } = await mountComposable()

    expect(api.computeShowUpstream(['openai-chat-completions'], 'openai')).toBe(true)
    expect(api.computeShowUpstream(['openai-responses'], 'openai')).toBe(true)
    expect(api.computeShowUpstream(['anthropic'], 'openai')).toBe(false)

    wrapper.unmount()
  })

  it('normalizes legacy catalog formats before filtering models in the channel drawer', async () => {
    const { api, wrapper } = await mountComposable()

    // Existing pricing rows can still contain the legacy `openai` label,
    // while channel forms consistently use the explicit wire format.
    api.channelForm.value.allowedFormats = ['openai-chat-completions']

    expect(api.filteredModels.value.map((model) => model.model)).toEqual(['gpt-4o-mini'])

    wrapper.unmount()
  })

  it('discovers /v1/models for the channel upstream and adds selected catalog matches', async () => {
    const { api, wrapper } = await mountComposable()
    api.openEditChannelDialog(
      createChannelRow({
        id: 'channel-for-probe',
        allowedFormats: 'openai-chat-completions',
        openaiUpstreamUrl: 'https://openai.example.com/v1',
        hasOpenaiUpstreamApiKey: true,
      }),
    )
    listUpstreamModelsMock.mockResolvedValue({
      format: 'openai',
      models: [
        { id: 'gpt-4o-mini', matched: true, pricingModel: 'gpt-4o-mini' },
        { id: 'unpriced-model', matched: false },
      ],
    })

    await api.probeUpstreamModels('openai')

    expect(listUpstreamModelsMock).toHaveBeenCalledWith({
      format: 'openai',
      upstreamUrl: 'https://openai.example.com/v1',
      apiKey: undefined,
      channelId: 'channel-for-probe',
    })
    expect(api.upstreamModelProbeResults.openai).toHaveLength(2)
    expect(api.selectedUpstreamProbeModels.openai).toEqual(['gpt-4o-mini'])

    api.addUpstreamProbeModels('openai')

    expect(api.channelForm.value.allowedModelsArray).toEqual(['gpt-4o-mini'])
    expect(api.channelForm.value.restrictModels).toBe(true)
    expect(messageSuccessMock).toHaveBeenCalledWith('已加入模型限制。')
    wrapper.unmount()
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
          {
            memberChannelId: 'member-2',
            priority: 2,
            weight: 1,
            enabled: false,
            memberChannelEnabled: false,
          },
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
    expect(api.channelForm.value.poolMembers[1]?.memberChannelEnabled).toBe(false)
    expect(api.channelForm.value.visibilityConfig.groupIds).toEqual(['group-1'])

    wrapper.unmount()
  })

  it('loads physical members for a logical pool and assigns them when saving', async () => {
    const { api, wrapper } = await mountComposable()
    api.channelForm.value = {
      ...api.channelForm.value,
      name: 'Logical Pool',
      channelType: 'pooled',
      poolMembers: [],
    }
    listManagementChannelsMock.mockResolvedValue({
      items: [
        {
          id: 'physical-member-1',
          name: 'Physical Member 1',
          enabled: true,
          channelType: 'pooled-member',
          routingStrategy: 'priority',
          visibilityMode: 'hidden',
          poolMemberCount: 0,
          multiplier: 1,
          updateTime: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    })
    createChannelMock.mockResolvedValue({ id: 'logical-pool-1' })

    await api.openPoolMemberPicker()

    expect(listManagementChannelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ channelType: 'pooled-member' }),
    )
    api.selectedPoolMemberCandidateIds.value = ['physical-member-1']
    api.addSelectedPoolMembers()
    expect(api.channelForm.value.poolMembers[0]?.memberChannelId).toBe('physical-member-1')

    await api.handleSaveChannel()
    expect(updateChannelMock).toHaveBeenCalledWith(
      'physical-member-1',
      expect.objectContaining({
        channelType: 'pooled-member',
        pooledParentId: 'logical-pool-1',
        pooledPriority: 1,
      }),
    )
    wrapper.unmount()
  })

  it('loads pooled and standalone candidates for automatic proxy pools and saves standalone members', async () => {
    const { api, wrapper } = await mountComposable()
    api.channelForm.value = {
      ...api.channelForm.value,
      name: 'Automatic Pool',
      channelType: 'automatic-proxy-pool',
      poolMembers: [],
    }
    listManagementChannelsMock.mockResolvedValue({
      items: [
        {
          id: 'standalone-member-1',
          name: 'Standalone Member 1',
          enabled: true,
          channelType: 'standalone',
        },
        {
          id: 'logical-pool-1',
          name: 'Logical Pool 1',
          enabled: true,
          channelType: 'pooled',
        },
      ],
      page: 1,
      pageSize: 25,
      total: 2,
    })
    createChannelMock.mockResolvedValue({ id: 'automatic-pool-1' })

    await api.openPoolMemberPicker()

    expect(listManagementChannelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ channelTypes: ['pooled', 'standalone'], channelType: undefined }),
    )
    expect(api.poolMemberPickerRows.value.map((row) => row.id)).toEqual([
      'standalone-member-1',
      'logical-pool-1',
    ])

    api.selectedPoolMemberCandidateIds.value = ['standalone-member-1']
    api.addSelectedPoolMembers()
    await api.handleSaveChannel()

    expect(createChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: 'automatic-proxy-pool',
        poolMembers: [
          { memberChannelId: 'standalone-member-1', priority: 1, weight: 1, enabled: true },
        ],
      }),
    )
    wrapper.unmount()
  })

  it('falls back to full channel details when logical pool options cannot be loaded from management', async () => {
    const { api, wrapper } = await mountComposable()
    listManagementChannelsMock.mockRejectedValue(new Error('management unavailable'))
    listChannelsMock.mockResolvedValue([
      createChannelRow({ id: 'pool-1', name: 'Fallback Pool', channelType: 'pooled' }),
    ])

    api.openEditChannelDialog(
      createChannelRow({
        id: 'physical-member-1',
        channelType: 'pooled-member',
        pooledParentId: 'pool-1',
      }),
    )
    await flushPromises()

    expect(api.pooledParentOptions.value).toEqual([
      expect.objectContaining({ id: 'pool-1', name: 'Fallback Pool' }),
    ])
    wrapper.unmount()
  })

  it('loads logical pool options when editing a standalone channel before converting it to a physical member', async () => {
    listManagementChannelsMock.mockResolvedValue({
      items: [
        {
          id: 'logical-pool-1',
          name: 'Claude-GWL',
          enabled: true,
          channelType: 'pooled',
          routingStrategy: 'priority',
          visibilityMode: 'public',
          poolMemberCount: 2,
          multiplier: 1,
          updateTime: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    })
    const { api, wrapper } = await mountComposable()

    api.openEditChannelDialog(
      createChannelRow({ id: 'legacy-member-1', channelType: 'standalone' }),
    )
    await flushPromises()

    expect(api.pooledParentOptions.value).toEqual([
      expect.objectContaining({ id: 'logical-pool-1', name: 'Claude-GWL' }),
    ])
    wrapper.unmount()
  })

  it('sends legacy pooled members instead of clearing the existing member relation', async () => {
    getRelayConfigMock.mockResolvedValue({
      ...createRelayConfigResponse(),
      channelTopologyMode: 'legacy',
    })
    const { api, wrapper } = await mountComposable()

    api.channelForm.value = {
      ...api.channelForm.value,
      name: 'Legacy Pooled Channel',
      channelType: 'pooled',
      poolMembers: [{ memberChannelId: 'legacy-member', priority: 1, weight: 1, enabled: true }],
    }

    await api.handleSaveChannel()

    expect(createChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: 'pooled',
        poolMembers: [{ memberChannelId: 'legacy-member', priority: 1, weight: 1, enabled: true }],
      }),
    )
    expect(updateChannelMock).not.toHaveBeenCalled()
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

  it('keeps pool-member priority contiguous while moving and deleting members', async () => {
    const { api, wrapper } = await mountComposable()
    api.channelForm.value.poolMembers = [
      { memberChannelId: 'member-1', priority: 1, weight: 1, enabled: true },
      { memberChannelId: 'member-2', priority: 2, weight: 1, enabled: true },
      { memberChannelId: 'member-3', priority: 3, weight: 1, enabled: true },
    ]

    api.movePoolMember(2, 0)
    expect(api.channelForm.value.poolMembers.map((member) => member.memberChannelId)).toEqual([
      'member-3',
      'member-1',
      'member-2',
    ])
    expect(api.channelForm.value.poolMembers.map((member) => member.priority)).toEqual([1, 2, 3])

    api.removePoolMember(1)
    expect(api.channelForm.value.poolMembers.map((member) => member.priority)).toEqual([1, 2])
    wrapper.unmount()
  })

  it('loads only the requested management page and preserves cross-page selection', async () => {
    const { api, wrapper } = await mountComposable()
    listManagementChannelsMock.mockResolvedValue({
      items: [
        {
          id: 'page-2-channel',
          name: 'Page 2',
          enabled: true,
          channelType: 'standalone',
          routingStrategy: 'priority',
          visibilityMode: 'public',
          poolMemberCount: 0,
          multiplier: 1,
          updateTime: new Date().toISOString(),
        },
      ],
      total: 26,
      page: 2,
      pageSize: 25,
    })

    api.toggleChannelSelection('selected-on-page-1', true)
    api.updateChannelPagination(2)
    await flushPromises()

    expect(listManagementChannelsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, pageSize: 25 }),
    )
    expect(api.channelRows.value).toHaveLength(1)
    expect(api.selectedChannelCount.value).toBe(1)
    wrapper.unmount()
  })

  it('caches pool member tooltip details after loading them once', async () => {
    const { api, wrapper } = await mountComposable()
    const channel = createChannelRow({
      id: 'pooled-channel',
      channelType: 'pooled',
      poolMembers: [
        {
          memberChannelId: 'member-1',
          memberChannelName: 'Primary member',
          priority: 1,
          weight: 2,
          enabled: true,
        },
      ],
    })
    getChannelMock.mockResolvedValue(channel)

    await api.loadPoolMemberTooltip({ id: channel.id })
    await api.loadPoolMemberTooltip({ id: channel.id })

    expect(getChannelMock).toHaveBeenCalledTimes(1)
    expect(api.poolMemberTooltipDetails.value[channel.id]).toEqual(channel)
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

  it('copies all channel export JSON without changing the current selection', async () => {
    const selectedChannel = createChannelRow({ id: 'selected-channel' })
    const allChannels = [selectedChannel, createChannelRow({ id: 'other-channel' })]
    const { api, wrapper } = await mountComposable()
    api.channels.value = allChannels
    api.toggleChannelSelection(selectedChannel.id, true)
    exportChannelsMock.mockResolvedValue({ channels: allChannels })

    await api.copyAllChannelsAsJson()

    expect(exportChannelsMock).toHaveBeenCalledWith({ includeDisabled: true })
    expect(copyTextWithFallbackMock).toHaveBeenCalledWith(
      JSON.stringify({ channels: allChannels }, null, 2),
    )
    expect(api.selectedChannelCount.value).toBe(1)

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

  it('submits batch edits for the selected channels and retains rejected rows for retry', async () => {
    const { api, wrapper } = await mountComposable()
    api.toggleChannelSelection('updated-channel', true)
    api.toggleChannelSelection('rejected-channel', true)
    batchUpdateChannelsMock.mockResolvedValue({
      updated: [createChannelRow({ id: 'updated-channel' })],
      rejected: [{ id: 'rejected-channel', reason: 'Unsupported model' }],
    })

    const result = await api.handleBatchUpdateChannels({
      patch: { multiplier: 0.8 },
      modelPricingMigration: {
        sourceModelId: 'gpt-5.6-luna',
        targetPricingModel: 'gpt-5.6-luna-disc-1',
      },
    })

    expect(batchUpdateChannelsMock).toHaveBeenCalledWith({
      ids: ['updated-channel', 'rejected-channel'],
      patch: { multiplier: 0.8 },
      modelPricingMigration: {
        sourceModelId: 'gpt-5.6-luna',
        targetPricingModel: 'gpt-5.6-luna-disc-1',
      },
    })
    expect(result.rejected).toHaveLength(1)
    expect(api.selectedChannelCount.value).toBe(1)
    expect(api.isChannelSelected('rejected-channel')).toBe(true)
    wrapper.unmount()
  })

  it('sends logical pooled channel pricing and routing settings without legacy direct members', async () => {
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
        poolMembers: [],
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

  it('sends standalone channel payload with health tracking only and respects manual model restriction', async () => {
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
        routingConfig: {
          healthTrackingMode: 'automatic',
        },
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
