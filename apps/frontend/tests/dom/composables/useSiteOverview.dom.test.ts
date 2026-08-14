// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const { profile, services } = vi.hoisted(() => ({
  profile: { id: 'public' },
  services: {
    balance: { getMyBalance: vi.fn() },
    chat: { getConversations: vi.fn() },
    developer: { getUsage: vi.fn(), listManagedAccounts: vi.fn(), listConfigs: vi.fn() },
    group: { getAllGroups: vi.fn() },
    monthlyPass: { listMyUserPasses: vi.fn() },
    oauth: { getOAuthClients: vi.fn() },
    authCenter: { getAuthCenterClients: vi.fn() },
    ojKeys: { getAPIKeyStats: vi.fn() },
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

vi.mock('@/router', () => ({ currentSiteProfile: profile }))
vi.mock('@/service/balanceService', () => ({ balanceService: services.balance }))
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

  it('loads the matching product usage and remaining free quota', async () => {
    profile.id = 'product-kv'
    services.developer.getUsage.mockResolvedValue({
      requestCount: 42,
      remainingFree: 18,
      unlimited: false,
    })

    await mountOverview()

    expect(services.developer.getUsage).toHaveBeenCalledWith('kv')
    expect(metric('requests')).toMatchObject({ value: 42 })
    expect(metric('quota')).toMatchObject({ value: 18 })
  })

  it('does not request management-terminal data without its matching permissions', async () => {
    profile.id = 'management-terminal'

    await mountOverview()

    expect(services.terminal.listTemplates).not.toHaveBeenCalled()
    expect(services.terminal.listEntitlements).not.toHaveBeenCalled()
    expect(services.terminal.listDevices).not.toHaveBeenCalled()
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
        { enabled: true, availability: 1 },
        { enabled: true, availability: 0.5 },
      ],
    })

    await mountOverview([Permission.RELAY_CHANNEL_HEALTH_READ])

    expect(services.relayChannel.listManagementChannels).not.toHaveBeenCalled()
    expect(services.relayChannel.getChannelHealthOverview).toHaveBeenCalledOnce()
    expect(metric('healthy-channels')).toMatchObject({ value: 1 })
  })
})
