// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const { profile, router, services } = vi.hoisted(() => ({
  profile: { id: 'public' },
  router: {
    hasRoute: vi.fn(() => true),
    resolve: vi.fn(() => ({ meta: {} })),
  },
  services: {
    balance: { getMyBalance: vi.fn() },
    balanceTransaction: { getMyTransactions: vi.fn() },
    chat: { getConversations: vi.fn() },
    developer: {
      getUsage: vi.fn(),
      listCallLogs: vi.fn(),
      listConfigs: vi.fn(),
      listInstances: vi.fn(),
      listManagedAccounts: vi.fn(),
    },
    group: { getAllGroups: vi.fn() },
    monthlyPass: { listMyUserPasses: vi.fn() },
    oauth: { getOAuthClients: vi.fn() },
    authCenter: { getAuthCenterClients: vi.fn() },
    ojKeys: { getAPIKeyStats: vi.fn(), listAPIKeys: vi.fn() },
    ojUsage: { getUsageStats: vi.fn() },
    ram: { listUsers: vi.fn(), listRoles: vi.fn(), listPolicies: vi.fn(), listSessions: vi.fn() },
    relayChannel: {
      listMySubmittedChannels: vi.fn(),
      listManagementChannels: vi.fn(),
      getChannelHealthOverview: vi.fn(),
    },
    relayToken: { getRelayTokens: vi.fn() },
    terminal: { listTemplates: vi.fn(), listEntitlements: vi.fn(), listDevices: vi.fn() },
    system: { getSystemStats: vi.fn() },
    user: { getAllUsers: vi.fn() },
  },
}))

vi.mock('@/router', () => ({ default: router, currentSiteProfile: profile }))
vi.mock('@/service/balanceService', () => ({ balanceService: services.balance }))
vi.mock('@/service/balanceTransactionService', () => ({
  balanceTransactionService: services.balanceTransaction,
}))
vi.mock('@/service/chatService', () => ({ chatService: services.chat }))
vi.mock('@/service/developerProductService', () => ({
  developerProductService: services.developer,
}))
vi.mock('@/service/groupService', () => ({ groupService: services.group }))
vi.mock('@/service/monthlyPassService', () => ({ monthlyPassService: services.monthlyPass }))
vi.mock('@/service/authCenterClientService', () => ({
  AuthCenterClientService: { getInstance: () => services.authCenter },
}))
vi.mock('@/service/oauthClientService', () => ({
  OAuthClientService: { getInstance: () => services.oauth },
}))
vi.mock('@/service/ojAPIKeyService', () => ({
  OJAPIKeyService: { getInstance: () => services.ojKeys },
}))
vi.mock('@/service/ojUsageService', () => ({
  OJUsageService: { getInstance: () => services.ojUsage },
}))
vi.mock('@/service/ramService', () => ({ ramService: services.ram }))
vi.mock('@/service/relayChannelService', () => ({ relayChannelService: services.relayChannel }))
vi.mock('@/service/relayTokenService', () => ({ relayTokenService: services.relayToken }))
vi.mock('@/service/remoteTerminalProductService', () => ({
  remoteTerminalProductService: services.terminal,
}))
vi.mock('@/service/systemService', () => ({ default: services.system }))
vi.mock('@/service/userService', () => ({ userService: services.user }))

import { Permission } from '@/constant/permission'
import { useSiteOverview } from '@/composables/useSiteOverview'
import { usePermissionStore } from '@/stores/permissionStore'

let overview: ReturnType<typeof useSiteOverview>

const mountOverview = async (permissions: Permission[] = []) => {
  const permissionStore = usePermissionStore()
  permissionStore.currentUserPermissions = {
    userId: 'user-1',
    groupPermissions: [],
    additionalPermissions: [],
    removedPermissions: [],
    effectivePermissions: permissions,
  }

  mount({
    setup() {
      overview = useSiteOverview()
      return () => null
    },
  })
  await flushPromises()
}

const metric = (id: string) => overview.metrics.value.find((item) => item.id === id)
const detail = (id: string) => overview.details.value.find((item) => item.id === id)
const chart = (id: string) => overview.charts.value.find((item) => item.id === id)

describe('useSiteOverview', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    profile.id = 'public'
    for (const service of Object.values(services)) {
      for (const method of Object.values(service)) {
        method.mockReset()
      }
    }
  })

  it('does not load metrics for guest site overviews', async () => {
    await mountOverview()

    expect(services.balance.getMyBalance).not.toHaveBeenCalled()
    expect(services.chat.getConversations).not.toHaveBeenCalled()
    expect(services.developer.getUsage).not.toHaveBeenCalled()
    expect(services.relayToken.getRelayTokens).not.toHaveBeenCalled()
    expect(overview.metrics.value).toEqual([])
  })

  it('builds account balance charts from recent transaction records', async () => {
    profile.id = 'account'
    services.balance.getMyBalance.mockResolvedValue({ balance: 28 })
    services.monthlyPass.listMyUserPasses.mockResolvedValue({ total: 0, records: [] })
    services.balanceTransaction.getMyTransactions.mockResolvedValue({
      data: {
        records: [
          {
            id: 'credit-1',
            category: 'recharge',
            amount: 20,
            createTime: '2026-08-14T01:00:00.000Z',
          },
          {
            id: 'debit-1',
            category: 'api_usage',
            amount: -3,
            createTime: '2026-08-14T02:00:00.000Z',
          },
        ],
      },
    })

    await mountOverview()

    expect(services.balanceTransaction.getMyTransactions).toHaveBeenCalledWith({
      limit: 30,
      offset: 0,
    })
    expect(detail('balance-transaction-0')).toMatchObject({ value: 20 })
    expect(chart('balance-activity')).toMatchObject({ kind: 'line' })
    expect(chart('balance-category')).toMatchObject({ kind: 'donut' })
  })

  it('loads the matching product usage and remaining free quota', async () => {
    profile.id = 'product-kv'
    services.developer.getUsage.mockResolvedValue({
      entitlementId: 'entitlement-kv',
      requestCount: 42,
      dailyFreeQuota: 60,
      remainingFree: 18,
      unlimited: false,
      overageEnabled: true,
    })
    services.developer.listInstances.mockResolvedValue([
      { id: 'instance-1', name: 'primary', enabled: true },
    ])
    services.developer.listCallLogs.mockResolvedValue([
      { id: 'call-1', action: 'read', success: true, createTime: '2026-08-14T00:00:00.000Z' },
    ])

    await mountOverview()

    expect(services.developer.getUsage).toHaveBeenCalledWith('kv')
    expect(metric('requests')).toMatchObject({ value: 42 })
    expect(metric('quota')).toMatchObject({ value: 18 })
    expect(metric('product-instances')).toMatchObject({ value: 1 })
    expect(metric('product-active-instances')).toMatchObject({ value: 1 })
    expect(metric('product-call-success-rate')).toMatchObject({ value: '100%' })
    expect(detail('product-entitlement')).toMatchObject({ value: 'entitlement-kv' })
    expect(detail('product-daily-quota')).toMatchObject({ value: 60 })
    expect(detail('product-overage')).toMatchObject({ value: 'enabled' })
    expect(detail('product-instance-0')).toMatchObject({ label: 'primary', value: 'enabled' })
    expect(detail('product-call-0')).toMatchObject({ label: 'read', value: 'enabled' })
    expect(chart('product-call-trend')).toMatchObject({ kind: 'line' })
    expect(chart('product-call-outcome')).toMatchObject({ kind: 'donut' })
    expect(overview.breakdown.value).toEqual([
      expect.objectContaining({ id: 'used', value: 42 }),
      expect.objectContaining({ id: 'remaining', value: 18 }),
    ])
  })

  it('uses the loaded resource records as overview details', async () => {
    profile.id = 'console-ai'
    services.relayToken.getRelayTokens.mockResolvedValue({
      total: 2,
      items: [
        { id: 'token-1', name: 'Primary', requestCount: 11, channelName: 'Main' },
        { id: 'token-2', name: 'Backup', requestCount: 3, channelName: 'Fallback' },
      ],
    })

    await mountOverview([Permission.RELAY_TOKEN_READ])

    expect(services.relayToken.getRelayTokens).toHaveBeenCalledWith({ page: 1, pageSize: 6 })
    expect(detail('relay-token-0')).toMatchObject({ label: 'Primary', value: 11 })
    expect(detail('relay-token-1')).toMatchObject({ label: 'Backup', value: 3 })
    expect(chart('relay-token-requests')).toMatchObject({ kind: 'bar' })
    const routes = overview.featurePreviews.value.map((preview) => preview.route)
    expect(routes).toEqual(expect.arrayContaining(['relayTokenManagement', 'apiDocumentation']))
    expect(routes).not.toContain('relayChannelProvider')
    expect(
      overview.featurePreviews.value.find((preview) => preview.route === 'relayTokenManagement'),
    ).toMatchObject({ value: 2, hasData: true })
  })

  it('builds recent OJ usage and model-token charts from returned usage records', async () => {
    profile.id = 'product-oj'
    services.ojKeys.listAPIKeys.mockResolvedValue([
      { id: 'key-1', name: 'Primary', requestCount: 4, channelName: 'OJ' },
    ])
    services.ojKeys.getAPIKeyStats.mockResolvedValue({ totalKeys: 1, activeKeys: 1 })
    services.ojUsage.getUsageStats.mockResolvedValue({
      requestCount: 3,
      totalTokens: 180,
      usages: [
        {
          id: 'usage-1',
          model: 'gpt-4o-mini',
          totalTokens: 120,
          createTime: '2026-08-14T01:00:00.000Z',
        },
        { id: 'usage-2', model: 'gpt-4o', totalTokens: 60, createTime: '2026-08-15T01:00:00.000Z' },
      ],
    })

    await mountOverview()

    expect(services.ojUsage.getUsageStats).toHaveBeenCalledWith({ page: 1, pageSize: 6 })
    expect(chart('oj-recent-usage')).toMatchObject({ kind: 'line' })
    expect(chart('oj-model-tokens')).toMatchObject({
      kind: 'donut',
      items: expect.arrayContaining([
        expect.objectContaining({ label: 'gpt-4o-mini', value: 120 }),
      ]),
    })
  })

  it('does not request management-terminal data without its matching permissions', async () => {
    profile.id = 'management-terminal'

    await mountOverview()

    expect(services.terminal.listTemplates).not.toHaveBeenCalled()
    expect(services.terminal.listEntitlements).not.toHaveBeenCalled()
    expect(services.terminal.listDevices).not.toHaveBeenCalled()
  })

  it('projects product-specific management statistics onto each product route', async () => {
    profile.id = 'management-developer'
    services.developer.listManagedAccounts.mockImplementation(async (code: string) => ({
      total: code === 'kv' ? 3 : 1,
      records: [],
    }))
    services.developer.listConfigs.mockResolvedValue([
      { productCode: 'kv', enabled: true },
      { productCode: 'secret', enabled: false },
    ])

    await mountOverview([
      Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE,
      Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE,
    ])

    expect(
      overview.featurePreviews.value.find((preview) => preview.route === 'product-management-kv'),
    ).toMatchObject({ value: 3, hasData: true })
    expect(
      overview.featurePreviews.value.find((preview) => preview.route === 'product-config-kv'),
    ).toMatchObject({ value: 1, hasData: true })
    expect(
      overview.featurePreviews.value.find((preview) => preview.route === 'product-config-secret'),
    ).toMatchObject({ value: 0, hasData: true })
  })

  it('uses paged user and group totals when system-stat access is unavailable', async () => {
    profile.id = 'management-core'
    services.user.getAllUsers.mockResolvedValue({ total: 11 })
    services.group.getAllGroups.mockResolvedValue({ total: 4 })

    await mountOverview([Permission.USER_READ, Permission.GROUP_READ])

    expect(services.system.getSystemStats).not.toHaveBeenCalled()
    expect(services.user.getAllUsers).toHaveBeenCalledWith({ page: 1, pageSize: 1 })
    expect(services.group.getAllGroups).toHaveBeenCalledWith({ page: 1, pageSize: 1 })
    expect(metric('users')).toMatchObject({ value: 11 })
    expect(metric('groups')).toMatchObject({ value: 4 })
  })

  it('loads only enabled RAM resource metrics', async () => {
    profile.id = 'console-ram'
    services.ram.listUsers.mockResolvedValue([{ id: 'ram-user-1' }])
    services.ram.listSessions.mockResolvedValue([{ id: 'ram-session-1' }, { id: 'ram-session-2' }])

    await mountOverview([Permission.RAM_USER_READ, Permission.RAM_SESSION_READ])

    expect(services.ram.listUsers).toHaveBeenCalledOnce()
    expect(services.ram.listSessions).toHaveBeenCalledOnce()
    expect(services.ram.listRoles).not.toHaveBeenCalled()
    expect(services.ram.listPolicies).not.toHaveBeenCalled()
    expect(metric('ram-users')).toMatchObject({ value: 1 })
    expect(metric('ram-sessions')).toMatchObject({ value: 2 })
  })

  it('loads AI relay health independently from channel-list permission', async () => {
    profile.id = 'management-ai'
    services.relayChannel.getChannelHealthOverview.mockResolvedValue({
      channels: [
        {
          name: 'primary',
          enabled: true,
          availability: 1,
          status2xxCount: 10,
          status3xxCount: 0,
          status4xxCount: 0,
          status5xxCount: 1,
          statusOtherCount: 0,
        },
        {
          name: 'backup',
          enabled: true,
          availability: 0.5,
          status2xxCount: 4,
          status3xxCount: 0,
          status4xxCount: 1,
          status5xxCount: 0,
          statusOtherCount: 0,
        },
      ],
    })

    await mountOverview([Permission.RELAY_CHANNEL_HEALTH_READ])

    expect(services.relayChannel.listManagementChannels).not.toHaveBeenCalled()
    expect(services.relayChannel.getChannelHealthOverview).toHaveBeenCalledOnce()
    expect(metric('healthy-channels')).toMatchObject({ value: 1 })
    expect(chart('channel-availability')).toMatchObject({ kind: 'bar' })
    expect(chart('channel-http-status')).toMatchObject({ kind: 'donut' })
  })
})
