import type { SiteProfile, SiteRouteGroup } from '@/config/site-registry'

export type OverviewCategory =
  | 'account'
  | 'developer-products'
  | 'developer-applications'
  | 'product-oj'
  | 'terminal'
  | 'console-iam'
  | 'console-operations'
  | 'console-ai'
  | 'console-developer'
  | 'console-ram'
  | 'management-core'
  | 'management-ai'
  | 'management-developer'
  | 'management-terminal'

export interface RouteCatalogEntry {
  name: string
  group: SiteRouteGroup
  path: string
  overviewCategory?: OverviewCategory
  /** The single route registered by the standalone origin/master frontend. */
  legacyPath?: string
  legacyPaths?: readonly string[]
}

const legacyRoutePathByName: Record<string, string> = {
  home: '/home',
  chat: '/chat',
  settings: '/settings/profile',
  settingsProfile: '/settings/profile',
  settingsPreferences: '/settings/preferences',
  settingsContentSafety: '/settings/content-safety',
  settingsSecurity: '/settings/security',
  notificationSettings: '/settings/notifications',
  workspaceSuggestions: '/workspace/suggestions',
  balanceHistory: '/account/balance',
  consumptionRecords: '/account/consumption',
  myTickets: '/account/tickets',
  myMonthlyPasses: '/account/product-subscriptions/monthly-passes',
  monthlyPassPurchase: '/account/product-subscriptions/monthly-pass-purchase',
  scriptManager: '/tools/scripts',
  oauthClientManagement: '/account/oauth-apps',
  authCenterClientManagement: '/account/auth-center-apps',
  relayTokenManagement: '/relay/tokens',
  apiDocumentation: '/relay/api-docs',
  relayChannelProvider: '/relay/provider-channels',
  ojSubmitterRoot: '/oj-submitter/apikeys',
  ojAPIKeyManagement: '/oj-submitter/apikeys',
  ojUsageStatistics: '/oj-submitter/usage',
  ojPricingManagement: '/oj-submitter/pricing',
  terminalOverview: '/console',
  myRemoteTerminalProducts: '/products/remote-terminal-cloud',
  remoteTerminal: '/console',
  userManagement: '/management/users',
  groupManagement: '/management/groups',
  iamAuthorizations: '/management/permissions',
  iamPermissionPolicies: '/management/permissions?tab=policies',
  iamPermissionDiagnostics: '/management/permissions?tab=diagnostics',
  permission: '/management/permissions',
  ramOverview: '/iam/ram',
  ramManagement: '/iam/ram',
  ramRoles: '/iam/ram?tab=roles',
  ramBindings: '/iam/ram?tab=bindings',
  ramPolicies: '/iam/ram?tab=policies',
  ramAuthorization: '/iam/ram?tab=authorization',
  ramSessions: '/iam/ram?tab=sessions',
  balanceManagement: '/management/balance',
  monthlyPassManagement: '/management/monthly-passes',
  redemptionCodes: '/management/redemption-codes',
  jsonEndpointManagement: '/management/json-endpoints',
  articleManagement: '/management/articles',
  legalPolicyManagement: '/management/legal-policies',
  debug: '/debug',
  serverConfig: '/system/config',
  supportAiConfig: '/system/ai-support',
  supportAiAnalytics: '/system/ai-support-analytics',
  ipMonitoring: '/system/ip-monitoring',
  systemStats: '/system/stats',
  systemConsumptionStats: '/system/consumption-stats',
  systemLogs: '/system/logs',
  businessLogs: '/system/business-logs',
  errorCenter: '/system/error-center',
  dataLifecycle: '/system/data-lifecycle',
  dataMaintenance: '/system/data-maintenance',
  userOnlineMonitor: '/system/user-online-monitor',
  analyticsOverview: '/analytics/overview',
  analyticsFunnel: '/analytics/funnel',
  analyticsHeatmap: '/analytics/heatmap',
  relayChannelReview: '/relay/channel-review',
  relaySettings: '/relay/settings',
  relayContentSafety: '/relay/content-safety',
  relayChannelHealth: '/relay/channel-health',
  relayRequestDiagnostics: '/relay/request-diagnostics',
  relayChannelProbes: '/relay/channel-probes',
  upstreamStatus: '/relay/upstream-status',
  developerServiceManagement: '/developer/management',
  developerServiceConfig: '/developer/config',
  oauthClientReviewManagement: '/open-platform/oauth-app-reviews',
  authCenterClientReviewManagement: '/open-platform/auth-center-app-reviews',
  ticketReviewManagement: '/open-platform/ticket-reviews',
  remoteTerminalProductTemplates: '/products/remote-terminal',
  remoteTerminalProductEntitlements: '/products/remote-terminal',
  remoteTerminalProductDevices: '/products/remote-terminal',
}

for (const product of [
  'kv',
  'short_link',
  'secret',
  'status',
  'verification',
  'ip_geolocation',
  'push',
]) {
  legacyRoutePathByName[`product-${product}`] = `/products/${product}`
  legacyRoutePathByName[`product-management-${product}`] = `/products/${product}/management`
  legacyRoutePathByName[`product-config-${product}`] = `/products/${product}/config`
}

legacyRoutePathByName['product-short_link-analytics'] =
  '/products/short_link/analytics/:instanceId/:linkId'

const attachLegacyPaths = (entries: readonly RouteCatalogEntry[]): readonly RouteCatalogEntry[] =>
  entries.map((entry) => ({ ...entry, legacyPath: legacyRoutePathByName[entry.name] }))

const productEntries = [
  'kv',
  'short_link',
  'secret',
  'status',
  'verification',
  'ip_geolocation',
  'push',
] as const

const productUserPaths: Record<(typeof productEntries)[number], string> = {
  kv: '/entries',
  short_link: '/links',
  secret: '/secrets',
  status: '/monitors',
  verification: '/verification',
  ip_geolocation: '/lookup',
  push: '/channels',
}

export const routeCatalog = attachLegacyPaths([
  { name: 'root', group: 'shared', path: '/' },
  { name: 'publicOverview', group: 'public', path: '/overview' },
  { name: 'identityOverview', group: 'identity', path: '/overview' },
  { name: 'accountOverview', group: 'account', path: '/overview' },
  { name: 'chatOverview', group: 'chat', path: '/overview' },
  { name: 'consoleAiOverview', group: 'console-ai', path: '/overview' },
  { name: 'consoleDeveloperOverview', group: 'console-developer', path: '/overview' },
  { name: 'productKvOverview', group: 'product-kv', path: '/overview' },
  { name: 'productShortLinkOverview', group: 'product-short_link', path: '/overview' },
  { name: 'productSecretOverview', group: 'product-secret', path: '/overview' },
  { name: 'productStatusOverview', group: 'product-status', path: '/overview' },
  { name: 'productVerificationOverview', group: 'product-verification', path: '/overview' },
  { name: 'productIpGeolocationOverview', group: 'product-ip_geolocation', path: '/overview' },
  { name: 'productPushOverview', group: 'product-push', path: '/overview' },
  { name: 'ojOverview', group: 'product-oj', path: '/overview' },
  { name: 'managementAiOverview', group: 'management-ai', path: '/overview' },
  { name: 'managementDeveloperOverview', group: 'management-developer', path: '/overview' },
  { name: 'managementTerminalOverview', group: 'management-terminal', path: '/overview' },
  { name: 'home', group: 'public', path: '/home' },
  { name: 'publicStatus', group: 'public', path: '/status/:slug' },
  { name: 'login', group: 'identity', path: '/login' },
  { name: 'register', group: 'identity', path: '/register' },
  { name: 'forgotPassword', group: 'identity', path: '/forgot-password' },
  { name: 'authVerification', group: 'identity', path: '/auth/verify' },
  { name: 'oauthAuthorize', group: 'identity', path: '/oauth/authorize' },
  { name: 'externalAuthCallback', group: 'identity', path: '/auth/external/:provider/callback' },
  { name: 'qrApproval', group: 'identity', path: '/auth/qr-approve' },
  { name: 'authPasskeyManagement', group: 'identity', path: '/auth/passkeys' },
  { name: 'externalAuthBindStart', group: 'identity', path: '/auth/external/bind' },
  { name: 'captchaVerification', group: 'identity', path: '/auth/captcha' },
  { name: 'chat', group: 'chat', path: '/chat' },
  { name: 'agentMachines', group: 'chat', path: '/chat/agent-machines' },
  { name: 'settings', group: 'account', path: '/settings' },
  {
    name: 'settingsProfile',
    group: 'account',
    path: '/settings/profile',
    overviewCategory: 'account',
  },
  {
    name: 'settingsPreferences',
    group: 'account',
    path: '/settings/preferences',
    overviewCategory: 'account',
  },
  {
    name: 'settingsContentSafety',
    group: 'account',
    path: '/settings/content-safety',
    overviewCategory: 'account',
  },
  {
    name: 'settingsSecurity',
    group: 'account',
    path: '/settings/security',
    overviewCategory: 'account',
  },
  {
    name: 'notificationSettings',
    group: 'account',
    path: '/settings/notifications',
    overviewCategory: 'account',
  },
  { name: 'workspaceSuggestions', group: 'account', path: '/workspace/suggestions' },
  {
    name: 'balanceHistory',
    group: 'account',
    path: '/billing/balance',
    overviewCategory: 'account',
    legacyPaths: ['/account/balance'],
  },
  {
    name: 'consumptionRecords',
    group: 'account',
    path: '/billing/consumption',
    overviewCategory: 'account',
    legacyPaths: ['/account/consumption'],
  },
  {
    name: 'myTickets',
    group: 'account',
    path: '/support/tickets',
    overviewCategory: 'account',
    legacyPaths: ['/account/tickets'],
  },
  {
    name: 'myMonthlyPasses',
    group: 'account',
    path: '/subscriptions/monthly-passes',
    overviewCategory: 'account',
    legacyPaths: ['/account/product-subscriptions/monthly-passes'],
  },
  {
    name: 'monthlyPassPurchase',
    group: 'account',
    path: '/subscriptions/monthly-pass-purchase',
    legacyPaths: ['/account/product-subscriptions/monthly-pass-purchase'],
  },
  {
    name: 'scriptManager',
    group: 'account',
    path: '/scripts',
    overviewCategory: 'account',
    legacyPaths: ['/tools/scripts'],
  },
  {
    name: 'oauthClientManagement',
    group: 'console-developer',
    path: '/applications/oauth',
    overviewCategory: 'developer-applications',
    legacyPaths: ['/account/oauth-apps'],
  },
  {
    name: 'authCenterClientManagement',
    group: 'console-developer',
    path: '/applications/auth-center',
    overviewCategory: 'developer-applications',
    legacyPaths: ['/account/auth-center-apps'],
  },
  {
    name: 'relayTokenManagement',
    group: 'console-ai',
    path: '/relay/tokens',
    overviewCategory: 'console-ai',
  },
  {
    name: 'apiDocumentation',
    group: 'console-ai',
    path: '/relay/api-docs',
    overviewCategory: 'console-ai',
  },
  {
    name: 'relayChannelProvider',
    group: 'console-ai',
    path: '/relay/channels',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/provider-channels'],
  },
  { name: 'ojSubmitterRoot', group: 'product-oj', path: '/api-keys', legacyPaths: ['/oj'] },
  {
    name: 'ojAPIKeyManagement',
    group: 'product-oj',
    path: '/api-keys',
    overviewCategory: 'product-oj',
    legacyPaths: ['/oj/apikeys', '/oj-submitter/apikeys'],
  },
  {
    name: 'ojUsageStatistics',
    group: 'product-oj',
    path: '/usage',
    overviewCategory: 'product-oj',
    legacyPaths: ['/oj/usage', '/oj-submitter/usage'],
  },
  {
    name: 'ojPricingManagement',
    group: 'product-oj',
    path: '/pricing',
    overviewCategory: 'product-oj',
    legacyPaths: ['/oj/pricing', '/oj-submitter/pricing'],
  },
  ...productEntries.flatMap((product) => [
    {
      name: `product-${product}`,
      group: ('product-' + product) as SiteRouteGroup,
      path: productUserPaths[product],
      overviewCategory: 'developer-products' as const,
      legacyPaths: [`/products/${product}`, `/${product}`],
    },
    {
      name: `product-management-${product}`,
      group: 'management-developer' as const,
      path: `/products/${product}/management`,
      overviewCategory: 'management-developer' as const,
      legacyPaths: [`/${product}/management`, `/management/products/${product}`],
    },
    {
      name: `product-config-${product}`,
      group: 'management-developer' as const,
      path: `/products/${product}/configuration`,
      overviewCategory: 'management-developer' as const,
      legacyPaths: [`/${product}/config`, `/system/products/${product}`],
    },
  ]),
  {
    name: 'product-short_link-analytics',
    group: 'product-short_link',
    path: '/links/:instanceId/:linkId/analytics',
    overviewCategory: 'developer-products',
    legacyPaths: [
      '/products/short_link/analytics/:instanceId/:linkId',
      '/short-link/analytics/:instanceId/:linkId',
    ],
  },
  {
    name: 'terminalOverview',
    group: 'terminal',
    path: '/overview',
    overviewCategory: 'terminal',
  },
  {
    name: 'myRemoteTerminalProducts',
    group: 'terminal',
    path: '/subscriptions',
    overviewCategory: 'terminal',
    legacyPaths: [
      '/products/remote-terminal-cloud',
      '/subscriptions/remote-terminal-products',
      '/account/product-subscriptions/remote-terminal-products',
    ],
  },
  {
    name: 'remoteTerminal',
    group: 'terminal',
    path: '/workspace',
    overviewCategory: 'terminal',
    legacyPaths: ['/console', '/relay/remote-terminal'],
  },
  {
    name: 'iamOverview',
    group: 'management-core',
    path: '/overview',
    overviewCategory: 'console-iam',
    legacyPaths: ['/iam/overview'],
  },
  {
    name: 'userManagement',
    group: 'management-core',
    path: '/iam/users',
    overviewCategory: 'console-iam',
    legacyPaths: ['/management/users'],
  },
  {
    name: 'groupManagement',
    group: 'management-core',
    path: '/iam/groups',
    overviewCategory: 'console-iam',
    legacyPaths: ['/management/groups'],
  },
  {
    name: 'iamAuthorizations',
    group: 'management-core',
    path: '/iam/authorizations',
    overviewCategory: 'console-iam',
    legacyPaths: ['/iam/permissions', '/management/permissions'],
  },
  {
    name: 'iamPermissionPolicies',
    group: 'management-core',
    path: '/iam/permission-policies',
    overviewCategory: 'console-iam',
  },
  {
    name: 'iamPermissionDiagnostics',
    group: 'management-core',
    path: '/iam/permission-diagnostics',
    overviewCategory: 'console-iam',
  },
  {
    name: 'permission',
    group: 'management-core',
    path: '/iam/permissions',
    overviewCategory: 'console-iam',
  },
  {
    name: 'ramOverview',
    group: 'console-ram',
    path: '/overview',
    overviewCategory: 'console-ram',
  },
  {
    name: 'ramManagement',
    group: 'console-ram',
    path: '/users',
    overviewCategory: 'console-ram',
    legacyPaths: ['/iam/ram', '/management/ram'],
  },
  {
    name: 'ramRoles',
    group: 'console-ram',
    path: '/roles',
    overviewCategory: 'console-ram',
  },
  {
    name: 'ramBindings',
    group: 'console-ram',
    path: '/role-bindings',
    overviewCategory: 'console-ram',
  },
  {
    name: 'ramPolicies',
    group: 'console-ram',
    path: '/policies',
    overviewCategory: 'console-ram',
  },
  {
    name: 'ramAuthorization',
    group: 'console-ram',
    path: '/authorizations',
    overviewCategory: 'console-ram',
  },
  {
    name: 'ramSessions',
    group: 'console-ram',
    path: '/sessions',
    overviewCategory: 'console-ram',
  },
  {
    name: 'balanceManagement',
    group: 'management-core',
    path: '/billing/balance',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/balance'],
  },
  {
    name: 'monthlyPassManagement',
    group: 'management-core',
    path: '/billing/monthly-passes',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/monthly-passes'],
  },
  {
    name: 'redemptionCodes',
    group: 'management-core',
    path: '/billing/redemption-codes',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/redemption-codes'],
  },
  {
    name: 'jsonEndpointManagement',
    group: 'management-core',
    path: '/content/json-endpoints',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/json-endpoints'],
  },
  {
    name: 'articleManagement',
    group: 'management-core',
    path: '/content/articles',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/articles'],
  },
  {
    name: 'legalPolicyManagement',
    group: 'management-core',
    path: '/content/legal-policies',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/legal-policies'],
  },
  {
    name: 'debug',
    group: 'management-core',
    path: '/debug',
    overviewCategory: 'console-operations',
  },
  {
    name: 'serverConfig',
    group: 'management-core',
    path: '/system/config',
    overviewCategory: 'console-operations',
  },
  {
    name: 'supportAiConfig',
    group: 'management-core',
    path: '/system/ai-support',
    overviewCategory: 'console-operations',
  },
  {
    name: 'supportAiAnalytics',
    group: 'management-core',
    path: '/system/ai-support-analytics',
    overviewCategory: 'console-operations',
  },
  {
    name: 'ipMonitoring',
    group: 'management-core',
    path: '/system/ip-monitoring',
    overviewCategory: 'console-operations',
  },
  {
    name: 'systemStats',
    group: 'management-core',
    path: '/system/stats',
    overviewCategory: 'console-operations',
  },
  {
    name: 'systemConsumptionStats',
    group: 'management-core',
    path: '/system/consumption-stats',
    overviewCategory: 'console-operations',
  },
  {
    name: 'systemLogs',
    group: 'management-core',
    path: '/system/logs',
    overviewCategory: 'console-operations',
  },
  {
    name: 'businessLogs',
    group: 'management-core',
    path: '/system/business-logs',
    overviewCategory: 'console-operations',
  },
  {
    name: 'errorCenter',
    group: 'management-core',
    path: '/system/error-center',
    overviewCategory: 'console-operations',
  },
  {
    name: 'dataLifecycle',
    group: 'management-core',
    path: '/system/data-lifecycle',
    overviewCategory: 'console-operations',
  },
  {
    name: 'dataMaintenance',
    group: 'management-core',
    path: '/system/data-maintenance',
    overviewCategory: 'console-operations',
  },
  {
    name: 'userOnlineMonitor',
    group: 'management-core',
    path: '/system/user-online-monitor',
    overviewCategory: 'console-operations',
  },
  {
    name: 'analyticsOverview',
    group: 'management-core',
    path: '/analytics/overview',
    overviewCategory: 'console-operations',
  },
  {
    name: 'analyticsFunnel',
    group: 'management-core',
    path: '/analytics/funnel',
    overviewCategory: 'console-operations',
  },
  {
    name: 'analyticsHeatmap',
    group: 'management-core',
    path: '/analytics/heatmap',
    overviewCategory: 'console-operations',
  },
  {
    name: 'relayChannelReview',
    group: 'management-ai',
    path: '/channels/review',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/channel-review'],
  },
  {
    name: 'relaySettings',
    group: 'management-ai',
    path: '/relay/settings',
    overviewCategory: 'console-ai',
  },
  {
    name: 'relayContentSafety',
    group: 'management-ai',
    path: '/relay/content-safety',
    overviewCategory: 'console-ai',
  },
  {
    name: 'relayChannelHealth',
    group: 'management-ai',
    path: '/channels/health',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/channel-health'],
  },
  {
    name: 'relayRequestDiagnostics',
    group: 'management-ai',
    path: '/diagnostics/requests',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/request-diagnostics'],
  },
  {
    name: 'relayChannelProbes',
    group: 'management-ai',
    path: '/channels/probes',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/channel-probes'],
  },
  {
    name: 'upstreamStatus',
    group: 'management-ai',
    path: '/upstreams',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/upstream-status'],
  },
  {
    name: 'developerServiceManagement',
    group: 'management-developer',
    path: '/services',
    overviewCategory: 'console-developer',
    legacyPaths: ['/developer/management'],
  },
  {
    name: 'developerServiceConfig',
    group: 'management-developer',
    path: '/services/configuration',
    overviewCategory: 'console-developer',
    legacyPaths: ['/developer/config'],
  },
  {
    name: 'oauthClientReviewManagement',
    group: 'management-developer',
    path: '/reviews/oauth',
    overviewCategory: 'console-developer',
    legacyPaths: ['/open-platform/oauth-app-reviews'],
  },
  {
    name: 'authCenterClientReviewManagement',
    group: 'management-developer',
    path: '/reviews/auth-center',
    overviewCategory: 'console-developer',
    legacyPaths: ['/open-platform/auth-center-app-reviews'],
  },
  {
    name: 'ticketReviewManagement',
    group: 'management-developer',
    path: '/reviews/tickets',
    overviewCategory: 'console-developer',
    legacyPaths: ['/open-platform/ticket-reviews'],
  },
  {
    name: 'remoteTerminalProductTemplates',
    group: 'management-terminal',
    path: '/products/remote-terminal/templates',
    overviewCategory: 'management-terminal',
    legacyPaths: ['/products/remote-terminal', '/management/remote-terminal-products'],
  },
  {
    name: 'remoteTerminalProductEntitlements',
    group: 'management-terminal',
    path: '/products/remote-terminal/entitlements',
    overviewCategory: 'management-terminal',
  },
  {
    name: 'remoteTerminalProductDevices',
    group: 'management-terminal',
    path: '/products/remote-terminal/devices',
    overviewCategory: 'management-terminal',
  },
] satisfies readonly RouteCatalogEntry[])

const entriesByName = new Map(routeCatalog.map((entry) => [entry.name, entry]))

const legacyRouteMigrations: readonly RouteCatalogEntry[] = [
  {
    name: 'legacy-access-keys',
    group: 'account',
    path: '/settings/security',
    legacyPaths: ['/access-keys', '/account/access-keys'],
  },
  {
    name: 'legacy-iam-roles',
    group: 'console-ram',
    path: '/roles',
    legacyPaths: ['/iam/roles'],
  },
]

export const getRouteCatalogEntry = (routeName: string): RouteCatalogEntry | undefined =>
  entriesByName.get(routeName)

export const getRouteGroup = (routeName: string): SiteRouteGroup | undefined =>
  getRouteCatalogEntry(routeName)?.group

const fillPathParams = (template: string, params: Record<string, string>): string =>
  template.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => params[key] ?? '')

const matchPathTemplate = (
  template: string,
  pathname: string,
): Record<string, string> | undefined => {
  const keys: string[] = []
  const pattern = template
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
      keys.push(key)
      return '([^/]+)'
    })
  const match = new RegExp(`^${pattern}/?$`).exec(pathname)
  if (!match) return undefined

  return Object.fromEntries(keys.map((key, index) => [key, match[index + 1] ?? '']))
}

export const resolveRouteMigration = (
  pathname: string,
  profile: SiteProfile,
): { profileId: SiteRouteGroup; path: string } | undefined => {
  // Multiple sites may deliberately use the same canonical path (for example,
  // `/overview`). A route that is canonical on the current host must win over
  // an earlier catalog entry owned by a different site.
  const hasCanonicalPathOnCurrentProfile = routeCatalog.some(
    (entry) => entry.group === profile.id && Boolean(matchPathTemplate(entry.path, pathname)),
  )
  const hasCanonicalPathOnAnotherProfile = routeCatalog.some(
    (entry) => entry.group !== profile.id && Boolean(matchPathTemplate(entry.path, pathname)),
  )
  if (hasCanonicalPathOnCurrentProfile && hasCanonicalPathOnAnotherProfile) return undefined

  for (const entry of [...routeCatalog, ...legacyRouteMigrations]) {
    if (entry.group === 'shared') continue
    const matchingTemplate = [entry.path, ...(entry.legacyPaths ?? [])].find((template) =>
      matchPathTemplate(template, pathname),
    )
    if (!matchingTemplate) continue

    const params = matchPathTemplate(matchingTemplate, pathname)
    if (!params) continue
    return { profileId: entry.group, path: fillPathParams(entry.path, params) }
  }

  return undefined
}

/** Resolves a multi-domain capability URL to the matching origin/master route. */
export const resolveLegacyRoutePath = (
  pathname: string,
  allowedGroups?: readonly SiteRouteGroup[],
): string | undefined => {
  for (const entry of routeCatalog) {
    if (allowedGroups && !allowedGroups.includes(entry.group)) continue
    if (!entry.legacyPath) continue
    const params = matchPathTemplate(entry.path, pathname)
    if (!params) continue
    return fillPathParams(entry.legacyPath, params)
  }

  return undefined
}
