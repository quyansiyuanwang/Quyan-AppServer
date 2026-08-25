import {
  Bell,
  ChatDotRound,
  Collection,
  Connection,
  Cpu,
  CreditCard,
  DataAnalysis,
  Document,
  FolderOpened,
  HomeFilled,
  Histogram,
  Key,
  Link,
  Lock,
  Monitor,
  Notebook,
  Operation,
  Postcard,
  Setting,
  Tools,
  TrendCharts,
  User,
  UserFilled,
  Wallet,
} from '@element-plus/icons-vue'
import type { Component } from 'vue'
import { Permission } from '@/constant/permission'
import {
  DEVELOPER_PRODUCT_NAVIGATION,
  developerProductConfigRoute,
  developerProductManagementRoute,
  developerProductUserRoute,
} from '@/constant/developer-product-navigation'
import type { SiteProfileId } from '@/config/site-registry'
import type { RouteName } from '@/types/route-types.gen'

export interface NavigationNode {
  id: string
  labelKey: string
  icon: Component
  route?: RouteName
  permissions?: readonly Permission[]
  permissionMode?: 'all' | 'any'
  children?: readonly NavigationNode[]
  dividerBefore?: boolean
  presentation?: 'flat' | 'group'
}

const item = (
  route: RouteName,
  labelKey: string,
  icon: Component,
  permissions?: readonly Permission[],
  permissionMode: 'all' | 'any' = 'all',
): NavigationNode => ({ id: route, route, labelKey, icon, permissions, permissionMode })

const group = (
  id: string,
  labelKey: string,
  icon: Component,
  children: readonly NavigationNode[],
  dividerBefore = false,
  presentation: 'flat' | 'group' = 'group',
): NavigationNode => ({ id, labelKey, icon, children, dividerBefore, presentation })

const relayMenu = group(
  'ai-relay',
  'nav.relay',
  Connection,
  [
    item('relayTokenManagement', 'nav.myTokens', Key, [Permission.RELAY_TOKEN_READ]),
    item('apiDocumentation', 'nav.apiDocumentation', Document, [Permission.RELAY_TOKEN_READ]),
    item(
      'relayChannelProvider',
      'nav.relayChannelProvider',
      Wallet,
      [Permission.RELAY_CHANNEL_SUBMIT, Permission.RELAY_CHANNEL_PROVIDER_READ],
      'any',
    ),
    item('relayChannelReview', 'nav.relayChannelReview', Document, [
      Permission.RELAY_CHANNEL_REVIEW,
    ]),
    item('relaySettings', 'nav.relaySettings', Tools, [Permission.MODEL_PRICING_UPDATE]),
    item('relayContentSafety', 'nav.contentSafety', Tools, [Permission.RELAY_TOKEN_READ]),
    item('relayContentSafetySystem', 'nav.contentSafetySystem', Tools, [Permission.SYSTEM_CONFIG]),
    item('relayChannelHealth', 'nav.relayChannelHealth', Monitor, [
      Permission.RELAY_CHANNEL_HEALTH_READ,
    ]),
    item('relayRequestDiagnostics', 'nav.relayRequestDiagnostics', DataAnalysis, [
      Permission.RELAY_REQUEST_DIAGNOSTICS_READ,
    ]),
    item('relayChannelProbes', 'nav.relayChannelProbes', Monitor, [
      Permission.RELAY_CHANNEL_PROBE_READ,
    ]),
    item('upstreamStatus', 'nav.upstreamStatus', Connection, [Permission.UPSTREAM_STATUS_READ]),
  ],
  false,
  'flat',
)

const productUserMenu = DEVELOPER_PRODUCT_NAVIGATION.map((product) =>
  item(
    developerProductUserRoute(product.code),
    product.labelKey,
    product.icon,
    product.permissions,
    'any',
  ),
)

const productOperationsMenu = DEVELOPER_PRODUCT_NAVIGATION.map((product) =>
  group(`product-operations-${product.code}`, product.labelKey, product.icon, [
    item(developerProductManagementRoute(product.code), 'nav.productManagementPage', DataAnalysis, [
      Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE,
    ]),
    item(developerProductConfigRoute(product.code), 'nav.productConfigPage', Tools, [
      Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE,
    ]),
  ]),
)

/** Canonical navigation source consumed by the sidebar and global navigation search. */
export const navigationMenuDefinition: readonly NavigationNode[] = [
  item('home', 'nav.home', HomeFilled),
  item('settingsProfile', 'nav.settingsProfile', User),
  item('settingsSecurity', 'nav.settingsSecurity', Lock),
  item('notificationSettings', 'nav.notificationSettings', Bell),
  item('settingsPreferences', 'nav.preferences', Tools),
  item('balanceHistory', 'relay.accountBalance', Wallet, [Permission.RELAY_TOKEN_READ]),
  item('consumptionRecords', 'nav.consumptionRecords', TrendCharts, [Permission.RELAY_TOKEN_READ]),
  item(
    'myTickets',
    'nav.myTickets',
    ChatDotRound,
    [
      Permission.TICKET_SUBMIT,
      Permission.TICKET_SELF_READ,
      Permission.TICKET_SELF_UPDATE,
      Permission.TICKET_COMMENT,
    ],
    'any',
  ),
  item('myMonthlyPasses', 'nav.myMonthlyPasses', CreditCard, [Permission.RELAY_TOKEN_READ]),
  item('scriptManager', 'nav.scriptManager', Cpu, [Permission.SCRIPT_READ]),
  item(
    'terminalOverview',
    'remoteTerminal.overview',
    HomeFilled,
    [
      Permission.REMOTE_TERMINAL_PRODUCT_READ,
      Permission.REMOTE_TERMINAL_DEVICE_READ,
      Permission.REMOTE_TERMINAL_SESSION_READ,
      Permission.REMOTE_TERMINAL_SESSION_CREATE,
    ],
    'any',
  ),
  item('myRemoteTerminalProducts', 'nav.myRemoteTerminalProducts', Monitor),
  item('chat', 'nav.chat', ChatDotRound, [Permission.RELAY_TOKEN_READ]),
  item('oauthClientManagement', 'nav.oauthClientManagement', Link, [Permission.OAUTH_CLIENT_READ]),
  item('authCenterClientManagement', 'nav.authCenterClientManagement', Key, [
    Permission.AUTH_CENTER_CLIENT_READ,
  ]),
  relayMenu,
  ...productUserMenu,
  ...productOperationsMenu,
  group(
    'oj',
    'nav.ojSubmitter',
    Cpu,
    [
      item('ojAPIKeyManagement', 'nav.ojAPIKeyManagement', Key, [Permission.OJ_APIKEY_READ]),
      item('ojUsageStatistics', 'nav.ojUsageStatistics', Histogram, [Permission.OJ_USAGE_READ]),
      item('ojPricingManagement', 'nav.ojPricingManagement', TrendCharts, [
        Permission.OJ_PRICING_READ,
      ]),
    ],
    false,
    'flat',
  ),
  item('developerServiceManagement', 'nav.developerServiceManagement', Setting, [
    Permission.DEVELOPER_QUOTA_MANAGE,
  ]),
  item('developerServiceConfig', 'nav.developerServiceConfig', Tools, [Permission.SYSTEM_CONFIG]),
  item('oauthClientReviewManagement', 'nav.oauthClientReviewManagement', Document, [
    Permission.OAUTH_CLIENT_REVIEW_READ,
  ]),
  item('authCenterClientReviewManagement', 'nav.authCenterClientReviewManagement', Document, [
    Permission.AUTH_CENTER_CLIENT_REVIEW_READ,
  ]),
  item('ticketReviewManagement', 'nav.ticketReviewManagement', ChatDotRound, [
    Permission.TICKET_REVIEW_READ,
  ]),
  item(
    'remoteTerminal',
    'nav.remoteTerminal',
    Monitor,
    [
      Permission.REMOTE_TERMINAL_DEVICE_READ,
      Permission.REMOTE_TERMINAL_SESSION_READ,
      Permission.REMOTE_TERMINAL_SESSION_CREATE,
    ],
    'any',
  ),
  item('remoteTerminalProductTemplates', 'remoteTerminalProduct.templateManagement', Setting, [
    Permission.REMOTE_TERMINAL_PRODUCT_READ,
  ]),
  item('remoteTerminalProductEntitlements', 'remoteTerminalProduct.entitlementManagement', User, [
    Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
  ]),
  item('remoteTerminalProductDevices', 'remoteTerminalProduct.deviceManagement', Monitor, [
    Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ,
  ]),
  group(
    'iam',
    'nav.iam',
    UserFilled,
    [
      item(
        'iamOverview',
        'nav.iamOverview',
        HomeFilled,
        [
          Permission.USER_READ,
          Permission.GROUP_READ,
          Permission.PERMISSION_VIEW,
          Permission.RAM_ROLE_READ,
        ],
        'any',
      ),
      group('iam-identity', 'nav.iamIdentityManagement', User, [
        item('userManagement', 'nav.users', User, [Permission.USER_READ]),
        item('groupManagement', 'nav.groups', Collection, [Permission.GROUP_READ]),
      ]),
      group('iam-permissions', 'nav.iamPermissionManagement', Operation, [
        item('iamAuthorizations', 'nav.iamAuthorizations', Key, [Permission.PERMISSION_VIEW]),
        item('iamPermissionPolicies', 'nav.iamPermissionPolicies', Document, [
          Permission.PERMISSION_VIEW,
        ]),
        item('iamPermissionDiagnostics', 'nav.iamPermissionDiagnostics', DataAnalysis, [
          Permission.PERMISSION_VIEW,
        ]),
      ]),
    ],
    true,
  ),
  item(
    'ramOverview',
    'nav.ramOverview',
    HomeFilled,
    [
      Permission.RAM_USER_READ,
      Permission.RAM_ROLE_READ,
      Permission.RAM_BINDING_READ,
      Permission.RAM_POLICY_READ,
      Permission.RAM_SESSION_READ,
    ],
    'any',
  ),
  item('ramManagement', 'nav.ramUsers', User, [Permission.RAM_USER_READ]),
  item('ramRoles', 'nav.roles', Key, [Permission.RAM_ROLE_READ]),
  item('ramBindings', 'nav.ramBindings', Key, [Permission.RAM_BINDING_READ]),
  item('ramPolicies', 'nav.ramPolicies', Document, [Permission.RAM_POLICY_READ]),
  item('ramAuthorization', 'nav.ramAuthorization', DataAnalysis, [Permission.RAM_USER_READ]),
  item('ramSessions', 'nav.ramSessions', Monitor, [Permission.RAM_SESSION_READ]),
  group('billing', 'nav.financial', Wallet, [
    item('balanceManagement', 'nav.balanceManagement', CreditCard, [Permission.BALANCE_READ]),
    item(
      'monthlyPassManagement',
      'nav.monthlyPassManagement',
      CreditCard,
      [
        Permission.MONTHLY_PASS_TEMPLATE_READ,
        Permission.MONTHLY_PASS_ASSIGNMENT_READ,
        Permission.MONTHLY_PASS_USAGE_READ,
      ],
      'any',
    ),
    item('redemptionCodes', 'nav.redemptionCodes', Postcard, [Permission.REDEMPTION_CODE_READ]),
  ]),
  group('content', 'nav.dataServices', FolderOpened, [
    item('jsonEndpointManagement', 'nav.jsonEndpoints', Document, [Permission.JSON_ENDPOINT_READ]),
    item('articleManagement', 'nav.articleManagement', Notebook, [Permission.ARTICLE_READ]),
    item('legalPolicyManagement', 'nav.legalPolicyManagement', Document, [
      Permission.LEGAL_POLICY_READ,
    ]),
  ]),
  group('analytics', 'nav.analytics', DataAnalysis, [
    item('analyticsOverview', 'nav.analyticsOverview', TrendCharts, [Permission.ANALYTICS_READ]),
    item('analyticsFunnel', 'nav.analyticsFunnel', Histogram, [Permission.ANALYTICS_READ]),
    item('analyticsHeatmap', 'nav.analyticsHeatmap', DataAnalysis, [Permission.ANALYTICS_READ]),
  ]),
  group(
    'system-configuration',
    'nav.systemConfigSecurity',
    Tools,
    [
      item('serverConfig', 'nav.serverConfig', Tools, [Permission.SYSTEM_CONFIG]),
      item('supportAiConfig', 'nav.supportAiConfig', ChatDotRound, [Permission.SUPPORT_AI_CONFIG]),
      item('supportAiAnalytics', 'nav.supportAiAnalytics', DataAnalysis, [
        Permission.SUPPORT_AI_ANALYTICS_READ,
      ]),
      item('ipMonitoring', 'nav.ipMonitoring', DataAnalysis, [Permission.IP_BLACKLIST_READ]),
    ],
    true,
  ),
  group('system-monitoring', 'nav.systemMonitoring', TrendCharts, [
    item('systemStats', 'nav.systemStats', TrendCharts, [Permission.SYSTEM_STATS_READ]),
    item('systemConsumptionStats', 'nav.systemConsumptionStats', Histogram, [
      Permission.SYSTEM_CONSUMPTION_STATS_READ,
    ]),
  ]),
  group('system-audit', 'nav.systemAudit', Document, [
    item(
      'systemLogs',
      'nav.systemLogs',
      Document,
      [Permission.SYSTEM_LOG_READ, Permission.API_LOG_READ, Permission.SYSTEM_SERVER_LOG_READ],
      'any',
    ),
    item('businessLogs', 'nav.businessLogs', Notebook, [Permission.SYSTEM_BUSINESS_LOG_READ]),
    item('errorCenter', 'nav.errorCenter', Document, [Permission.SYSTEM_ERROR_REPORT_READ]),
    item('dataLifecycle', 'nav.dataLifecycle', Document, [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE]),
    item('dataMaintenance', 'nav.dataMaintenance', Document, [
      Permission.SYSTEM_DATA_MAINTENANCE_MANAGE,
    ]),
    item('userOnlineMonitor', 'nav.userOnlineMonitor', Monitor, [
      Permission.USER_ONLINE_MONITOR_READ,
    ]),
  ]),
]

export const debugNavigationNode = item('debug', 'nav.debug', Operation, [Permission.DEBUG_ACCESS])

export const overviewRouteByProfile: Partial<Record<SiteProfileId, RouteName>> = {
  public: 'publicOverview',
  identity: 'identityOverview',
  account: 'accountOverview',
  chat: 'chatOverview',
  terminal: 'terminalOverview',
  'console-ai': 'consoleAiOverview',
  'console-developer': 'consoleDeveloperOverview',
  'console-ram': 'ramOverview',
  'product-kv': 'productKvOverview',
  'product-short_link': 'productShortLinkOverview',
  'product-secret': 'productSecretOverview',
  'product-status': 'productStatusOverview',
  'product-verification': 'productVerificationOverview',
  'product-ip_geolocation': 'productIpGeolocationOverview',
  'product-push': 'productPushOverview',
  'product-oj': 'ojOverview',
  'management-core': 'iamOverview',
  'management-ai': 'managementAiOverview',
  'management-developer': 'managementDeveloperOverview',
  'management-terminal': 'managementTerminalOverview',
}

export const isNavigationNodeAllowed = (
  node: NavigationNode,
  effectivePermissions: readonly string[],
): boolean => {
  if (!node.permissions?.length) return true
  const permissions = new Set(effectivePermissions)
  return node.permissionMode === 'any'
    ? node.permissions.some((permission) => permissions.has(permission))
    : node.permissions.every((permission) => permissions.has(permission))
}

export const filterNavigationNodes = (
  nodes: readonly NavigationNode[],
  effectivePermissions: readonly string[],
  isRouteAvailable: (route: RouteName) => boolean,
): NavigationNode[] => {
  const visibleNodes: NavigationNode[] = []

  for (const node of nodes) {
    if (!isNavigationNodeAllowed(node, effectivePermissions)) continue
    const children = node.children
      ? filterNavigationNodes(node.children, effectivePermissions, isRouteAvailable)
      : undefined
    if (children?.length) {
      if (node.presentation === 'flat' || children.length === 1) {
        visibleNodes.push(
          ...children.map((child, index) => ({
            ...child,
            dividerBefore: index === 0 ? node.dividerBefore : child.dividerBefore,
          })),
        )
      } else {
        visibleNodes.push({ ...node, children })
      }
    } else if (node.route && isRouteAvailable(node.route)) {
      visibleNodes.push({ ...node, children: undefined })
    }
  }

  return visibleNodes
}

export interface NavigationRouteEntry {
  node: NavigationNode
  parentLabelKeys: readonly string[]
}

export const flattenNavigationRoutes = (
  nodes: readonly NavigationNode[],
  parentLabelKeys: readonly string[] = [],
): NavigationRouteEntry[] =>
  nodes.flatMap((node) => {
    const nextParents = node.children ? [...parentLabelKeys, node.labelKey] : parentLabelKeys
    const own = node.route ? [{ node, parentLabelKeys }] : []
    return node.children ? [...own, ...flattenNavigationRoutes(node.children, nextParents)] : own
  })

/** Returns leaf routes while preserving their source navigation path for search results. */
export const collectVisibleNavigationRoutes = (
  nodes: readonly NavigationNode[],
  effectivePermissions: readonly string[],
  isRouteAvailable: (route: RouteName) => boolean,
  parentLabelKeys: readonly string[] = [],
): NavigationRouteEntry[] =>
  nodes.flatMap((node) => {
    if (!isNavigationNodeAllowed(node, effectivePermissions)) return []
    if (node.children) {
      return collectVisibleNavigationRoutes(node.children, effectivePermissions, isRouteAvailable, [
        ...parentLabelKeys,
        node.labelKey,
      ])
    }
    return node.route && isRouteAvailable(node.route) ? [{ node, parentLabelKeys }] : []
  })
