const DOCS_BASE_URL =
  import.meta.env.VITE_APP_DOCS_BASE_URL ||
  `https://docs.${import.meta.env.VITE_PLATFORM_ROOT_DOMAIN}`

type DocsLocale = 'en' | 'zh-CN'

const docsRouteToSlug = {
  root: 'home-articles',
  indexDirect: 'home-articles',
  index: 'home-articles',
  login: 'login-register',
  register: 'login-register',
  forgotPassword: 'forgot-password',
  authVerification: 'auth-verification',
  home: 'home-articles',
  chat: 'chat',
  settings: 'account-settings',
  settingsProfile: 'account-settings',
  settingsPreferences: 'account-settings',
  settingsSecurity: 'account-settings',
  oauthClientManagement: 'oauth-app-management',
  authCenterClientManagement: 'auth-center-app-management',
  oauthClientReviewManagement: 'oauth-app-review-management',
  authCenterClientReviewManagement: 'auth-center-client-review-management',
  ticketReviewManagement: 'ticket-management',
  notificationSettings: 'notification-settings',
  userManagement: 'user-management',
  groupManagement: 'group-management',
  permission: 'permission-management',
  iamOverview: 'permission-management',
  iamAuthorizations: 'permission-management',
  iamPermissionPolicies: 'permission-management',
  iamPermissionDiagnostics: 'permission-management',
  ramManagement: 'ram-management',
  ramOverview: 'ram-management',
  ramRoles: 'ram-management',
  ramBindings: 'ram-management',
  ramPolicies: 'ram-management',
  ramAuthorization: 'ram-management',
  ramSessions: 'ram-management',
  balanceManagement: 'balance-management',
  monthlyPassManagement: 'monthly-pass-management',
  remoteTerminalProductTemplates: 'remote-terminal-management',
  remoteTerminalProductEntitlements: 'remote-terminal-management',
  remoteTerminalProductDevices: 'remote-terminal-management',
  redemptionCodes: 'redemption-code-management',
  jsonEndpointManagement: 'json-endpoint-management',
  articleManagement: 'article-management',
  legalPolicyManagement: 'legal-policy-management',
  relayTokenManagement: 'relay-token-management',
  apiDocumentation: 'api-documentation',
  relaySettings: 'relay-settings',
  relayChannelProbes: 'relay-channel-probes',
  relayChannelProvider: 'channel-provider-revenue',
  upstreamStatus: 'upstream-status',
  remoteTerminal: 'remote-terminal',
  debug: 'debug-tools',
  scriptManager: 'script-manager',
  balanceHistory: 'balance-history',
  consumptionRecords: 'consumption-records',
  myTickets: 'my-tickets',
  myMonthlyPasses: 'my-monthly-passes',
  myRemoteTerminalProducts: 'my-remote-terminal-products',
  serverConfig: 'server-configuration',
  ipMonitoring: 'ip-monitoring-dashboard',
  systemStats: 'system-statistics',
  systemConsumptionStats: 'consumption-statistics',
  systemLogs: 'system-logs',
  businessLogs: 'business-logs',
  errorCenter: 'error-center',
  dataLifecycle: 'data-lifecycle',
  userOnlineMonitor: 'user-online-monitor',
  analyticsOverview: 'analytics',
  analyticsFunnel: 'analytics',
  analyticsHeatmap: 'analytics',
  ojSubmitterRoot: 'oj-api-key-management',
  ojAPIKeyManagement: 'oj-api-key-management',
  ojUsageStatistics: 'oj-usage-statistics',
  ojPricingManagement: 'oj-pricing-management',
  'product-kv': 'developer-product-kv',
  'product-short_link': 'developer-product-short-link',
  'product-secret': 'developer-product-secret',
  'product-status': 'developer-product-status',
  'product-verification': 'developer-product-verification',
  'product-ip_geolocation': 'developer-product-ip-geolocation',
  'product-push': 'developer-product-push',
  'product-json_endpoint': 'developer-product-json-endpoint',
} as const

export const normalizeDocsLocale = (locale?: string | null): DocsLocale => {
  return locale === 'en' ? 'en' : 'zh-CN'
}

export const resolveDocsPath = (routeName?: string | null, locale?: string | null): string => {
  const docsLocale = normalizeDocsLocale(locale)
  const normalizedRouteName = typeof routeName === 'string' ? routeName : ''
  const slug =
    docsRouteToSlug[normalizedRouteName as keyof typeof docsRouteToSlug] ?? 'getting-started'
  return `/${docsLocale}/${slug}`
}

export const resolveDocsUrl = (routeName?: string | null, locale?: string | null): string => {
  return `${DOCS_BASE_URL}${resolveDocsPath(routeName, locale)}`
}
