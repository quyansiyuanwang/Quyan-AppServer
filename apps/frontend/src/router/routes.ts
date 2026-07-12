import { Permission } from '@/constant/permission'
import type { RouteRecordRaw } from 'vue-router'

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
        path: '/auth/captcha',
        name: 'captchaVerification',
        meta: {
          isAuthEntry: true,
        },
        component: () => import('@/views/auth/CaptchaVerificationView.vue'),
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
            path: 'relay/settings',
            name: 'relaySettings',
            component: () => import('@/views/relay/RelaySettingsView.vue'),
            meta: {
              permission: Permission.MODEL_PRICING_UPDATE,
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
  },
] as const satisfies RouteRecordRaw[]
