import type { SiteProfile, SiteProfileId, SiteRouteGroup } from '@/config/site-registry'

export type OverviewCategory =
  | 'account'
  | 'developer-products'
  | 'developer-applications'
  | 'terminal'
  | 'console-iam'
  | 'console-operations'
  | 'console-ai'
  | 'console-developer'
  | 'console-terminal'

export interface RouteCatalogEntry {
  name: string
  group: SiteRouteGroup
  path: string
  overviewCategory?: OverviewCategory
  legacyPaths?: readonly string[]
}

export const siteProfileDefaultPaths: Readonly<Record<SiteProfileId, string>> = {
  public: '/home',
  identity: '/login',
  account: '/settings/profile',
  chat: '/chat',
  developer: '/products',
  terminal: '/products/remote-terminal-cloud',
  'console-core': '/iam/users',
  'console-ai': '/relay/settings',
  'console-developer': '/services',
  'console-terminal': '/products/remote-terminal',
}

const productEntries = [
  'kv',
  'short_link',
  'secret',
  'status',
  'verification',
  'ip_geolocation',
  'push',
] as const

export const routeCatalog: readonly RouteCatalogEntry[] = [
  { name: 'root', group: 'shared', path: '/' },
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
  {
    name: 'accesskeyManagement',
    group: 'account',
    path: '/access-keys',
    overviewCategory: 'account',
    legacyPaths: ['/account/access-keys'],
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
    name: 'developerProjects',
    group: 'developer',
    path: '/projects',
    legacyPaths: ['/developer/projects', '/account/developer-projects'],
  },
  {
    name: 'developerProducts',
    group: 'developer',
    path: '/products',
    overviewCategory: 'developer-products',
  },
  {
    name: 'oauthClientManagement',
    group: 'developer',
    path: '/applications/oauth',
    overviewCategory: 'developer-applications',
    legacyPaths: ['/account/oauth-apps'],
  },
  {
    name: 'authCenterClientManagement',
    group: 'developer',
    path: '/applications/auth-center',
    overviewCategory: 'developer-applications',
    legacyPaths: ['/account/auth-center-apps'],
  },
  {
    name: 'relayTokenManagement',
    group: 'developer',
    path: '/relay/tokens',
    overviewCategory: 'developer-applications',
  },
  {
    name: 'apiDocumentation',
    group: 'developer',
    path: '/relay/api-docs',
    overviewCategory: 'developer-applications',
  },
  {
    name: 'relayChannelProvider',
    group: 'developer',
    path: '/relay/channels',
    overviewCategory: 'developer-applications',
    legacyPaths: ['/relay/provider-channels'],
  },
  { name: 'ojSubmitterRoot', group: 'developer', path: '/oj' },
  {
    name: 'ojAPIKeyManagement',
    group: 'developer',
    path: '/oj/apikeys',
    overviewCategory: 'developer-applications',
    legacyPaths: ['/oj-submitter/apikeys'],
  },
  {
    name: 'ojUsageStatistics',
    group: 'developer',
    path: '/oj/usage',
    overviewCategory: 'developer-applications',
    legacyPaths: ['/oj-submitter/usage'],
  },
  {
    name: 'ojPricingManagement',
    group: 'developer',
    path: '/oj/pricing',
    overviewCategory: 'developer-applications',
    legacyPaths: ['/oj-submitter/pricing'],
  },
  ...productEntries.flatMap((product) => [
    {
      name: `product-${product}`,
      group: 'developer' as const,
      path: `/products/${product}`,
      overviewCategory: 'developer-products' as const,
      legacyPaths: [`/${product}`],
    },
    {
      name: `product-management-${product}`,
      group: 'console-developer' as const,
      path: `/products/${product}/management`,
      overviewCategory: 'console-developer' as const,
      legacyPaths: [`/${product}/management`, `/management/products/${product}`],
    },
    {
      name: `product-config-${product}`,
      group: 'console-developer' as const,
      path: `/products/${product}/configuration`,
      overviewCategory: 'console-developer' as const,
      legacyPaths: [`/${product}/config`, `/system/products/${product}`],
    },
  ]),
  {
    name: 'product-short_link-analytics',
    group: 'console-developer',
    path: '/products/short_link/analytics/:instanceId/:linkId',
    overviewCategory: 'console-developer',
    legacyPaths: ['/short-link/analytics/:instanceId/:linkId'],
  },
  {
    name: 'myRemoteTerminalProducts',
    group: 'terminal',
    path: '/products/remote-terminal-cloud',
    overviewCategory: 'terminal',
    legacyPaths: ['/account/product-subscriptions/remote-terminal-products'],
  },
  {
    name: 'remoteTerminal',
    group: 'terminal',
    path: '/console',
    overviewCategory: 'terminal',
    legacyPaths: ['/relay/remote-terminal'],
  },
  {
    name: 'userManagement',
    group: 'console-core',
    path: '/iam/users',
    overviewCategory: 'console-iam',
    legacyPaths: ['/management/users'],
  },
  {
    name: 'groupManagement',
    group: 'console-core',
    path: '/iam/groups',
    overviewCategory: 'console-iam',
    legacyPaths: ['/management/groups'],
  },
  {
    name: 'permission',
    group: 'console-core',
    path: '/iam/permissions',
    overviewCategory: 'console-iam',
    legacyPaths: ['/management/permissions'],
  },
  {
    name: 'ramManagement',
    group: 'console-core',
    path: '/iam/ram',
    overviewCategory: 'console-iam',
    legacyPaths: ['/management/ram'],
  },
  {
    name: 'balanceManagement',
    group: 'console-core',
    path: '/billing/balance',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/balance'],
  },
  {
    name: 'monthlyPassManagement',
    group: 'console-core',
    path: '/billing/monthly-passes',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/monthly-passes'],
  },
  {
    name: 'redemptionCodes',
    group: 'console-core',
    path: '/billing/redemption-codes',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/redemption-codes'],
  },
  {
    name: 'jsonEndpointManagement',
    group: 'console-core',
    path: '/content/json-endpoints',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/json-endpoints'],
  },
  {
    name: 'articleManagement',
    group: 'console-core',
    path: '/content/articles',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/articles'],
  },
  {
    name: 'legalPolicyManagement',
    group: 'console-core',
    path: '/content/legal-policies',
    overviewCategory: 'console-operations',
    legacyPaths: ['/management/legal-policies'],
  },
  { name: 'debug', group: 'console-core', path: '/debug', overviewCategory: 'console-operations' },
  {
    name: 'serverConfig',
    group: 'console-core',
    path: '/system/config',
    overviewCategory: 'console-operations',
  },
  {
    name: 'ipMonitoring',
    group: 'console-core',
    path: '/system/ip-monitoring',
    overviewCategory: 'console-operations',
  },
  {
    name: 'systemStats',
    group: 'console-core',
    path: '/system/stats',
    overviewCategory: 'console-operations',
  },
  {
    name: 'systemConsumptionStats',
    group: 'console-core',
    path: '/system/consumption-stats',
    overviewCategory: 'console-operations',
  },
  {
    name: 'systemLogs',
    group: 'console-core',
    path: '/system/logs',
    overviewCategory: 'console-operations',
  },
  {
    name: 'businessLogs',
    group: 'console-core',
    path: '/system/business-logs',
    overviewCategory: 'console-operations',
  },
  {
    name: 'errorCenter',
    group: 'console-core',
    path: '/system/error-center',
    overviewCategory: 'console-operations',
  },
  {
    name: 'dataLifecycle',
    group: 'console-core',
    path: '/system/data-lifecycle',
    overviewCategory: 'console-operations',
  },
  {
    name: 'dataMaintenance',
    group: 'console-core',
    path: '/system/data-maintenance',
    overviewCategory: 'console-operations',
  },
  {
    name: 'userOnlineMonitor',
    group: 'console-core',
    path: '/system/user-online-monitor',
    overviewCategory: 'console-operations',
  },
  {
    name: 'analyticsOverview',
    group: 'console-core',
    path: '/analytics/overview',
    overviewCategory: 'console-operations',
  },
  {
    name: 'analyticsFunnel',
    group: 'console-core',
    path: '/analytics/funnel',
    overviewCategory: 'console-operations',
  },
  {
    name: 'analyticsHeatmap',
    group: 'console-core',
    path: '/analytics/heatmap',
    overviewCategory: 'console-operations',
  },
  {
    name: 'relayChannelReview',
    group: 'console-ai',
    path: '/channels/review',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/channel-review'],
  },
  {
    name: 'relaySettings',
    group: 'console-ai',
    path: '/relay/settings',
    overviewCategory: 'console-ai',
  },
  {
    name: 'relayChannelHealth',
    group: 'console-ai',
    path: '/channels/health',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/channel-health'],
  },
  {
    name: 'relayRequestDiagnostics',
    group: 'console-ai',
    path: '/diagnostics/requests',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/request-diagnostics'],
  },
  {
    name: 'relayChannelProbes',
    group: 'console-ai',
    path: '/channels/probes',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/channel-probes'],
  },
  {
    name: 'upstreamStatus',
    group: 'console-ai',
    path: '/upstreams',
    overviewCategory: 'console-ai',
    legacyPaths: ['/relay/upstream-status'],
  },
  {
    name: 'developerServiceManagement',
    group: 'console-developer',
    path: '/services',
    overviewCategory: 'console-developer',
    legacyPaths: ['/developer/management'],
  },
  {
    name: 'developerServiceConfig',
    group: 'console-developer',
    path: '/services/configuration',
    overviewCategory: 'console-developer',
    legacyPaths: ['/developer/config'],
  },
  {
    name: 'oauthClientReviewManagement',
    group: 'console-developer',
    path: '/reviews/oauth',
    overviewCategory: 'console-developer',
    legacyPaths: ['/open-platform/oauth-app-reviews'],
  },
  {
    name: 'authCenterClientReviewManagement',
    group: 'console-developer',
    path: '/reviews/auth-center',
    overviewCategory: 'console-developer',
    legacyPaths: ['/open-platform/auth-center-app-reviews'],
  },
  {
    name: 'ticketReviewManagement',
    group: 'console-developer',
    path: '/reviews/tickets',
    overviewCategory: 'console-developer',
    legacyPaths: ['/open-platform/ticket-reviews'],
  },
  {
    name: 'remoteTerminalProductManagement',
    group: 'console-terminal',
    path: '/products/remote-terminal',
    overviewCategory: 'console-terminal',
    legacyPaths: ['/management/remote-terminal-products'],
  },
]

const entriesByName = new Map(routeCatalog.map((entry) => [entry.name, entry]))

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
  for (const entry of routeCatalog) {
    if (entry.group === 'shared') continue
    const matchingTemplate = [entry.path, ...(entry.legacyPaths ?? [])].find((template) =>
      matchPathTemplate(template, pathname),
    )
    if (!matchingTemplate) continue

    const params = matchPathTemplate(matchingTemplate, pathname)
    if (!params) continue
    const isCanonicalOnCurrentProfile =
      entry.group === profile.id && matchingTemplate === entry.path
    if (isCanonicalOnCurrentProfile) return undefined

    return { profileId: entry.group, path: fillPathParams(entry.path, params) }
  }

  return undefined
}
