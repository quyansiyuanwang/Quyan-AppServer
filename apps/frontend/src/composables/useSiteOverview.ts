import { computed, onMounted, ref, watch } from 'vue'
import type { DeveloperProductCode } from '@/client/types.gen'
import { siteOverviewMetricProfileIds } from '@/config/site-overview'
import { siteOverviewFeatures } from '@/config/site-overview-features'
import { Permission } from '@/constant/permission'
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import router, { currentSiteProfile } from '@/router'
import { balanceService } from '@/service/balanceService'
import { balanceTransactionService } from '@/service/balanceTransactionService'
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
import { useSessionStore } from '@/stores/sessionStore'
import type { RouteName } from '@/types/route-types.gen'

export type SiteOverviewMetric = {
  id: string
  labelKey: I18nENAvailableKeys
  value: string | number
  descriptionKey?: I18nENAvailableKeys
}

export type SiteOverviewDetail = {
  id: string
  label?: string
  labelKey?: I18nENAvailableKeys
  value: string | number
  secondary?: string
}

export type SiteOverviewBreakdown = {
  id: string
  label: string
  value: number
  tone: 'primary' | 'success' | 'warning'
}

export type SiteOverviewChart = {
  id: string
  title: string
  kind: 'line' | 'bar' | 'donut'
  categories?: string[]
  series?: Array<{ label: string; values: number[] }>
  items?: Array<{ label: string; value: number }>
}

export type SiteOverviewFeaturePreview = {
  route: RouteName
  labelKey: string
  label?: string
  icon: unknown
  value: string | number
  statisticLabel: string
  secondary?: string
  hasData: boolean
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
  'product-json_endpoint': 'json_endpoint',
}

const productRouteByCode: Record<DeveloperProductCode, RouteName> = {
  kv: 'product-kv',
  short_link: 'product-short_link',
  secret: 'product-secret',
  status: 'product-status',
  verification: 'product-verification',
  ip_geolocation: 'product-ip_geolocation',
  push: 'product-push',
  json_endpoint: 'product-json_endpoint',
}

const productLabelKeyByCode: Record<DeveloperProductCode, I18nENAvailableKeys> = {
  kv: 'nav.productKv',
  short_link: 'nav.productShortLink',
  secret: 'nav.productSecret',
  status: 'nav.productStatus',
  verification: 'nav.productVerification',
  ip_geolocation: 'nav.productIpGeolocation',
  push: 'nav.productPush',
  json_endpoint: 'nav.productJsonEndpoints',
}

const managementProductCodes: readonly DeveloperProductCode[] = [
  'kv',
  'short_link',
  'secret',
  'status',
  'verification',
  'ip_geolocation',
  'push',
  'json_endpoint',
]

const resourceBreakdownProfileIds = new Set<(typeof currentSiteProfile)['id']>([
  'console-ai',
  'console-developer',
  'console-ram',
  'management-core',
  'management-ai',
  'management-developer',
  'management-terminal',
])

const oauthClientService = OAuthClientService.getInstance()
const authCenterClientService = AuthCenterClientService.getInstance()

const formatRemainingQuota = (value: number, unlimited: boolean) =>
  unlimited ? 'unlimited' : value

const dateBucket = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString().slice(0, 10)
}

const countBy = (
  items: readonly Record<string, unknown>[],
  key: (item: Record<string, unknown>) => string,
) =>
  Array.from(
    items.reduce((counts, item) => {
      const label = key(item)
      counts.set(label, (counts.get(label) || 0) + 1)
      return counts
    }, new Map<string, number>()),
  ).map(([label, value]) => ({ label, value }))

const asRecords = (items: unknown): Record<string, unknown>[] =>
  Array.isArray(items)
    ? items.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object'),
      )
    : []

export const useSiteOverview = () => {
  const permissionStore = usePermissionStore()
  const sessionStore = useSessionStore()
  const metrics = ref<SiteOverviewMetric[]>([])
  const details = ref<SiteOverviewDetail[]>([])
  const breakdown = ref<SiteOverviewBreakdown[]>([])
  const charts = ref<SiteOverviewChart[]>([])
  const loading = ref(false)
  const partialFailure = ref(false)
  let loadGeneration = 0

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

  const routePermissions = (route: RouteName) => {
    const meta = router.resolve({ name: route } as any).meta as {
      permission?: Permission
      anyPermissions?: Permission[]
    }
    return [
      ...(meta.permission ? [meta.permission] : []),
      ...(meta.anyPermissions || []),
    ] as Permission[]
  }

  const hasRoutePermission = (route: RouteName) => {
    if (!router.hasRoute(route)) return false
    const meta = router.resolve({ name: route } as any).meta as {
      permission?: Permission
      anyPermissions?: Permission[]
    }
    if (meta.permission && !permissionStore.hasPermission(meta.permission)) return false
    return !meta.anyPermissions?.length || permissionStore.hasAnyPermission(...meta.anyPermissions)
  }

  const featurePreviews = computed<SiteOverviewFeaturePreview[]>(() => {
    const profileId = currentSiteProfile.id
    if (profileId === 'rejected') return []
    const metricsById = new Map(metrics.value.map((metric) => [metric.id, metric]))

    return siteOverviewFeatures
      .filter((feature) => feature.profiles.includes(profileId))
      .filter((feature) => hasRoutePermission(feature.route))
      .filter((feature) => {
        if (!feature.permissions?.length) return true
        return feature.permissionMode === 'any'
          ? permissionStore.hasAnyPermission(...feature.permissions)
          : permissionStore.hasAllPermissions(...feature.permissions)
      })
      .map((feature) => {
        const metric = feature.metricId ? metricsById.get(feature.metricId) : undefined
        const requiredPermissions = Array.from(
          new Set([...routePermissions(feature.route), ...(feature.permissions || [])]),
        )
        const grantedPermissionCount = requiredPermissions.filter((permission) =>
          permissionStore.hasPermission(permission),
        ).length
        return {
          route: feature.route,
          labelKey: feature.labelKey,
          label: feature.label?.(),
          icon: feature.icon,
          value: metric?.value ?? (requiredPermissions.length ? grantedPermissionCount : 1),
          statisticLabel: metric
            ? i18ns.t(metric.labelKey)
            : requiredPermissions.length
              ? i18ns.t('siteOverview.features.grantedPermissions')
              : i18ns.t('siteOverview.features.available'),
          secondary: metric?.descriptionKey
            ? i18ns.t(metric.descriptionKey)
            : i18ns.t('siteOverview.features.noIndependentStatistics'),
          hasData: Boolean(metric),
        }
      })
  })

  const load = async () => {
    const generation = ++loadGeneration
    loading.value = true
    partialFailure.value = false
    breakdown.value = []
    details.value = []
    charts.value = []
    const nextMetrics: SiteOverviewMetric[] = []
    const nextDetails: SiteOverviewDetail[] = []
    const nextCharts: SiteOverviewChart[] = []
    const requests: Promise<void>[] = []
    const add = (task: Promise<void>) => requests.push(task)
    const addNamedDetails = (
      prefix: string,
      items: unknown,
      getLabel: (item: Record<string, unknown>) => string,
      getValue: (item: Record<string, unknown>) => string | number,
      getSecondary?: (item: Record<string, unknown>) => string | undefined,
    ) => {
      const records = asRecords(items)
      if (!records.length) return
      for (const [index, item] of records.slice(0, 6).entries()) {
        nextDetails.push({
          id: `${prefix}-${index}`,
          label: getLabel(item),
          value: getValue(item),
          secondary: getSecondary?.(item),
        })
      }
    }
    const product = productCodeByProfile[currentSiteProfile.id]

    const addDetailsForMetrics = () => {
      for (const metric of nextMetrics) {
        nextDetails.push({
          id: metric.id,
          labelKey: metric.labelKey,
          value: metric.value,
          secondary: metric.descriptionKey ? i18ns.t(metric.descriptionKey) : undefined,
        })
      }
    }

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
        monthlyPassService.listMyUserPasses({ page: 1, pageSize: 6 }).then((page) => {
          nextMetrics.push({
            id: 'subscriptions',
            labelKey: 'siteOverview.metrics.subscriptions',
            value: page.total,
          })
          addNamedDetails(
            'subscription',
            page.records,
            (item) => String(item.templateName || item.id || '-'),
            (item) => Number(item.remainingQuota ?? 0),
            (item) => `${String(item.quotaUnit || '')} · ${String(item.endAt || '')}`,
          )
        }),
      )
      add(
        balanceTransactionService.getMyTransactions({ limit: 30, offset: 0 }).then((result) => {
          const records = asRecords(result.data?.records)
          addNamedDetails(
            'balance-transaction',
            records,
            (item) => String(item.description || item.category || item.id || '-'),
            (item) => Number(item.amount || 0),
            (item) => String(item.createTime || ''),
          )
          const daily = new Map<string, { credit: number; debit: number }>()
          for (const record of records) {
            const date = dateBucket(record.createTime)
            if (!date) continue
            const current = daily.get(date) || { credit: 0, debit: 0 }
            const amount = Number(record.amount || 0)
            if (amount >= 0) current.credit += amount
            else current.debit += Math.abs(amount)
            daily.set(date, current)
          }
          const timeline = Array.from(daily.entries()).sort(([left], [right]) =>
            left.localeCompare(right),
          )
          if (timeline.length) {
            nextCharts.push({
              id: 'balance-activity',
              title: i18ns.t('siteOverview.charts.balanceActivity'),
              kind: 'line',
              categories: timeline.map(([date]) => date),
              series: [
                {
                  label: i18ns.t('siteOverview.charts.credits'),
                  values: timeline.map(([, values]) => values.credit),
                },
                {
                  label: i18ns.t('siteOverview.charts.debits'),
                  values: timeline.map(([, values]) => values.debit),
                },
              ],
            })
            const categories = new Map<string, number>()
            for (const record of records) {
              const category = String(record.category || record.type || '-')
              categories.set(
                category,
                (categories.get(category) || 0) + Math.abs(Number(record.amount || 0)),
              )
            }
            nextCharts.push({
              id: 'balance-category',
              title: i18ns.t('siteOverview.charts.transactionCategories'),
              kind: 'donut',
              items: Array.from(categories.entries())
                .sort(([, left], [, right]) => right - left)
                .slice(0, 8)
                .map(([label, value]) => ({ label, value })),
            })
          }
        }),
      )
    }

    if (currentSiteProfile.id === 'chat') {
      add(
        chatService.getConversations(1, 6).then((page) => {
          nextMetrics.push({
            id: 'conversations',
            labelKey: 'siteOverview.metrics.conversations',
            value: page.total,
          })
          addNamedDetails(
            'conversation',
            page.conversations,
            (item) => String(item.title || item.id || '-'),
            (item) => Number(item.messageCount ?? 0),
            (item) => String(item.lastMessageTime || item.updateTime || ''),
          )
          const conversations = asRecords(page.conversations)
          if (conversations.length) {
            nextCharts.push({
              id: 'conversation-messages',
              title: i18ns.t('siteOverview.charts.conversationMessages'),
              kind: 'bar',
              categories: conversations
                .slice(0, 10)
                .map((conversation) => String(conversation.title || conversation.id || '-')),
              series: [
                {
                  label: i18ns.t('siteOverview.charts.messages'),
                  values: conversations
                    .slice(0, 10)
                    .map((conversation) => Number(conversation.messageCount || 0)),
                },
              ],
            })
          }
        }),
      )
    }

    if (currentSiteProfile.id === 'chat' || currentSiteProfile.id === 'console-ai') {
      if (can(Permission.RELAY_TOKEN_READ)) {
        add(
          relayTokenService.getRelayTokens({ page: 1, pageSize: 6 }).then((page) => {
            nextMetrics.push({
              id: 'relay-tokens',
              labelKey: 'siteOverview.metrics.relayTokens',
              value: page.total,
            })
            addNamedDetails(
              'relay-token',
              page.items,
              (item) => String(item.name || item.ownerName || item.id || '-'),
              (item) => Number(item.requestCount ?? 0),
              (item) => `${String(item.channelName || '')} · ${String(item.lastUsedAt || '')}`,
            )
            const tokens = asRecords(page.items)
            if (tokens.length) {
              nextCharts.push({
                id: 'relay-token-requests',
                title: i18ns.t('siteOverview.charts.tokenRequests'),
                kind: 'bar',
                categories: tokens
                  .slice(0, 10)
                  .map((token) => String(token.name || token.id || '-')),
                series: [
                  {
                    label: i18ns.t('siteOverview.metrics.requests'),
                    values: tokens.slice(0, 10).map((token) => Number(token.requestCount || 0)),
                  },
                ],
              })
            }
          }),
        )
      }
    }

    if (currentSiteProfile.id === 'console-ai' && can(Permission.RELAY_CHANNEL_SUBMIT)) {
      add(
        relayChannelService.listMySubmittedChannels({ page: 1, pageSize: 6 }).then((page) => {
          nextMetrics.push({
            id: 'submitted-channels',
            labelKey: 'siteOverview.metrics.submittedChannels',
            value: page.total,
          })
          addNamedDetails(
            'submitted-channel',
            page.items,
            (item) => String(item.name || item.id || '-'),
            (item) => String(item.submissionStatus || (item.enabled ? 'enabled' : 'disabled')),
            (item) => String(item.updateTime || ''),
          )
          const channels = asRecords(page.items)
          const statuses = countBy(channels, (channel) =>
            String(channel.submissionStatus || (channel.enabled ? 'enabled' : 'disabled')),
          )
          if (statuses.length) {
            nextCharts.push({
              id: 'submitted-channel-status',
              title: i18ns.t('siteOverview.charts.channelStatus'),
              kind: 'donut',
              items: statuses,
            })
          }
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
            addNamedDetails(
              'oauth-client',
              clients,
              (item) => String(item.name || item.clientId || item.id || '-'),
              (item) => String(item.reviewStatus || item.clientType || '-'),
              (item) => String(item.lastUsedAt || item.updateTime || ''),
            )
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
            addNamedDetails(
              'auth-client',
              clients,
              (item) => String(item.name || item.clientId || item.id || '-'),
              (item) => String(item.reviewStatus || item.clientType || '-'),
              (item) => String(item.lastUsedAt || item.updateTime || ''),
            )
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
            addNamedDetails(
              'ram-user',
              users,
              (item) =>
                String(item.displayName || item.ramUsername || item.username || item.id || '-'),
              (item) => (Number(item.status) === 1 ? 'enabled' : 'disabled'),
              (item) => String(item.email || ''),
            )
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
            addNamedDetails(
              'ram-role',
              roles,
              (item) => String(item.name || item.id || '-'),
              (item) => Number(Array.isArray(item.permissions) ? item.permissions.length : 0),
              () => i18ns.t('RamManagement.permissionCount'),
            )
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
            addNamedDetails(
              'ram-policy',
              policies,
              (item) => String(item.name || item.id || '-'),
              (item) => Number(Array.isArray(item.permissions) ? item.permissions.length : 0),
              () => i18ns.t('RamManagement.permissionCount'),
            )
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
            addNamedDetails(
              'ram-session',
              sessions,
              (item) => String(item.sessionName || item.id || '-'),
              (item) => String(item.expiresAt || '-'),
              (item) => String(item.subjectUserId || ''),
            )
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
          nextDetails.push(
            {
              id: 'product-entitlement',
              labelKey: 'siteOverview.details.entitlement',
              value: usage.entitlementId || '-',
            },
            {
              id: 'product-daily-quota',
              labelKey: 'siteOverview.details.dailyQuota',
              value: usage.unlimited ? 'unlimited' : usage.dailyFreeQuota,
            },
            {
              id: 'product-overage',
              labelKey: 'siteOverview.details.overage',
              value: usage.overageEnabled ? 'enabled' : 'disabled',
            },
          )
          breakdown.value = [
            {
              id: 'used',
              label: i18ns.t('siteOverview.details.used'),
              value: usage.requestCount,
              tone: 'primary',
            },
            {
              id: 'remaining',
              label: i18ns.t('siteOverview.details.remaining'),
              value: usage.unlimited ? 0 : usage.remainingFree,
              tone: 'success',
            },
          ]
        }),
      )
      add(
        developerProductService.listInstances(product).then((instances) => {
          nextMetrics.push({
            id: 'product-instances',
            labelKey: 'siteOverview.metrics.productInstances',
            value: instances.length,
          })
          nextMetrics.push({
            id: 'product-active-instances',
            labelKey: 'siteOverview.metrics.activeInstances',
            value: instances.filter((instance) => instance.enabled).length,
          })
          addNamedDetails(
            'product-instance',
            instances,
            (item) => String(item.name || item.slug || item.id || '-'),
            (item) => (item.enabled ? 'enabled' : 'disabled'),
            (item) => String(item.updateTime || ''),
          )
        }),
      )
      add(
        developerProductService.listCallLogs(product).then((logs) => {
          addNamedDetails(
            'product-call',
            logs,
            (item) => String(item.action || item.id || '-'),
            (item) => (item.success ? 'enabled' : 'disabled'),
            (item) => String(item.createTime || ''),
          )
          const records = asRecords(logs)
          const daily = new Map<string, { success: number; failed: number }>()
          for (const record of records) {
            const date = dateBucket(record.createTime)
            if (!date) continue
            const current = daily.get(date) || { success: 0, failed: 0 }
            if (record.success) current.success += 1
            else current.failed += 1
            daily.set(date, current)
          }
          const timeline = Array.from(daily.entries()).sort(([left], [right]) =>
            left.localeCompare(right),
          )
          if (timeline.length) {
            nextMetrics.push({
              id: 'product-call-success-rate',
              labelKey: 'siteOverview.metrics.successRate',
              value: `${Math.round((records.filter((record) => record.success).length / records.length) * 100)}%`,
            })
            nextCharts.push({
              id: 'product-call-trend',
              title: i18ns.t('siteOverview.charts.recentActivity'),
              kind: 'line',
              categories: timeline.map(([date]) => date),
              series: [
                {
                  label: i18ns.t('siteOverview.charts.successfulCalls'),
                  values: timeline.map(([, values]) => values.success),
                },
                {
                  label: i18ns.t('siteOverview.charts.failedCalls'),
                  values: timeline.map(([, values]) => values.failed),
                },
              ],
            })
            nextCharts.push({
              id: 'product-call-outcome',
              title: i18ns.t('siteOverview.charts.callOutcome'),
              kind: 'donut',
              items: [
                {
                  label: i18ns.t('siteOverview.charts.successfulCalls'),
                  value: records.filter((record) => record.success).length,
                },
                {
                  label: i18ns.t('siteOverview.charts.failedCalls'),
                  value: records.filter((record) => !record.success).length,
                },
              ],
            })
          }
        }),
      )
    }

    if (currentSiteProfile.id === 'product-oj') {
      add(
        OJAPIKeyService.getInstance()
          .listAPIKeys()
          .then((keys) => {
            addNamedDetails(
              'oj-key',
              keys,
              (item) => String(item.name || item.id || '-'),
              (item) => Number(item.requestCount ?? 0),
              (item) => `${String(item.channelName || '')} · ${String(item.lastUsedAt || '')}`,
            )
          }),
      )
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
          .getUsageStats({ page: 1, pageSize: 6 })
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
            if (typeof stats.avgTokensPerRequest === 'number') {
              nextMetrics.push({
                id: 'oj-average-tokens',
                labelKey: 'siteOverview.metrics.averageTokens',
                value: Math.round(stats.avgTokensPerRequest),
              })
            }
            if (typeof stats.avgCostPerRequest === 'number') {
              nextMetrics.push({
                id: 'oj-average-cost',
                labelKey: 'siteOverview.metrics.averageCost',
                value: stats.avgCostPerRequest,
              })
            }
            addNamedDetails(
              'oj-usage',
              stats.usages,
              (item) => String(item.model || item.id || '-'),
              (item) => Number(item.requestCount ?? 0),
              (item) => String(item.createTime || ''),
            )
            const records = asRecords(stats.usages)
            const dailyTokens = new Map<string, { requests: number; tokens: number }>()
            for (const record of records) {
              const date = dateBucket(record.createTime)
              if (!date) continue
              const current = dailyTokens.get(date) || { requests: 0, tokens: 0 }
              current.requests += 1
              current.tokens += Number(record.totalTokens || 0)
              dailyTokens.set(date, current)
            }
            const timeline = Array.from(dailyTokens.entries()).sort(([left], [right]) =>
              left.localeCompare(right),
            )
            if (timeline.length) {
              nextCharts.push({
                id: 'oj-recent-usage',
                title: i18ns.t('siteOverview.charts.recentUsage'),
                kind: 'line',
                categories: timeline.map(([date]) => date),
                series: [
                  {
                    label: i18ns.t('siteOverview.metrics.ojRequests'),
                    values: timeline.map(([, values]) => values.requests),
                  },
                  {
                    label: i18ns.t('siteOverview.metrics.ojTokens'),
                    values: timeline.map(([, values]) => values.tokens),
                  },
                ],
              })
              const tokensByModel = records.reduce((totals, record) => {
                const model = String(record.model || '-')
                totals.set(model, (totals.get(model) || 0) + Number(record.totalTokens || 0))
                return totals
              }, new Map<string, number>())
              nextCharts.push({
                id: 'oj-model-tokens',
                title: i18ns.t('siteOverview.charts.modelTokens'),
                kind: 'donut',
                items: Array.from(tokensByModel.entries())
                  .sort(([, left], [, right]) => right - left)
                  .slice(0, 8)
                  .map(([label, value]) => ({ label, value })),
              })
            }
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
        relayChannelService.listManagementChannels({ page: 1, pageSize: 6 }).then((page) => {
          nextMetrics.push({
            id: 'channels',
            labelKey: 'siteOverview.metrics.channels',
            value: page.total,
          })
          addNamedDetails(
            'management-channel',
            page.items,
            (item) => String(item.name || item.id || '-'),
            (item) => (item.enabled ? 'enabled' : 'disabled'),
            (item) => `${String(item.submissionStatus || '')} · ${String(item.updateTime || '')}`,
          )
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
          const channels = overview.channels.filter((channel) => channel.enabled)
          if (channels.length) {
            nextMetrics.push({
              id: 'degraded-channels',
              labelKey: 'siteOverview.metrics.degradedChannels',
              value: channels.filter((channel) => channel.availability < 0.99).length,
            })
            nextMetrics.push({
              id: 'average-latency',
              labelKey: 'siteOverview.metrics.averageLatency',
              value: Math.round(
                channels.reduce(
                  (total, channel) => total + Number(channel.averageLatencyMs || 0),
                  0,
                ) / channels.length,
              ),
            })
          }
          if (channels.length) {
            nextCharts.push({
              id: 'channel-availability',
              title: i18ns.t('siteOverview.charts.channelAvailability'),
              kind: 'bar',
              categories: channels.slice(0, 10).map((channel) => channel.name),
              series: [
                {
                  label: i18ns.t('siteOverview.charts.availabilityPercent'),
                  values: channels
                    .slice(0, 10)
                    .map((channel) => Math.round(channel.availability * 100)),
                },
              ],
            })
            const statusCounts = [
              {
                label: '2xx',
                value: channels.reduce(
                  (total, channel) => total + Number(channel.status2xxCount || 0),
                  0,
                ),
              },
              {
                label: '3xx',
                value: channels.reduce(
                  (total, channel) => total + Number(channel.status3xxCount || 0),
                  0,
                ),
              },
              {
                label: '4xx',
                value: channels.reduce(
                  (total, channel) => total + Number(channel.status4xxCount || 0),
                  0,
                ),
              },
              {
                label: '5xx',
                value: channels.reduce(
                  (total, channel) => total + Number(channel.status5xxCount || 0),
                  0,
                ),
              },
              {
                label: 'other',
                value: channels.reduce(
                  (total, channel) => total + Number(channel.statusOtherCount || 0),
                  0,
                ),
              },
            ].filter((item) => item.value > 0)
            if (statusCounts.length) {
              nextCharts.push({
                id: 'channel-http-status',
                title: i18ns.t('siteOverview.charts.httpStatus'),
                kind: 'donut',
                items: statusCounts,
              })
            }
          }
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
            developerProductService.listManagedAccounts(code, { page: 1, pageSize: 6 }),
          ),
        ).then((pages) => {
          nextMetrics.push({
            id: 'managed-product-accounts',
            labelKey: 'siteOverview.metrics.productAccounts',
            value: pages.reduce((total, page) => total + page.total, 0),
          })
          for (const [index, page] of pages.entries()) {
            nextMetrics.push({
              id: `product-accounts-${managementProductCodes[index]}`,
              labelKey: 'siteOverview.metrics.productAccounts',
              value: page.total,
            })
            addNamedDetails(
              `managed-product-${index}`,
              page.records,
              (item) => String(item.displayName || item.username || item.userId || '-'),
              (item) => String(item.productCode || '-'),
              (item) => {
                const account =
                  item.account && typeof item.account === 'object'
                    ? (item.account as Record<string, unknown>)
                    : undefined
                return String(account?.dailyFreeQuota ?? '')
              },
            )
          }
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
          for (const code of managementProductCodes) {
            const config = configs.find((item) => item.productCode === code)
            nextMetrics.push({
              id: `enabled-product-${code}`,
              labelKey: 'siteOverview.metrics.enabledProducts',
              value: config?.enabled ? 1 : 0,
            })
          }
          addNamedDetails(
            'developer-product',
            configs,
            (item) => String(item.productCode || item.code || item.id || '-'),
            (item) => (item.enabled ? 'enabled' : 'disabled'),
            (item) => String(item.updateTime || ''),
          )
        }),
      )
    }

    if (currentSiteProfile.id === 'management-terminal') {
      if (can(Permission.REMOTE_TERMINAL_PRODUCT_READ)) {
        add(
          remoteTerminalProductService.listTemplates({ page: 1, pageSize: 6 }).then((page) => {
            nextMetrics.push({
              id: 'terminal-templates',
              labelKey: 'siteOverview.metrics.terminalTemplates',
              value: page.total,
            })
            addNamedDetails(
              'terminal-template',
              page.records,
              (item) => String(item.name || item.id || '-'),
              (item) => String(item.publishStatus || '-'),
              (item) => String(item.billingUnit || ''),
            )
          }),
        )
      }
      if (can(Permission.REMOTE_TERMINAL_ASSIGNMENT_READ)) {
        add(
          remoteTerminalProductService.listEntitlements({ page: 1, pageSize: 6 }).then((page) => {
            nextMetrics.push({
              id: 'terminal-entitlements',
              labelKey: 'siteOverview.metrics.terminalEntitlements',
              value: page.total,
            })
            addNamedDetails(
              'terminal-entitlement',
              page.records,
              (item) => String(item.name || item.templateName || item.id || '-'),
              (item) => String(item.status ?? '-'),
              (item) => String(item.endAt || ''),
            )
          }),
        )
      }
      if (can(Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ)) {
        add(
          remoteTerminalProductService.listDevices({ page: 1, pageSize: 6 }).then((page) => {
            nextMetrics.push({
              id: 'terminal-devices',
              labelKey: 'siteOverview.metrics.terminalDevices',
              value: page.total,
            })
            addNamedDetails(
              'terminal-device',
              page.records,
              (item) => String(item.hostname || item.deviceId || '-'),
              (item) => (item.online ? 'enabled' : 'disabled'),
              (item) => `${String(item.platform || '')} · ${String(item.lastSeenAt || '')}`,
            )
          }),
        )
      }
    }

    const results = await Promise.allSettled(requests)
    if (generation !== loadGeneration) return
    partialFailure.value = results.some((result) => result.status === 'rejected')
    addDetailsForMetrics()
    if (!breakdown.value.length && resourceBreakdownProfileIds.has(currentSiteProfile.id)) {
      breakdown.value = nextMetrics
        .filter(
          (metric): metric is SiteOverviewMetric & { value: number } =>
            typeof metric.value === 'number',
        )
        .map((metric) => ({
          id: metric.id,
          label: i18ns.t(metric.labelKey),
          value: metric.value,
          tone: 'primary' as const,
        }))
    }
    if (!nextCharts.length && breakdown.value.length) {
      nextCharts.push({
        id: 'overview-resource-counts',
        title: i18ns.t('siteOverview.charts.resourceCounts'),
        kind: 'bar',
        categories: breakdown.value.map((item) => item.label),
        series: [
          {
            label: i18ns.t('siteOverview.charts.currentValue'),
            values: breakdown.value.map((item) => item.value),
          },
        ],
      })
    }
    metrics.value = nextMetrics
    details.value = nextDetails
    charts.value = nextCharts
    loading.value = false
  }

  onMounted(() => void load())
  watch(
    () => [sessionStore.identityKey, sessionStore.permissionsStatus] as const,
    ([identityKey, permissionsStatus], previous) => {
      const [previousIdentityKey, previousPermissionsStatus] = previous || []
      if (
        identityKey !== previousIdentityKey ||
        (permissionsStatus === 'ready' && previousPermissionsStatus !== 'ready')
      ) {
        void load()
      }
    },
  )

  return {
    actions,
    breakdown,
    charts,
    details,
    featurePreviews,
    loading,
    metrics,
    partialFailure,
    load,
  }
}
