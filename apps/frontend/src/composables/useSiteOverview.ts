import { computed, onMounted, ref } from 'vue'
import type { DeveloperProductCode } from '@/client/types.gen'
import { siteOverviewMetricProfileIds } from '@/config/site-overview'
import { Permission } from '@/constant/permission'
import type { I18nENAvailableKeys } from '@/locales'
import { currentSiteProfile } from '@/router'
import { balanceService } from '@/service/balanceService'
import { chatService } from '@/service/chatService'
import { developerProductService } from '@/service/developerProductService'
import { groupService } from '@/service/groupService'
import { monthlyPassService } from '@/service/monthlyPassService'
import { AuthCenterClientService } from '@/service/authCenterClientService'
import { OJAPIKeyService } from '@/service/ojAPIKeyService'
import { OJUsageService } from '@/service/ojUsageService'
import { OAuthClientService } from '@/service/oauthClientService'
import { ramService } from '@/service/ramService'
import { relayChannelService } from '@/service/relayChannelService'
import { relayTokenService } from '@/service/relayTokenService'
import { remoteTerminalProductService } from '@/service/remoteTerminalProductService'
import systemService from '@/service/systemService'
import { userService } from '@/service/userService'
import { usePermissionStore } from '@/stores/permissionStore'
import type { RouteName } from '@/types/route-types.gen'

export type SiteOverviewMetric = {
  id: string
  labelKey: I18nENAvailableKeys
  value: string | number
  descriptionKey?: I18nENAvailableKeys
}

export type SiteOverviewAction = {
  route: RouteName
  labelKey: I18nENAvailableKeys
  permission?: Permission | readonly Permission[]
}

export { siteOverviewMetricProfileIds }

const productCodeByProfile: Partial<
  Record<(typeof currentSiteProfile)['id'], DeveloperProductCode>
> = {
  'product-kv': 'kv',
  'product-short_link': 'short_link',
  'product-secret': 'secret',
  'product-status': 'status',
  'product-verification': 'verification',
  'product-ip_geolocation': 'ip_geolocation',
  'product-push': 'push',
}

const productRouteByCode: Record<DeveloperProductCode, RouteName> = {
  kv: 'product-kv',
  short_link: 'product-short_link',
  secret: 'product-secret',
  status: 'product-status',
  verification: 'product-verification',
  ip_geolocation: 'product-ip_geolocation',
  push: 'product-push',
}

const productLabelKeyByCode: Record<DeveloperProductCode, I18nENAvailableKeys> = {
  kv: 'nav.productKv',
  short_link: 'nav.productShortLink',
  secret: 'nav.productSecret',
  status: 'nav.productStatus',
  verification: 'nav.productVerification',
  ip_geolocation: 'nav.productIpGeolocation',
  push: 'nav.productPush',
}

const managementProductCodes: readonly DeveloperProductCode[] = [
  'kv',
  'short_link',
  'secret',
  'status',
  'verification',
  'ip_geolocation',
  'push',
]

const oauthClientService = OAuthClientService.getInstance()
const authCenterClientService = AuthCenterClientService.getInstance()

const formatRemainingQuota = (value: number, unlimited: boolean) =>
  unlimited ? 'unlimited' : value

export const useSiteOverview = () => {
  const permissionStore = usePermissionStore()
  const metrics = ref<SiteOverviewMetric[]>([])
  const loading = ref(false)
  const partialFailure = ref(false)

  const can = (permissions: Permission | readonly Permission[]) => {
    const values = Array.isArray(permissions) ? permissions : [permissions]
    return permissionStore.hasAnyPermission(...values)
  }

  const actions = computed<SiteOverviewAction[]>(() => {
    switch (currentSiteProfile.id) {
      case 'account':
        return [
          { route: 'settingsProfile', labelKey: 'siteOverview.actions.accountSettings' },
          { route: 'myMonthlyPasses', labelKey: 'siteOverview.actions.subscriptions' },
        ]
      case 'public':
        return [{ route: 'home', labelKey: 'siteOverview.actions.openHome' }]
      case 'identity':
        return [
          { route: 'login', labelKey: 'siteOverview.actions.login' },
          { route: 'register', labelKey: 'siteOverview.actions.register' },
        ]
      case 'chat':
        return [{ route: 'chat', labelKey: 'siteOverview.actions.openChat' }]
      case 'console-ai':
        return (
          [
            {
              route: 'relayTokenManagement',
              labelKey: 'siteOverview.actions.manageRelayTokens',
              permission: Permission.RELAY_TOKEN_READ,
            },
            {
              route: 'relayChannelProvider',
              labelKey: 'siteOverview.actions.manageRelayChannels',
              permission: [Permission.RELAY_CHANNEL_SUBMIT, Permission.RELAY_CHANNEL_PROVIDER_READ],
            },
          ] satisfies SiteOverviewAction[]
        ).filter((action) => !action.permission || can(action.permission))
      case 'console-developer':
        return (
          [
            {
              route: 'oauthClientManagement',
              labelKey: 'siteOverview.actions.manageOAuthClients',
              permission: Permission.OAUTH_CLIENT_READ,
            },
            {
              route: 'authCenterClientManagement',
              labelKey: 'siteOverview.actions.manageAuthCenterClients',
              permission: Permission.AUTH_CENTER_CLIENT_READ,
            },
          ] satisfies SiteOverviewAction[]
        ).filter((action) => !action.permission || can(action.permission))
      case 'console-ram':
        return (
          [
            {
              route: 'ramManagement',
              labelKey: 'siteOverview.actions.manageRamUsers',
              permission: Permission.RAM_USER_READ,
            },
            {
              route: 'ramRoles',
              labelKey: 'siteOverview.actions.manageRamRoles',
              permission: Permission.RAM_ROLE_READ,
            },
          ] as SiteOverviewAction[]
        ).filter((action) => !action.permission || can(action.permission))
      case 'product-oj':
        return (
          [
            {
              route: 'ojAPIKeyManagement',
              labelKey: 'siteOverview.actions.manageOjKeys',
              permission: Permission.OJ_APIKEY_READ,
            },
            {
              route: 'ojUsageStatistics',
              labelKey: 'siteOverview.actions.viewOjUsage',
              permission: Permission.OJ_USAGE_READ,
            },
          ] satisfies SiteOverviewAction[]
        ).filter((action) => !action.permission || can(action.permission))
      case 'management-ai':
        return (
          [
            {
              route: 'relaySettings',
              labelKey: 'siteOverview.actions.manageRelaySettings',
              permission: Permission.MODEL_PRICING_UPDATE,
            },
            {
              route: 'relayChannelHealth',
              labelKey: 'siteOverview.actions.viewRelayHealth',
              permission: Permission.RELAY_CHANNEL_HEALTH_READ,
            },
          ] satisfies SiteOverviewAction[]
        ).filter((action) => !action.permission || can(action.permission))
      case 'management-developer':
        return (
          [
            {
              route: 'developerServiceManagement',
              labelKey: 'siteOverview.actions.manageDeveloperQuota',
              permission: Permission.DEVELOPER_QUOTA_MANAGE,
            },
            {
              route: 'developerServiceConfig',
              labelKey: 'siteOverview.actions.configureProducts',
              permission: Permission.SYSTEM_CONFIG,
            },
          ] satisfies SiteOverviewAction[]
        ).filter((action) => !action.permission || can(action.permission))
      case 'management-terminal':
        return (
          [
            {
              route: 'remoteTerminalProductTemplates',
              labelKey: 'siteOverview.actions.manageTerminalTemplates',
              permission: Permission.REMOTE_TERMINAL_PRODUCT_READ,
            },
            {
              route: 'remoteTerminalProductEntitlements',
              labelKey: 'siteOverview.actions.manageTerminalEntitlements',
              permission: Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
            },
          ] satisfies SiteOverviewAction[]
        ).filter((action) => !action.permission || can(action.permission))
      case 'management-core':
        return (
          [
            {
              route: 'userManagement',
              labelKey: 'siteOverview.actions.manageUsers',
              permission: Permission.USER_READ,
            },
            {
              route: 'groupManagement',
              labelKey: 'siteOverview.actions.manageGroups',
              permission: Permission.GROUP_READ,
            },
            {
              route: 'iamAuthorizations',
              labelKey: 'siteOverview.actions.manageAuthorizations',
              permission: Permission.PERMISSION_VIEW,
            },
          ] satisfies SiteOverviewAction[]
        ).filter((action) => !action.permission || can(action.permission))
      default: {
        const product = productCodeByProfile[currentSiteProfile.id]
        return product
          ? [{ route: productRouteByCode[product], labelKey: productLabelKeyByCode[product] }]
          : []
      }
    }
  })

  const load = async () => {
    loading.value = true
    partialFailure.value = false
    const nextMetrics: SiteOverviewMetric[] = []
    const requests: Promise<void>[] = []
    const add = (task: Promise<void>) => requests.push(task)
    const product = productCodeByProfile[currentSiteProfile.id]

    if (currentSiteProfile.id === 'account') {
      add(
        balanceService.getMyBalance().then((balance) => {
          nextMetrics.push({
            id: 'balance',
            labelKey: 'siteOverview.metrics.balance',
            value: balance.balance,
          })
        }),
      )
      add(
        monthlyPassService.listMyUserPasses({ page: 1, pageSize: 1 }).then((page) => {
          nextMetrics.push({
            id: 'subscriptions',
            labelKey: 'siteOverview.metrics.subscriptions',
            value: page.total,
          })
        }),
      )
    }

    if (currentSiteProfile.id === 'chat') {
      add(
        chatService.getConversations(1, 1).then((page) => {
          nextMetrics.push({
            id: 'conversations',
            labelKey: 'siteOverview.metrics.conversations',
            value: page.total,
          })
        }),
      )
    }

    if (currentSiteProfile.id === 'chat' || currentSiteProfile.id === 'console-ai') {
      if (can(Permission.RELAY_TOKEN_READ)) {
        add(
          relayTokenService.getRelayTokens({ page: 1, pageSize: 1 }).then((page) => {
            nextMetrics.push({
              id: 'relay-tokens',
              labelKey: 'siteOverview.metrics.relayTokens',
              value: page.total,
            })
          }),
        )
      }
    }

    if (currentSiteProfile.id === 'console-ai' && can(Permission.RELAY_CHANNEL_SUBMIT)) {
      add(
        relayChannelService.listMySubmittedChannels({ page: 1, pageSize: 1 }).then((page) => {
          nextMetrics.push({
            id: 'submitted-channels',
            labelKey: 'siteOverview.metrics.submittedChannels',
            value: page.total,
          })
        }),
      )
    }

    if (currentSiteProfile.id === 'console-developer') {
      if (can(Permission.OAUTH_CLIENT_READ)) {
        add(
          oauthClientService.getOAuthClients().then((clients) => {
            nextMetrics.push({
              id: 'oauth-clients',
              labelKey: 'siteOverview.metrics.oauthClients',
              value: clients.length,
            })
          }),
        )
      }
      if (can(Permission.AUTH_CENTER_CLIENT_READ)) {
        add(
          authCenterClientService.getAuthCenterClients().then((clients) => {
            nextMetrics.push({
              id: 'auth-center-clients',
              labelKey: 'siteOverview.metrics.authCenterClients',
              value: clients.length,
            })
          }),
        )
      }
    }

    if (currentSiteProfile.id === 'console-ram') {
      nextMetrics.push({
        id: 'ram-permissions',
        labelKey: 'siteOverview.metrics.ramCapabilities',
        value: permissionStore.effectivePermissions.filter((permission) =>
          permission.startsWith('ram:'),
        ).length,
      })
      if (can(Permission.RAM_USER_READ)) {
        add(
          ramService.listUsers().then((users) => {
            nextMetrics.push({
              id: 'ram-users',
              labelKey: 'siteOverview.metrics.ramUsers',
              value: users.length,
            })
          }),
        )
      }
      if (can(Permission.RAM_ROLE_READ)) {
        add(
          ramService.listRoles().then((roles) => {
            nextMetrics.push({
              id: 'ram-roles',
              labelKey: 'siteOverview.metrics.ramRoles',
              value: roles.length,
            })
          }),
        )
      }
      if (can(Permission.RAM_POLICY_READ)) {
        add(
          ramService.listPolicies().then((policies) => {
            nextMetrics.push({
              id: 'ram-policies',
              labelKey: 'siteOverview.metrics.ramPolicies',
              value: policies.length,
            })
          }),
        )
      }
      if (can(Permission.RAM_SESSION_READ)) {
        add(
          ramService.listSessions().then((sessions) => {
            nextMetrics.push({
              id: 'ram-sessions',
              labelKey: 'siteOverview.metrics.ramSessions',
              value: sessions.length,
            })
          }),
        )
      }
    }

    if (product) {
      add(
        developerProductService.getUsage(product).then((usage) => {
          nextMetrics.push({
            id: 'requests',
            labelKey: 'siteOverview.metrics.requests',
            value: usage.requestCount,
          })
          nextMetrics.push({
            id: 'quota',
            labelKey: 'siteOverview.metrics.freeQuota',
            value: formatRemainingQuota(usage.remainingFree, usage.unlimited),
            descriptionKey: usage.unlimited ? 'siteOverview.unlimited' : undefined,
          })
        }),
      )
    }

    if (currentSiteProfile.id === 'product-oj') {
      add(
        OJAPIKeyService.getInstance()
          .getAPIKeyStats()
          .then((stats) => {
            nextMetrics.push({
              id: 'oj-keys',
              labelKey: 'siteOverview.metrics.ojKeys',
              value: stats.totalKeys,
            })
            nextMetrics.push({
              id: 'oj-active-keys',
              labelKey: 'siteOverview.metrics.ojActiveKeys',
              value: stats.activeKeys,
            })
          }),
      )
      add(
        OJUsageService.getInstance()
          .getUsageStats({ page: 1, pageSize: 1 })
          .then((stats) => {
            nextMetrics.push({
              id: 'oj-requests',
              labelKey: 'siteOverview.metrics.ojRequests',
              value: stats.requestCount,
            })
            nextMetrics.push({
              id: 'oj-tokens',
              labelKey: 'siteOverview.metrics.ojTokens',
              value: stats.totalTokens,
            })
          }),
      )
    }

    if (currentSiteProfile.id === 'management-core' && can(Permission.SYSTEM_STATS_READ)) {
      add(
        systemService.getSystemStats(true).then((stats) => {
          nextMetrics.push({
            id: 'users',
            labelKey: 'siteOverview.metrics.users',
            value: stats.userCount,
          })
          nextMetrics.push({
            id: 'groups',
            labelKey: 'siteOverview.metrics.groups',
            value: stats.groupCount,
          })
          nextMetrics.push({
            id: 'permissions',
            labelKey: 'siteOverview.metrics.permissions',
            value: stats.permissionCount,
          })
        }),
      )
    }

    if (currentSiteProfile.id === 'management-core' && !can(Permission.SYSTEM_STATS_READ)) {
      if (can(Permission.USER_READ)) {
        add(
          userService.getAllUsers({ page: 1, pageSize: 1 }).then((page) => {
            nextMetrics.push({
              id: 'users',
              labelKey: 'siteOverview.metrics.users',
              value: page.total,
            })
          }),
        )
      }
      if (can(Permission.GROUP_READ)) {
        add(
          groupService.getAllGroups({ page: 1, pageSize: 1 }).then((page) => {
            nextMetrics.push({
              id: 'groups',
              labelKey: 'siteOverview.metrics.groups',
              value: Array.isArray(page) ? page.length : page.total,
            })
          }),
        )
      }
      if (can(Permission.PERMISSION_VIEW)) {
        nextMetrics.push({
          id: 'permissions',
          labelKey: 'siteOverview.metrics.permissions',
          value: permissionStore.allPermissions.length,
        })
      }
    }

    if (
      currentSiteProfile.id === 'management-ai' &&
      can([Permission.RELAY_CHANNEL_READ, Permission.RELAY_CHANNEL_REVIEW])
    ) {
      add(
        relayChannelService.listManagementChannels({ page: 1, pageSize: 1 }).then((page) => {
          nextMetrics.push({
            id: 'channels',
            labelKey: 'siteOverview.metrics.channels',
            value: page.total,
          })
        }),
      )
    }

    if (currentSiteProfile.id === 'management-ai' && can(Permission.RELAY_CHANNEL_HEALTH_READ)) {
      add(
        relayChannelService.getChannelHealthOverview().then((overview) => {
          const healthy = overview.channels.filter(
            (channel) => channel.enabled && channel.availability >= 0.99,
          ).length
          nextMetrics.push({
            id: 'healthy-channels',
            labelKey: 'siteOverview.metrics.healthyChannels',
            value: healthy,
          })
        }),
      )
    }

    if (
      currentSiteProfile.id === 'management-developer' &&
      can(Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE)
    ) {
      add(
        Promise.all(
          managementProductCodes.map((code) =>
            developerProductService.listManagedAccounts(code, { page: 1, pageSize: 1 }),
          ),
        ).then((pages) => {
          nextMetrics.push({
            id: 'managed-product-accounts',
            labelKey: 'siteOverview.metrics.productAccounts',
            value: pages.reduce((total, page) => total + page.total, 0),
          })
        }),
      )
    }

    if (
      currentSiteProfile.id === 'management-developer' &&
      can(Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE)
    ) {
      add(
        developerProductService.listConfigs().then((configs) => {
          nextMetrics.push({
            id: 'enabled-products',
            labelKey: 'siteOverview.metrics.enabledProducts',
            value: configs.filter((config) => config.enabled).length,
          })
        }),
      )
    }

    if (currentSiteProfile.id === 'management-terminal') {
      if (can(Permission.REMOTE_TERMINAL_PRODUCT_READ)) {
        add(
          remoteTerminalProductService.listTemplates({ page: 1, pageSize: 1 }).then((page) => {
            nextMetrics.push({
              id: 'terminal-templates',
              labelKey: 'siteOverview.metrics.terminalTemplates',
              value: page.total,
            })
          }),
        )
      }
      if (can(Permission.REMOTE_TERMINAL_ASSIGNMENT_READ)) {
        add(
          remoteTerminalProductService.listEntitlements({ page: 1, pageSize: 1 }).then((page) => {
            nextMetrics.push({
              id: 'terminal-entitlements',
              labelKey: 'siteOverview.metrics.terminalEntitlements',
              value: page.total,
            })
          }),
        )
      }
      if (can(Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ)) {
        add(
          remoteTerminalProductService.listDevices({ page: 1, pageSize: 1 }).then((page) => {
            nextMetrics.push({
              id: 'terminal-devices',
              labelKey: 'siteOverview.metrics.terminalDevices',
              value: page.total,
            })
          }),
        )
      }
    }

    const results = await Promise.allSettled(requests)
    partialFailure.value = results.some((result) => result.status === 'rejected')
    metrics.value = nextMetrics
    loading.value = false
  }

  onMounted(() => void load())

  return { actions, loading, metrics, partialFailure, load }
}
