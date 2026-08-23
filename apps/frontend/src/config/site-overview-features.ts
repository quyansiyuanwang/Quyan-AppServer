import {
  ChatDotRound,
  Collection,
  Connection,
  Cpu,
  CreditCard,
  DataAnalysis,
  Document,
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
  Wallet,
} from '@element-plus/icons-vue'
import type { Component } from 'vue'
import { Permission } from '@/constant/permission'
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import {
  DEVELOPER_PRODUCT_NAVIGATION,
  developerProductConfigRoute,
  developerProductManagementRoute,
  developerProductUserRoute,
} from '@/constant/developer-product-navigation'
import type { SiteProfileId } from '@/config/site-registry'
import type { RouteName } from '@/types/route-types.gen'

export type SiteOverviewFeature = {
  route: RouteName
  labelKey: string
  label?: () => string
  icon: Component
  profiles: readonly SiteProfileId[]
  permissions?: readonly Permission[]
  permissionMode?: 'all' | 'any'
  metricId?: string
}

const feature = (
  route: RouteName,
  labelKey: string,
  icon: Component,
  profiles: readonly SiteProfileId[],
  metricId?: string,
  permissions?: readonly Permission[],
  permissionMode: 'all' | 'any' = 'all',
  label?: () => string,
): SiteOverviewFeature => ({
  route,
  labelKey,
  label,
  icon,
  profiles,
  metricId,
  permissions,
  permissionMode,
})

const account: readonly SiteProfileId[] = ['account']
const chat: readonly SiteProfileId[] = ['chat']
const terminal: readonly SiteProfileId[] = ['terminal']
const ai: readonly SiteProfileId[] = ['console-ai']
const developer: readonly SiteProfileId[] = ['console-developer']
const ram: readonly SiteProfileId[] = ['console-ram']
const core: readonly SiteProfileId[] = ['management-core']
const managementAi: readonly SiteProfileId[] = ['management-ai']
const managementDeveloper: readonly SiteProfileId[] = ['management-developer']
const managementTerminal: readonly SiteProfileId[] = ['management-terminal']
const oj: readonly SiteProfileId[] = ['product-oj']

export const siteOverviewFeatures: readonly SiteOverviewFeature[] = [
  feature('settingsProfile', 'nav.settingsProfile', User, account),
  feature('settingsSecurity', 'nav.settingsSecurity', Lock, account),
  feature('notificationSettings', 'nav.notificationSettings', ChatDotRound, account),
  feature('settingsPreferences', 'nav.preferences', Tools, account),
  feature('balanceHistory', 'relay.accountBalance', Wallet, account, 'balance', [
    Permission.RELAY_TOKEN_READ,
  ]),
  feature('consumptionRecords', 'nav.consumptionRecords', TrendCharts, account, undefined, [
    Permission.RELAY_TOKEN_READ,
  ]),
  feature('myTickets', 'nav.myTickets', ChatDotRound, account),
  feature('myMonthlyPasses', 'nav.myMonthlyPasses', CreditCard, account, 'subscriptions', [
    Permission.RELAY_TOKEN_READ,
  ]),
  feature('scriptManager', 'nav.scriptManager', Cpu, account),

  feature('chat', 'nav.chat', ChatDotRound, chat, 'conversations', [Permission.RELAY_TOKEN_READ]),

  feature('terminalOverview', 'remoteTerminal.overview', Monitor, terminal),
  feature('remoteTerminal', 'nav.remoteTerminal', Monitor, terminal),
  feature('myRemoteTerminalProducts', 'nav.myRemoteTerminalProducts', CreditCard, terminal),

  feature('relayTokenManagement', 'nav.myTokens', Key, ai, 'relay-tokens', [
    Permission.RELAY_TOKEN_READ,
  ]),
  feature('apiDocumentation', 'nav.apiDocumentation', Document, ai, 'relay-tokens', [
    Permission.RELAY_TOKEN_READ,
  ]),
  feature(
    'relayChannelProvider',
    'nav.relayChannelProvider',
    Wallet,
    ai,
    'submitted-channels',
    [Permission.RELAY_CHANNEL_SUBMIT, Permission.RELAY_CHANNEL_PROVIDER_READ],
    'any',
  ),
  feature('relayChannelReview', 'nav.relayChannelReview', Document, managementAi),
  feature('relaySettings', 'nav.relaySettings', Tools, managementAi),
  feature(
    'relayChannelHealth',
    'nav.relayChannelHealth',
    Monitor,
    managementAi,
    'healthy-channels',
  ),
  feature('relayRequestDiagnostics', 'nav.relayRequestDiagnostics', DataAnalysis, managementAi),
  feature('relayChannelProbes', 'nav.relayChannelProbes', Monitor, managementAi),
  feature('upstreamStatus', 'nav.upstreamStatus', Connection, managementAi),

  feature('oauthClientManagement', 'nav.oauthClientManagement', Link, developer, 'oauth-clients'),
  feature(
    'authCenterClientManagement',
    'nav.authCenterClientManagement',
    Key,
    developer,
    'auth-center-clients',
  ),

  feature('ramManagement', 'nav.ramUsers', User, ram, 'ram-users'),
  feature('ramRoles', 'nav.roles', Key, ram, 'ram-roles'),
  feature('ramBindings', 'nav.ramBindings', Connection, ram),
  feature('ramPolicies', 'nav.ramPolicies', Document, ram, 'ram-policies'),
  feature('ramAuthorization', 'nav.ramAuthorization', DataAnalysis, ram, 'ram-permissions'),
  feature('ramSessions', 'nav.ramSessions', Monitor, ram, 'ram-sessions'),

  feature('ojAPIKeyManagement', 'nav.ojAPIKeyManagement', Key, oj, 'oj-keys'),
  feature('ojUsageStatistics', 'nav.ojUsageStatistics', Histogram, oj, 'oj-requests'),
  feature('ojPricingManagement', 'nav.ojPricingManagement', TrendCharts, oj),

  feature('userManagement', 'nav.users', User, core, 'users'),
  feature('groupManagement', 'nav.groups', Collection, core, 'groups'),
  feature('iamAuthorizations', 'nav.iamAuthorizations', Key, core, 'permissions'),
  feature('iamPermissionPolicies', 'nav.iamPermissionPolicies', Document, core, 'permissions'),
  feature(
    'iamPermissionDiagnostics',
    'nav.iamPermissionDiagnostics',
    DataAnalysis,
    core,
    'permissions',
  ),
  feature('balanceManagement', 'nav.balanceManagement', CreditCard, core),
  feature('monthlyPassManagement', 'nav.monthlyPassManagement', CreditCard, core),
  feature('redemptionCodes', 'nav.redemptionCodes', Postcard, core),
  feature('jsonEndpointManagement', 'nav.jsonEndpoints', Document, core),
  feature('articleManagement', 'nav.articleManagement', Notebook, core),
  feature('legalPolicyManagement', 'nav.legalPolicyManagement', Document, core),
  feature('debug', 'nav.debug', Operation, core),
  feature('analyticsOverview', 'nav.analyticsOverview', TrendCharts, core),
  feature('analyticsFunnel', 'nav.analyticsFunnel', Histogram, core),
  feature('analyticsHeatmap', 'nav.analyticsHeatmap', DataAnalysis, core),
  feature('serverConfig', 'nav.serverConfig', Tools, core),
  feature('contentSafety' as any, 'nav.contentSafety', Tools, core),
  feature('supportAiConfig', 'nav.supportAiConfig', ChatDotRound, core, undefined, [
    Permission.SUPPORT_AI_CONFIG,
  ]),
  feature('supportAiAnalytics', 'nav.supportAiAnalytics', DataAnalysis, core, undefined, [
    Permission.SUPPORT_AI_ANALYTICS_READ,
  ]),
  feature('ipMonitoring', 'nav.ipMonitoring', DataAnalysis, core),
  feature('systemStats', 'nav.systemStats', TrendCharts, core),
  feature('systemConsumptionStats', 'nav.systemConsumptionStats', Histogram, core),
  feature('systemLogs', 'nav.systemLogs', Document, core),
  feature('businessLogs', 'nav.businessLogs', Notebook, core),
  feature('errorCenter', 'nav.errorCenter', Document, core),
  feature('dataLifecycle', 'nav.dataLifecycle', Document, core),
  feature('dataMaintenance', 'nav.dataMaintenance', Document, core),
  feature('userOnlineMonitor', 'nav.userOnlineMonitor', Monitor, core),

  feature(
    'developerServiceManagement',
    'nav.developerServiceManagement',
    Setting,
    managementDeveloper,
    'productAccounts',
  ),
  feature(
    'developerServiceConfig',
    'nav.developerServiceConfig',
    Tools,
    managementDeveloper,
    'enabled-products',
  ),
  feature(
    'oauthClientReviewManagement',
    'nav.oauthClientReviewManagement',
    Document,
    managementDeveloper,
  ),
  feature(
    'authCenterClientReviewManagement',
    'nav.authCenterClientReviewManagement',
    Document,
    managementDeveloper,
  ),
  feature(
    'ticketReviewManagement',
    'nav.ticketReviewManagement',
    ChatDotRound,
    managementDeveloper,
  ),

  feature(
    'remoteTerminalProductTemplates',
    'remoteTerminalProduct.templateManagement',
    Setting,
    managementTerminal,
    'terminal-templates',
  ),
  feature(
    'remoteTerminalProductEntitlements',
    'remoteTerminalProduct.entitlementManagement',
    User,
    managementTerminal,
    'terminal-entitlements',
  ),
  feature(
    'remoteTerminalProductDevices',
    'remoteTerminalProduct.deviceManagement',
    Monitor,
    managementTerminal,
    'terminal-devices',
  ),

  ...DEVELOPER_PRODUCT_NAVIGATION.map((product) =>
    feature(
      developerProductUserRoute(product.code),
      product.labelKey,
      product.icon,
      [`product-${product.code}`] as SiteProfileId[],
      'requests',
      product.permissions,
      'any',
    ),
  ),
  ...DEVELOPER_PRODUCT_NAVIGATION.flatMap((product) => [
    feature(
      developerProductManagementRoute(product.code),
      'nav.productManagementPage',
      DataAnalysis,
      managementDeveloper,
      `product-accounts-${product.code}`,
      [Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE],
      'all',
      () =>
        `${i18ns.t(product.labelKey as I18nENAvailableKeys)} / ${i18ns.t('nav.productManagementPage')}`,
    ),
    feature(
      developerProductConfigRoute(product.code),
      'nav.productConfigPage',
      Tools,
      managementDeveloper,
      `enabled-product-${product.code}`,
      [Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE],
      'all',
      () =>
        `${i18ns.t(product.labelKey as I18nENAvailableKeys)} / ${i18ns.t('nav.productConfigPage')}`,
    ),
  ]),
]
