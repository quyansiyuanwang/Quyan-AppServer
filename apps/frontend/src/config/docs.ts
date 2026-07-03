const DOCS_BASE_URL = import.meta.env.VITE_APP_DOCS_BASE_URL || 'https://docs.appserver.dev'

type DocsLocale = 'en' | 'zh-CN'

const docsRouteToSlug = {
  root: 'home-articles',
  indexDirect: 'home-articles',
  index: 'home-articles',
  login: 'login-register',
  forgotPassword: 'forgot-password',
  authVerification: 'auth-verification',
  home: 'home-articles',
  chat: 'chat',
  settings: 'account-settings',
  accesskeyManagement: 'access-key-management',
  oauthClientManagement: 'oauth-app-management',
  notificationSettings: 'notification-settings',
  userManagement: 'user-management',
  groupManagement: 'group-management',
  permission: 'permission-management',
  balanceManagement: 'balance-management',
  monthlyPassManagement: 'monthly-pass-management',
  redemptionCodes: 'redemption-code-management',
  jsonEndpointManagement: 'json-endpoint-management',
  articleManagement: 'article-management',
  legalPolicyManagement: 'legal-policy-management',
  relayTokenManagement: 'relay-token-management',
  apiDocumentation: 'api-documentation',
  relaySettings: 'relay-settings',
  upstreamStatus: 'upstream-status',
  debug: 'debug-tools',
  scriptManager: 'script-manager',
  balanceHistory: 'balance-history',
  myMonthlyPasses: 'my-monthly-passes',
  serverConfig: 'server-configuration',
  ipMonitoring: 'ip-monitoring-dashboard',
  systemStats: 'system-statistics',
  systemConsumptionStats: 'consumption-statistics',
  systemLogs: 'system-logs',
  businessLogs: 'business-logs',
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
