const DOCS_BASE_URL = import.meta.env.VITE_APP_DOCS_BASE_URL || 'https://docs.appserver.dev'

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
  accesskeyManagement: 'access-key-management',
  oauthClientManagement: 'oauth-app-management',
  authCenterClientManagement: 'auth-center-app-management',
  oauthClientReviewManagement: 'oauth-app-review-management',
  authCenterClientReviewManagement: 'auth-center-client-review-management',
  ticketReviewManagement: 'ticket-management',
  notificationSettings: 'notification-settings',
  userManagement: 'user-management',
  groupManagement: 'group-management',
  permission: 'permission-management',
  ramManagement: 'ram-management',
  balanceManagement: 'balance-management',
  monthlyPassManagement: 'monthly-pass-management',
  remoteTerminalProductManagement: 'remote-terminal-management',
  redemptionCodes: 'redemption-code-management',
  jsonEndpointManagement: 'json-endpoint-management',
  articleManagement: 'article-management',
  legalPolicyManagement: 'legal-policy-management',
  relayTokenManagement: 'relay-token-management',
  apiDocumentation: 'api-documentation',
  relaySettings: 'relay-settings',
  upstreamStatus: 'upstream-status',
  remoteTerminal: 'remote-terminal',
  debug: 'debug-tools',
  scriptManager: 'script-manager',
  balanceHistory: 'balance-history',
  myTickets: 'my-tickets',
  myMonthlyPasses: 'my-monthly-passes',
  myRemoteTerminalProducts: 'my-remote-terminal-products',
  serverConfig: 'server-configuration',
  ipMonitoring: 'ip-monitoring-dashboard',
  systemStats: 'system-statistics',
  systemConsumptionStats: 'consumption-statistics',
  systemLogs: 'system-logs',
  businessLogs: 'business-logs',
  userOnlineMonitor: 'user-online-monitor',
  analyticsOverview: 'analytics',
  analyticsFunnel: 'analytics',
  analyticsHeatmap: 'analytics',
  ojSubmitterRoot: 'oj-api-key-management',
  ojAPIKeyManagement: 'oj-api-key-management',
  ojUsageStatistics: 'oj-usage-statistics',
  ojPricingManagement: 'oj-pricing-management',
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
