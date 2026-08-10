import { Permission } from '@/constant/permission'
import { siteProfiles, type SiteProfile, type SiteRouteGroup } from '@/config/site-registry'
import type { RouteRecordRaw } from 'vue-router'

const routeGroupsByName: Readonly<Record<string, SiteRouteGroup>> = {
  root: 'shared',
  home: 'public',
  publicStatus: 'public',
  login: 'identity',
  register: 'identity',
  forgotPassword: 'identity',
  authVerification: 'identity',
  oauthAuthorize: 'identity',
  externalAuthCallback: 'identity',
  qrApproval: 'identity',
  authPasskeyManagement: 'identity',
  externalAuthBindStart: 'identity',
  captchaVerification: 'identity',
  chat: 'chat',
  settings: 'account',
  settingsProfile: 'account',
  settingsPreferences: 'account',
  settingsSecurity: 'account',
  notificationSettings: 'account',
  accesskeyManagement: 'account',
  workspaceSuggestions: 'account',
  balanceHistory: 'account',
  consumptionRecords: 'account',
  myTickets: 'account',
  myMonthlyPasses: 'account',
  monthlyPassPurchase: 'account',
  scriptManager: 'account',
  developerProjects: 'developer',
  developerProducts: 'developer',
  oauthClientManagement: 'developer',
  authCenterClientManagement: 'developer',
  relayTokenManagement: 'developer',
  apiDocumentation: 'developer',
  relayChannelProvider: 'developer',
  ojSubmitterRoot: 'developer',
  ojAPIKeyManagement: 'developer',
  ojUsageStatistics: 'developer',
  ojPricingManagement: 'developer',
  'product-kv': 'developer',
  'product-short_link': 'developer',
  'product-secret': 'developer',
  'product-status': 'developer',
  'product-verification': 'developer',
  'product-ip_geolocation': 'developer',
  'product-push': 'developer',
  myRemoteTerminalProducts: 'terminal',
  remoteTerminalProductsLanding: 'terminal',
  remoteTerminal: 'terminal',
  userManagement: 'console-core',
  groupManagement: 'console-core',
  permission: 'console-core',
  ramManagement: 'console-core',
  balanceManagement: 'console-core',
  monthlyPassManagement: 'console-core',
  redemptionCodes: 'console-core',
  jsonEndpointManagement: 'console-core',
  articleManagement: 'console-core',
  legalPolicyManagement: 'console-core',
  debug: 'console-core',
  serverConfig: 'console-core',
  ipMonitoring: 'console-core',
  systemStats: 'console-core',
  systemConsumptionStats: 'console-core',
  systemLogs: 'console-core',
  businessLogs: 'console-core',
  errorCenter: 'console-core',
  dataLifecycle: 'console-core',
  dataMaintenance: 'console-core',
  userOnlineMonitor: 'console-core',
  analyticsOverview: 'console-core',
  analyticsFunnel: 'console-core',
  analyticsHeatmap: 'console-core',
  relayChannelReview: 'console-ai',
  relaySettings: 'console-ai',
  relayChannelHealth: 'console-ai',
  relayRequestDiagnostics: 'console-ai',
  relayChannelProbes: 'console-ai',
  upstreamStatus: 'console-ai',
  developerServiceManagement: 'console-developer',
  developerServiceConfig: 'console-developer',
  oauthClientReviewManagement: 'console-developer',
  authCenterClientReviewManagement: 'console-developer',
  ticketReviewManagement: 'console-developer',
  'product-management-kv': 'console-developer',
  'product-config-kv': 'console-developer',
  'product-management-short_link': 'console-developer',
  'product-config-short_link': 'console-developer',
  'product-short_link-analytics': 'console-developer',
  'product-management-secret': 'console-developer',
  'product-config-secret': 'console-developer',
  'product-management-status': 'console-developer',
  'product-config-status': 'console-developer',
  'product-management-verification': 'console-developer',
  'product-config-verification': 'console-developer',
  'product-management-ip_geolocation': 'console-developer',
  'product-config-ip_geolocation': 'console-developer',
  'product-management-push': 'console-developer',
  'product-config-push': 'console-developer',
  remoteTerminalProductManagement: 'console-terminal',
}

export const routes = [
  {
    path: '',
    component: () => import('@/IndexApp.vue'),
    children: [
      {
        path: '',
        name: 'root',
        redirect: () => ({ name: 'home' }),
      },
      {
        path: '/login',
        name: 'login',
        component: () => import('@/views/auth/LoginOrRegisterView.vue'),
        meta: {
          isAuthEntry: true,
          requiresCaptchaPreflight: true,
        },
      },
      {
        path: '/register',
        name: 'register',
        component: () => import('@/views/auth/LoginOrRegisterView.vue'),
        meta: {
          isAuthEntry: true,
          requiresCaptchaPreflight: true,
          captchaAction: 'register',
        },
      },
      {
        path: '/forgot-password',
        name: 'forgotPassword',
        component: () => import('@/views/auth/ForgotPasswordView.vue'),
        meta: {
          isAuthEntry: true,
          requiresCaptchaPreflight: true,
          captchaAction: 'reset_password',
        },
      },
      {
        path: '/auth/verify',
        name: 'authVerification',
        meta: {
          isAuthEntry: true,
        },
        component: () => import('@/views/auth/AuthVerificationView.vue'),
      },
      {
        path: '/oauth/authorize',
        name: 'oauthAuthorize',
        meta: {
          isAuthEntry: true,
        },
        component: () => import('@/views/auth/OAuthAuthorizeView.vue'),
      },
      {
        path: '/auth/external/:provider/callback',
        name: 'externalAuthCallback',
        meta: {
          isAuthEntry: true,
        },
        component: () => import('@/views/auth/ExternalAuthCallbackView.vue'),
      },
      {
        path: '/auth/qr-approve',
        name: 'qrApproval',
        meta: {
          isAuthEntry: true,
          requiresCaptchaPreflight: true,
        },
        component: () => import('@/views/auth/QrApprovalView.vue'),
      },
      {
        path: '/auth/passkeys',
        name: 'authPasskeyManagement',
        component: () => import('@/views/settings/PasskeyManagementView.vue'),
      },
      {
        path: '/auth/external/bind',
        name: 'externalAuthBindStart',
        meta: {
          isAuthEntry: true,
        },
        component: () => import('@/views/auth/ExternalAuthBindStartView.vue'),
      },
      {
        path: '/auth/captcha',
        name: 'captchaVerification',
        meta: {
          isAuthEntry: true,
        },
        component: () => import('@/views/auth/CaptchaVerificationView.vue'),
      },
      {
        path: '/status/:slug',
        name: 'publicStatus',
        component: () => import('@/views/public/PublicStatusView.vue'),
        meta: {
          isAuthEntry: true,
          allowGuest: true,
          publicStatus: true,
        },
      },
      {
        path: '/workspace/suggestions',
        name: 'workspaceSuggestions',
        component: () => import('@/views/workspace/WorkspaceTicketView.vue'),
        meta: {
          allowGuestWhenEmbedded: true,
        },
      },
      {
        path: '/',
        name: 'indexDirect',
        component: () => import('@/layouts/overLay.vue'),
        children: [
          {
            path: '',
            name: 'index',
            redirect: { name: 'home' },
          },

          // --- Top-level ---
          {
            path: 'home',
            name: 'home',
            component: () => import('@/views/article/ArticleViewerView.vue'),
            meta: {
              allowGuest: true,
            },
          },
          {
            path: 'chat',
            name: 'chat',
            component: () => import('@/views/chat/ChatView.vue'),
          },
          {
            path: 'settings',
            children: [
              {
                path: '',
                name: 'settings',
                redirect: { name: 'settingsProfile' },
              },
              {
                path: 'profile',
                name: 'settingsProfile',
                component: () => import('@/views/settings/ProfileSettingsView.vue'),
              },
              {
                path: 'preferences',
                name: 'settingsPreferences',
                component: () => import('@/views/settings/PreferencesSettingsView.vue'),
              },
              {
                path: 'security',
                name: 'settingsSecurity',
                component: () => import('@/views/settings/AccountSecuritySettingsView.vue'),
              },
              {
                path: 'notifications',
                name: 'notificationSettings',
                component: () => import('@/views/settings/NotificationSettingsView.vue'),
              },
            ],
          },
          {
            path: 'account/access-keys',
            name: 'accesskeyManagement',
            component: () => import('@/views/settings/AccessKeyManagementView.vue'),
          },
          {
            path: 'account/developer-projects',
            redirect: { name: 'developerProducts' },
          },
          {
            path: 'developer/projects',
            name: 'developerProjects',
            redirect: { name: 'developerProducts' },
          },
          {
            path: 'products',
            name: 'developerProducts',
            component: () => import('@/views/products/DeveloperProductCatalogView.vue'),
          },
          {
            path: 'products/remote-terminal-cloud',
            name: 'remoteTerminalProductsLanding',
            component: () =>
              import('@/views/products/remote-terminal-cloud/MyRemoteTerminalProductsView.vue'),
          },
          {
            path: 'developer/management',
            name: 'developerServiceManagement',
            component: () => import('@/views/developer/DeveloperServiceManagementView.vue'),
            meta: {
              permission: Permission.DEVELOPER_QUOTA_MANAGE,
            },
          },
          {
            path: 'developer/config',
            name: 'developerServiceConfig',
            component: () => import('@/views/developer/DeveloperServiceConfigView.vue'),
            meta: {
              permission: Permission.SYSTEM_CONFIG,
            },
          },
          {
            path: 'account/oauth-apps',
            name: 'oauthClientManagement',
            component: () => import('@/views/settings/OAuthClientManagementView.vue'),
            meta: {
              permission: Permission.OAUTH_CLIENT_READ,
            },
          },
          {
            path: 'account/auth-center-apps',
            name: 'authCenterClientManagement',
            component: () => import('@/views/settings/AuthCenterClientManagementView.vue'),
            meta: {
              permission: Permission.AUTH_CENTER_CLIENT_READ,
            },
          },
          {
            path: 'open-platform/oauth-app-reviews',
            name: 'oauthClientReviewManagement',
            component: () => import('@/views/settings/OAuthClientReviewManagementView.vue'),
            meta: {
              permission: Permission.OAUTH_CLIENT_REVIEW_READ,
            },
          },
          {
            path: 'open-platform/auth-center-app-reviews',
            name: 'authCenterClientReviewManagement',
            component: () => import('@/views/settings/AuthCenterClientReviewManagementView.vue'),
            meta: {
              permission: Permission.AUTH_CENTER_CLIENT_REVIEW_READ,
            },
          },
          {
            path: 'open-platform/ticket-reviews',
            name: 'ticketReviewManagement',
            component: () => import('@/views/settings/TicketReviewManagementView.vue'),
            meta: {
              permission: Permission.TICKET_REVIEW_READ,
            },
          },
          {
            path: 'debug',
            name: 'debug',
            component: () => import('@/views/debug/DebugView.vue'),
          },

          // --- Management ---
          {
            path: 'management/users',
            name: 'userManagement',
            component: () => import('@/views/management/UserManagementView.vue'),
            meta: {
              permission: Permission.USER_READ,
            },
          },
          {
            path: 'management/groups',
            name: 'groupManagement',
            component: () => import('@/views/management/GroupManagementView.vue'),
            meta: {
              permission: Permission.GROUP_READ,
            },
          },
          {
            path: 'management/permissions',
            name: 'permission',
            component: () => import('@/views/management/PermissionManagementView.vue'),
            meta: {
              permission: Permission.PERMISSION_VIEW,
            },
          },
          {
            path: 'management/ram',
            name: 'ramManagement',
            component: () => import('@/views/management/RamManagementView.vue'),
            meta: {
              anyPermissions: [
                Permission.RAM_USER_READ,
                Permission.RAM_ROLE_READ,
                Permission.RAM_BINDING_READ,
                Permission.RAM_SESSION_READ,
              ],
            },
          },
          {
            path: 'kv',
            children: [
              {
                path: '',
                name: 'product-kv',
                component: () => import('@/views/products/kv/KvUserPage.vue'),
                props: { product: 'kv' },
                meta: {
                  anyPermissions: [
                    Permission.PRODUCT_KV_READ,
                    Permission.PRODUCT_KV_WRITE,
                    Permission.PRODUCT_KV_MANAGE,
                  ],
                },
              },
              {
                path: 'management',
                name: 'product-management-kv',
                component: () => import('@/views/products/kv/KvManagementPage.vue'),
                props: { product: 'kv' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'config',
                name: 'product-config-kv',
                component: () => import('@/views/products/kv/KvConfigPage.vue'),
                props: { product: 'kv' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'short-link',
            children: [
              {
                path: '',
                name: 'product-short_link',
                component: () => import('@/views/products/short-link/ShortLinkUserPage.vue'),
                props: { product: 'short_link' },
                meta: {
                  anyPermissions: [
                    Permission.PRODUCT_SHORT_LINK_READ,
                    Permission.PRODUCT_SHORT_LINK_WRITE,
                    Permission.PRODUCT_SHORT_LINK_MANAGE,
                  ],
                },
              },
              {
                path: 'management',
                name: 'product-management-short_link',
                component: () => import('@/views/products/short-link/ShortLinkManagementPage.vue'),
                props: { product: 'short_link' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'config',
                name: 'product-config-short_link',
                component: () => import('@/views/products/short-link/ShortLinkConfigPage.vue'),
                props: { product: 'short_link' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
              {
                path: 'analytics/:instanceId/:linkId',
                name: 'product-short_link-analytics',
                component: () => import('@/views/products/short-link/ShortLinkAnalyticsPage.vue'),
                meta: { permission: Permission.PRODUCT_SHORT_LINK_READ },
              },
            ],
          },
          {
            path: 'secret',
            children: [
              {
                path: '',
                name: 'product-secret',
                component: () => import('@/views/products/secret/SecretUserPage.vue'),
                props: { product: 'secret' },
                meta: {
                  anyPermissions: [
                    Permission.PRODUCT_SECRET_READ,
                    Permission.PRODUCT_SECRET_WRITE,
                    Permission.PRODUCT_SECRET_USE,
                    Permission.PRODUCT_SECRET_MANAGE,
                  ],
                },
              },
              {
                path: 'management',
                name: 'product-management-secret',
                component: () => import('@/views/products/secret/SecretManagementPage.vue'),
                props: { product: 'secret' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'config',
                name: 'product-config-secret',
                component: () => import('@/views/products/secret/SecretConfigPage.vue'),
                props: { product: 'secret' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'status',
            children: [
              {
                path: '',
                name: 'product-status',
                component: () => import('@/views/products/status/StatusUserPage.vue'),
                props: { product: 'status' },
                meta: {
                  anyPermissions: [
                    Permission.PRODUCT_STATUS_READ,
                    Permission.PRODUCT_STATUS_WRITE,
                    Permission.PRODUCT_STATUS_PUBLISH,
                    Permission.PRODUCT_STATUS_MANAGE,
                  ],
                },
              },
              {
                path: 'management',
                name: 'product-management-status',
                component: () => import('@/views/products/status/StatusManagementPage.vue'),
                props: { product: 'status' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'config',
                name: 'product-config-status',
                component: () => import('@/views/products/status/StatusConfigPage.vue'),
                props: { product: 'status' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'verification',
            children: [
              {
                path: '',
                name: 'product-verification',
                component: () => import('@/views/products/verification/VerificationUserPage.vue'),
                props: { product: 'verification' },
                meta: {
                  anyPermissions: [
                    Permission.PRODUCT_VERIFICATION_SEND,
                    Permission.PRODUCT_VERIFICATION_VERIFY,
                    Permission.PRODUCT_VERIFICATION_MANAGE,
                  ],
                },
              },
              {
                path: 'management',
                name: 'product-management-verification',
                component: () =>
                  import('@/views/products/verification/VerificationManagementPage.vue'),
                props: { product: 'verification' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'config',
                name: 'product-config-verification',
                component: () => import('@/views/products/verification/VerificationConfigPage.vue'),
                props: { product: 'verification' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'ip-geolocation',
            children: [
              {
                path: '',
                name: 'product-ip_geolocation',
                component: () =>
                  import('@/views/products/ip-geolocation/IpGeolocationUserPage.vue'),
                props: { product: 'ip_geolocation' },
                meta: {
                  anyPermissions: [
                    Permission.PRODUCT_IP_GEOLOCATION_LOOKUP,
                    Permission.PRODUCT_IP_GEOLOCATION_MANAGE,
                  ],
                },
              },
              {
                path: 'management',
                name: 'product-management-ip_geolocation',
                component: () =>
                  import('@/views/products/ip-geolocation/IpGeolocationManagementPage.vue'),
                props: { product: 'ip_geolocation' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'config',
                name: 'product-config-ip_geolocation',
                component: () =>
                  import('@/views/products/ip-geolocation/IpGeolocationConfigPage.vue'),
                props: { product: 'ip_geolocation' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'push',
            children: [
              {
                path: '',
                name: 'product-push',
                component: () => import('@/views/products/push/PushUserPage.vue'),
                props: { product: 'push' },
                meta: {
                  anyPermissions: [
                    Permission.PRODUCT_PUSH_SEND,
                    Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
                    Permission.PRODUCT_PUSH_DELIVERY_READ,
                    Permission.PRODUCT_PUSH_MANAGE,
                  ],
                },
              },
              {
                path: 'management',
                name: 'product-management-push',
                component: () => import('@/views/products/push/PushManagementPage.vue'),
                props: { product: 'push' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'config',
                name: 'product-config-push',
                component: () => import('@/views/products/push/PushConfigPage.vue'),
                props: { product: 'push' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'products/kv',
            redirect: { name: 'product-kv' },
          },
          {
            path: 'products/short_link',
            redirect: { name: 'product-short_link' },
          },
          {
            path: 'products/secret',
            redirect: { name: 'product-secret' },
          },
          {
            path: 'products/status',
            redirect: { name: 'product-status' },
          },
          {
            path: 'products/verification',
            redirect: { name: 'product-verification' },
          },
          {
            path: 'products/ip_geolocation',
            redirect: { name: 'product-ip_geolocation' },
          },
          {
            path: 'products/push',
            redirect: { name: 'product-push' },
          },
          {
            path: 'management/products/kv',
            redirect: { name: 'product-management-kv' },
          },
          {
            path: 'management/products/short_link',
            redirect: { name: 'product-management-short_link' },
          },
          {
            path: 'management/products/secret',
            redirect: { name: 'product-management-secret' },
          },
          {
            path: 'management/products/status',
            redirect: { name: 'product-management-status' },
          },
          {
            path: 'management/products/verification',
            redirect: { name: 'product-management-verification' },
          },
          {
            path: 'management/products/ip_geolocation',
            redirect: { name: 'product-management-ip_geolocation' },
          },
          {
            path: 'management/products/push',
            redirect: { name: 'product-management-push' },
          },
          {
            path: 'system/products/kv',
            redirect: { name: 'product-config-kv' },
          },
          {
            path: 'system/products/short_link',
            redirect: { name: 'product-config-short_link' },
          },
          {
            path: 'system/products/secret',
            redirect: { name: 'product-config-secret' },
          },
          {
            path: 'system/products/status',
            redirect: { name: 'product-config-status' },
          },
          {
            path: 'system/products/verification',
            redirect: { name: 'product-config-verification' },
          },
          {
            path: 'system/products/ip_geolocation',
            redirect: { name: 'product-config-ip_geolocation' },
          },
          {
            path: 'system/products/push',
            redirect: { name: 'product-config-push' },
          },
          {
            path: 'management/balance',
            name: 'balanceManagement',
            component: () => import('@/views/relay/BalanceManagementView.vue'),
            meta: {
              permission: Permission.BALANCE_READ,
            },
          },
          {
            path: 'management/monthly-passes',
            name: 'monthlyPassManagement',
            component: () => import('@/views/relay/MonthlyPassManagementView.vue'),
            meta: {
              anyPermissions: [
                Permission.MONTHLY_PASS_TEMPLATE_READ,
                Permission.MONTHLY_PASS_ASSIGNMENT_READ,
                Permission.MONTHLY_PASS_USAGE_READ,
              ],
            },
          },
          {
            path: 'management/remote-terminal-products',
            name: 'remoteTerminalProductManagement',
            component: () =>
              import(
                '@/views/products/remote-terminal-cloud/RemoteTerminalProductManagementView.vue'
              ),
            meta: {
              anyPermissions: [
                Permission.REMOTE_TERMINAL_PRODUCT_READ,
                Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
                Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ,
              ],
            },
          },
          {
            path: 'management/redemption-codes',
            name: 'redemptionCodes',
            component: () => import('@/views/relay/RedemptionCodeManagementView.vue'),
            meta: {
              permission: Permission.REDEMPTION_CODE_READ,
            },
          },
          {
            path: 'management/json-endpoints',
            name: 'jsonEndpointManagement',
            component: () => import('@/views/json-endpoint/JsonEndpointManagementView.vue'),
            meta: {
              permission: Permission.JSON_ENDPOINT_READ,
            },
          },
          {
            path: 'management/articles',
            name: 'articleManagement',
            component: () => import('@/views/article/ArticleManagementView.vue'),
            meta: {
              permission: Permission.ARTICLE_READ,
            },
          },
          {
            path: 'management/legal-policies',
            name: 'legalPolicyManagement',
            component: () => import('@/views/management/LegalPolicyManagementView.vue'),
            meta: {
              permission: Permission.LEGAL_POLICY_READ,
            },
          },

          // --- Tools ---
          {
            path: 'tools/scripts',
            name: 'scriptManager',
            component: () => import('@/views/user-script/UserScriptManagerView.vue'),
            meta: {
              permission: Permission.SCRIPT_READ,
            },
          },

          // --- Account ---
          {
            path: 'account/balance',
            name: 'balanceHistory',
            component: () => import('@/views/relay/BalanceHistoryView.vue'),
          },
          {
            path: 'account/consumption',
            name: 'consumptionRecords',
            component: () => import('@/views/relay/ConsumptionRecordsView.vue'),
          },
          {
            path: 'account/tickets',
            name: 'myTickets',
            component: () => import('@/views/workspace/WorkspaceTicketView.vue'),
            meta: {
              anyPermissions: [
                Permission.TICKET_SUBMIT,
                Permission.TICKET_SELF_READ,
                Permission.TICKET_SELF_UPDATE,
                Permission.TICKET_COMMENT,
              ],
            },
          },
          {
            path: 'account/product-subscriptions',
            children: [
              {
                path: '',
                redirect: { name: 'myMonthlyPasses' },
              },
              {
                path: 'monthly-passes',
                name: 'myMonthlyPasses',
                component: () => import('@/views/relay/MyMonthlyPassesView.vue'),
              },
              {
                path: 'monthly-pass-purchase',
                name: 'monthlyPassPurchase',
                redirect: (to) => ({
                  name: 'myMonthlyPasses',
                  query: {
                    ...to.query,
                  },
                }),
              },
              {
                path: 'remote-terminal-products',
                name: 'myRemoteTerminalProducts',
                component: () =>
                  import('@/views/products/remote-terminal-cloud/MyRemoteTerminalProductsView.vue'),
              },
            ],
          },

          // --- API Relay ---
          {
            path: 'relay/tokens',
            name: 'relayTokenManagement',
            component: () => import('@/views/relay/RelayTokenManagementView.vue'),
            meta: {
              permission: Permission.RELAY_TOKEN_READ,
            },
          },
          {
            path: 'relay/api-docs',
            name: 'apiDocumentation',
            component: () => import('@/views/relay/ApiDocumentationView.vue'),
            meta: {
              permission: Permission.RELAY_TOKEN_READ,
            },
          },
          {
            path: 'relay/provider-channels',
            name: 'relayChannelProvider',
            component: () => import('@/views/relay/RelayChannelProviderView.vue'),
            meta: {
              anyPermissions: [
                Permission.RELAY_CHANNEL_SUBMIT,
                Permission.RELAY_CHANNEL_PROVIDER_READ,
              ],
            },
          },
          {
            path: 'relay/channel-review',
            name: 'relayChannelReview',
            component: () => import('@/views/relay/RelayChannelReviewView.vue'),
            meta: { permission: Permission.RELAY_CHANNEL_REVIEW },
          },
          {
            path: 'relay/settings',
            name: 'relaySettings',
            component: () => import('@/views/relay/RelaySettingsView.vue'),
            meta: {
              permission: Permission.MODEL_PRICING_UPDATE,
            },
          },
          {
            path: 'relay/channel-health',
            name: 'relayChannelHealth',
            component: () => import('@/views/relay/RelayChannelHealthView.vue'),
            meta: {
              permission: Permission.RELAY_CHANNEL_HEALTH_READ,
            },
          },
          {
            path: 'relay/request-diagnostics',
            name: 'relayRequestDiagnostics',
            component: () => import('@/views/relay/RelayRequestDiagnosticsView.vue'),
            meta: { permission: Permission.RELAY_REQUEST_DIAGNOSTICS_READ },
          },
          {
            path: 'relay/channel-probes',
            name: 'relayChannelProbes',
            component: () => import('@/views/relay/RelayChannelProbeView.vue'),
            meta: {
              permission: Permission.RELAY_CHANNEL_PROBE_READ,
            },
          },
          {
            path: 'relay/upstream-status',
            name: 'upstreamStatus',
            component: () => import('@/views/relay/UpstreamStatusView.vue'),
            meta: {
              permission: Permission.UPSTREAM_STATUS_READ,
            },
          },
          {
            path: 'relay/remote-terminal',
            name: 'remoteTerminal',
            component: () =>
              import('@/views/products/remote-terminal-cloud/RemoteTerminalView.vue'),
            meta: {
              anyPermissions: [
                Permission.REMOTE_TERMINAL_DEVICE_READ,
                Permission.REMOTE_TERMINAL_SESSION_READ,
                Permission.REMOTE_TERMINAL_SESSION_CREATE,
              ],
            },
          },

          // --- System ---
          {
            path: 'system/config',
            name: 'serverConfig',
            component: () => import('@/views/system/ServerConfigView.vue'),
            meta: {
              permission: Permission.SYSTEM_CONFIG,
            },
          },
          {
            path: 'system/ip-monitoring',
            name: 'ipMonitoring',
            component: () => import('@/views/system/IPMonitoringDashboardView.vue'),
            meta: {
              permission: Permission.IP_BLACKLIST_READ,
            },
          },
          {
            path: 'system/stats',
            name: 'systemStats',
            component: () => import('@/views/system/SystemStatsView.vue'),
            meta: {
              permission: Permission.SYSTEM_STATS_READ,
            },
          },
          {
            path: 'system/consumption-stats',
            name: 'systemConsumptionStats',
            component: () => import('@/views/system/SystemConsumptionStatsView.vue'),
            meta: {
              permission: Permission.SYSTEM_CONSUMPTION_STATS_READ,
            },
          },
          {
            path: 'system/logs',
            name: 'systemLogs',
            component: () => import('@/views/system/SystemLogsView.vue'),
            meta: {
              anyPermissions: [
                Permission.API_LOG_READ,
                Permission.SYSTEM_SERVER_LOG_READ,
                Permission.SYSTEM_LOG_READ,
              ],
            },
          },
          {
            path: 'system/business-logs',
            name: 'businessLogs',
            component: () => import('@/views/system/BusinessLogsView.vue'),
            meta: {
              permission: Permission.SYSTEM_BUSINESS_LOG_READ,
            },
          },
          {
            path: 'system/error-center',
            name: 'errorCenter',
            component: () => import('@/views/system/ErrorCenterView.vue'),
            meta: {
              permission: Permission.SYSTEM_ERROR_REPORT_READ,
            },
          },
          {
            path: 'system/data-lifecycle',
            name: 'dataLifecycle',
            component: () => import('@/views/system/DataLifecycleView.vue'),
            meta: {
              permission: Permission.SYSTEM_DATA_LIFECYCLE_MANAGE,
            },
          },
          {
            path: 'system/data-maintenance',
            name: 'dataMaintenance',
            component: () => import('@/views/system/DataMaintenanceView.vue'),
            meta: {
              permission: Permission.SYSTEM_DATA_MAINTENANCE_MANAGE,
            },
          },
          {
            path: 'system/user-online-monitor',
            name: 'userOnlineMonitor',
            component: () => import('@/views/system/UserOnlineMonitorView.vue'),
            meta: {
              permission: Permission.USER_ONLINE_MONITOR_READ,
            },
          },

          // --- Analytics ---
          {
            path: 'analytics/overview',
            name: 'analyticsOverview',
            component: () => import('@/views/analytics/AnalyticsOverviewView.vue'),
            meta: {
              permission: Permission.ANALYTICS_READ,
            },
          },
          {
            path: 'analytics/funnel',
            name: 'analyticsFunnel',
            component: () => import('@/views/analytics/AnalyticsFunnelView.vue'),
            meta: {
              permission: Permission.ANALYTICS_READ,
            },
          },
          {
            path: 'analytics/heatmap',
            name: 'analyticsHeatmap',
            component: () => import('@/views/analytics/AnalyticsHeatmapView.vue'),
            meta: {
              permission: Permission.ANALYTICS_READ,
            },
          },

          // --- OJ Submitter ---
          {
            path: 'oj-submitter',
            name: 'ojSubmitterRoot',
            meta: {
              anyPermissions: [
                Permission.OJ_APIKEY_READ,
                Permission.OJ_USAGE_READ,
                Permission.OJ_PRICING_READ,
              ],
            },
            children: [
              {
                path: 'apikeys',
                name: 'ojAPIKeyManagement',
                component: () => import('@/views/oj-submitter/APIKeyManagementView.vue'),
                meta: {
                  permission: Permission.OJ_APIKEY_READ,
                },
              },
              {
                path: 'usage',
                name: 'ojUsageStatistics',
                component: () => import('@/views/oj-submitter/UsageStatisticsView.vue'),
                meta: {
                  permission: Permission.OJ_USAGE_READ,
                },
              },
              {
                path: 'pricing',
                name: 'ojPricingManagement',
                component: () => import('@/views/oj-submitter/PricingManagementView.vue'),
                meta: {
                  permission: Permission.OJ_PRICING_READ,
                },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    path: '/:catchAll(.*)',
    component: () => import('@/views/common/404View.vue'),
    meta: {
      allowGuest: true,
    },
  },
] as const satisfies RouteRecordRaw[]

const isRouteRecord = (route: RouteRecordRaw | undefined): route is RouteRecordRaw => route != null

const getRouteGroup = (route: RouteRecordRaw): SiteRouteGroup | undefined => {
  if (typeof route.name === 'string') return routeGroupsByName[route.name]

  if (typeof route.redirect === 'object' && route.redirect && 'name' in route.redirect) {
    const routeName = route.redirect.name
    return typeof routeName === 'string' ? routeGroupsByName[routeName] : undefined
  }

  return undefined
}

const joinRoutePath = (parentPath: string, path: string): string => {
  if (path.startsWith('/')) return path
  const parent = parentPath.replace(/\/$/, '')
  return `${parent}/${path}`.replace(/\/+/g, '/') || '/'
}

const findRoutePath = (
  records: readonly RouteRecordRaw[],
  routeName: string,
  parentPath = '',
): string | undefined => {
  for (const route of records) {
    const path = joinRoutePath(parentPath, route.path)
    if (route.name === routeName) return path
    const childPath = findRoutePath(route.children ?? [], routeName, path)
    if (childPath) return childPath
  }
  return undefined
}

export const resolveCanonicalRouteUrl = (
  routeName: string,
  currentProfile: SiteProfile,
): string | undefined => {
  const group = routeGroupsByName[routeName]
  const path = findRoutePath(routes, routeName)
  if (!group || !path) return undefined

  const targetProfile =
    group === 'shared' || currentProfile.routeGroups.includes(group)
      ? currentProfile
      : siteProfiles.find(
          (profile) =>
            profile.id === group &&
            profile.hostname.endsWith(currentProfile.hostname.endsWith('.test') ? '.test' : '.cn'),
        )

  return targetProfile ? new URL(path, targetProfile.canonicalOrigin).toString() : undefined
}

const cloneRouteForProfile = (
  route: RouteRecordRaw,
  profile: SiteProfile,
): RouteRecordRaw | undefined => {
  const group = getRouteGroup(route)
  const children = route.children
    ?.map((child) => cloneRouteForProfile(child, profile))
    .filter(isRouteRecord)

  if (group && !profile.routeGroups.includes(group)) return undefined
  if (!group && route.children?.length && !children?.length) return undefined

  const clonedRoute = {
    ...route,
    ...(children ? { children } : {}),
  } as RouteRecordRaw

  if (route.name === 'root') {
    clonedRoute.redirect = profile.defaultPath
  }

  return clonedRoute
}

export const createRoutesForProfile = (profile: SiteProfile): RouteRecordRaw[] =>
  routes.map((route) => cloneRouteForProfile(route, profile)).filter(isRouteRecord)
