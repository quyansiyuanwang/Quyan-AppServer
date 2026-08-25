import { Permission } from '@/constant/permission'
import {
  getSiteProfileForEnvironment,
  type SiteProfile,
  type SiteRouteGroup,
} from '@/config/site-registry'
import { getRouteCatalogEntry, getRouteGroup } from '@/router/route-catalog'
import { bindRouteView, lazyFeatureView, lazyOptionalView } from '@/router/feature-view-loader'
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
        component: lazyFeatureView('auth', 'LoginOrRegisterView.vue'),
        meta: {
          isAuthEntry: true,
          requiresCaptchaPreflight: true,
        },
      },
      {
        path: '/register',
        name: 'register',
        component: lazyFeatureView('auth', 'LoginOrRegisterView.vue'),
        meta: {
          isAuthEntry: true,
          requiresCaptchaPreflight: true,
          captchaAction: 'register',
        },
      },
      {
        path: '/forgot-password',
        name: 'forgotPassword',
        component: lazyFeatureView('auth', 'ForgotPasswordView.vue'),
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
        component: lazyFeatureView('auth', 'AuthVerificationView.vue'),
      },
      {
        path: '/oauth/authorize',
        name: 'oauthAuthorize',
        meta: {
          isAuthEntry: true,
        },
        component: lazyFeatureView('auth', 'OAuthAuthorizeView.vue'),
      },
      {
        path: '/auth/external/:provider/callback',
        name: 'externalAuthCallback',
        meta: {
          isAuthEntry: true,
        },
        component: lazyFeatureView('auth', 'ExternalAuthCallbackView.vue'),
      },
      {
        path: '/auth/qr-approve',
        name: 'qrApproval',
        meta: {
          isAuthEntry: true,
          requiresCaptchaPreflight: true,
        },
        component: lazyFeatureView('auth', 'QrApprovalView.vue'),
      },
      {
        path: '/auth/passkeys',
        name: 'authPasskeyManagement',
        component: lazyOptionalView(() => import('@/views/settings/PasskeyManagementView.vue')),
      },
      {
        path: '/auth/external/bind',
        name: 'externalAuthBindStart',
        meta: {
          isAuthEntry: true,
        },
        component: lazyFeatureView('auth', 'ExternalAuthBindStartView.vue'),
      },
      {
        path: '/auth/captcha',
        name: 'captchaVerification',
        meta: {
          isAuthEntry: true,
        },
        component: lazyFeatureView('auth', 'CaptchaVerificationView.vue'),
      },
      {
        path: '/status/:slug',
        name: 'publicStatus',
        component: lazyFeatureView('misc', 'public/PublicStatusView.vue'),
        meta: {
          isAuthEntry: true,
          allowGuest: true,
          publicStatus: true,
        },
      },
      {
        path: '/workspace/suggestions',
        name: 'workspaceSuggestions',
        component: lazyFeatureView('misc', 'workspace/WorkspaceTicketView.vue'),
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
            path: 'overview',
            name: 'publicOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
            meta: { allowGuest: true },
          },
          {
            path: 'overview',
            name: 'identityOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
            meta: { allowGuest: true },
          },
          {
            path: 'overview',
            name: 'accountOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'chatOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'consoleAiOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'consoleDeveloperOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'productKvOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'productShortLinkOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'productSecretOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'productStatusOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'productVerificationOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'productIpGeolocationOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'productPushOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'ojOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'managementAiOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'managementDeveloperOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'overview',
            name: 'managementTerminalOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
          },
          {
            path: 'home',
            name: 'home',
            component: lazyFeatureView('misc', 'article/ArticleViewerView.vue'),
          },
          {
            path: 'chat',
            name: 'chat',
            component: lazyFeatureView('misc', 'chat/ChatView.vue'),
          },
          {
            path: 'chat/agent-machines',
            name: 'agentMachines',
            component: lazyFeatureView('misc', 'chat/AgentMachinesView.vue'),
            meta: { permission: Permission.AGENT_WORKSPACE_READ },
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
                component: lazyFeatureView('settings', 'ProfileSettingsView.vue'),
              },
              {
                path: 'preferences',
                name: 'settingsPreferences',
                component: lazyFeatureView('settings', 'PreferencesSettingsView.vue'),
              },
              {
                path: 'security',
                name: 'settingsSecurity',
                component: lazyFeatureView('settings', 'AccountSecuritySettingsView.vue'),
              },
              {
                path: 'notifications',
                name: 'notificationSettings',
                component: lazyFeatureView('settings', 'NotificationSettingsView.vue'),
              },
            ],
          },
          {
            path: 'subscriptions',
            name: 'myRemoteTerminalProducts',
            component: lazyFeatureView(
              'products',
              'remote-terminal-cloud/MyRemoteTerminalProductsView.vue',
            ),
          },
          {
            path: 'services',
            name: 'developerServiceManagement',
            component: lazyFeatureView('misc', 'developer/DeveloperServiceManagementView.vue'),
            meta: {
              permission: Permission.DEVELOPER_QUOTA_MANAGE,
            },
          },
          {
            path: 'services/configuration',
            name: 'developerServiceConfig',
            component: lazyFeatureView('misc', 'developer/DeveloperServiceConfigView.vue'),
            meta: {
              permission: Permission.SYSTEM_CONFIG,
            },
          },
          {
            path: 'applications/oauth',
            name: 'oauthClientManagement',
            component: lazyFeatureView('settings', 'OAuthClientManagementView.vue'),
            meta: {
              permission: Permission.OAUTH_CLIENT_READ,
            },
          },
          {
            path: 'applications/auth-center',
            name: 'authCenterClientManagement',
            component: lazyFeatureView('settings', 'AuthCenterClientManagementView.vue'),
            meta: {
              permission: Permission.AUTH_CENTER_CLIENT_READ,
            },
          },
          {
            path: 'reviews/oauth',
            name: 'oauthClientReviewManagement',
            component: lazyFeatureView('settings', 'OAuthClientReviewManagementView.vue'),
            meta: {
              permission: Permission.OAUTH_CLIENT_REVIEW_READ,
            },
          },
          {
            path: 'reviews/auth-center',
            name: 'authCenterClientReviewManagement',
            component: lazyFeatureView('settings', 'AuthCenterClientReviewManagementView.vue'),
            meta: {
              permission: Permission.AUTH_CENTER_CLIENT_REVIEW_READ,
            },
          },
          {
            path: 'reviews/tickets',
            name: 'ticketReviewManagement',
            component: lazyFeatureView('settings', 'TicketReviewManagementView.vue'),
            meta: {
              permission: Permission.TICKET_REVIEW_READ,
            },
          },
          {
            path: 'debug',
            name: 'debug',
            component: lazyFeatureView('misc', 'debug/DebugView.vue'),
          },

          // --- Management ---
          {
            path: 'overview',
            name: 'iamOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
            meta: {
              anyPermissions: [
                Permission.USER_READ,
                Permission.GROUP_READ,
                Permission.PERMISSION_VIEW,
                Permission.RAM_ROLE_READ,
              ],
            },
          },
          {
            path: 'iam/users',
            name: 'userManagement',
            component: lazyFeatureView('management', 'UserManagementView.vue'),
            meta: {
              permission: Permission.USER_READ,
            },
          },
          {
            path: 'iam/groups',
            name: 'groupManagement',
            component: lazyFeatureView('management', 'GroupManagementView.vue'),
            meta: {
              permission: Permission.GROUP_READ,
            },
          },
          {
            path: 'iam/authorizations',
            name: 'iamAuthorizations',
            component: lazyFeatureView('management', 'PermissionManagementView.vue'),
            props: { mode: 'authorizations' },
            meta: {
              permission: Permission.PERMISSION_VIEW,
            },
          },
          {
            path: 'iam/permission-policies',
            name: 'iamPermissionPolicies',
            component: lazyFeatureView('management', 'PermissionManagementView.vue'),
            props: { mode: 'policies' },
            meta: {
              permission: Permission.PERMISSION_VIEW,
            },
          },
          {
            path: 'iam/permission-diagnostics',
            name: 'iamPermissionDiagnostics',
            component: lazyFeatureView('management', 'PermissionManagementView.vue'),
            props: { mode: 'diagnostics' },
            meta: {
              permission: Permission.PERMISSION_VIEW,
            },
          },
          {
            path: 'iam/permissions',
            name: 'permission',
            redirect: { name: 'iamAuthorizations' },
            meta: {
              permission: Permission.PERMISSION_VIEW,
            },
          },
          {
            path: 'overview',
            name: 'ramOverview',
            component: () => import('@/views/overview/SiteOverviewView.vue'),
            meta: {
              anyPermissions: [
                Permission.RAM_USER_READ,
                Permission.RAM_ROLE_READ,
                Permission.RAM_BINDING_READ,
                Permission.RAM_POLICY_READ,
                Permission.RAM_SESSION_READ,
              ],
            },
          },
          {
            path: 'users',
            name: 'ramManagement',
            component: lazyFeatureView('management', 'RamManagementView.vue'),
            props: { section: 'users' },
            meta: {
              anyPermissions: [
                Permission.RAM_USER_READ,
                Permission.RAM_ROLE_READ,
                Permission.RAM_BINDING_READ,
                Permission.RAM_POLICY_READ,
                Permission.RAM_SESSION_READ,
              ],
            },
          },
          {
            path: 'roles',
            name: 'ramRoles',
            component: lazyFeatureView('management', 'RamManagementView.vue'),
            props: { section: 'roles' },
            meta: { permission: Permission.RAM_ROLE_READ },
          },
          {
            path: 'role-bindings',
            name: 'ramBindings',
            component: lazyFeatureView('management', 'RamManagementView.vue'),
            props: { section: 'bindings' },
            meta: { permission: Permission.RAM_BINDING_READ },
          },
          {
            path: 'policies',
            name: 'ramPolicies',
            component: lazyFeatureView('management', 'RamManagementView.vue'),
            props: { section: 'policies' },
            meta: { permission: Permission.RAM_POLICY_READ },
          },
          {
            path: 'authorizations',
            name: 'ramAuthorization',
            component: lazyFeatureView('management', 'RamManagementView.vue'),
            props: { section: 'authorization' },
            meta: { permission: Permission.RAM_USER_READ },
          },
          {
            path: 'sessions',
            name: 'ramSessions',
            component: lazyFeatureView('management', 'RamManagementView.vue'),
            props: { section: 'sessions' },
            meta: { permission: Permission.RAM_SESSION_READ },
          },
          {
            path: 'products/kv',
            children: [
              {
                path: '',
                name: 'product-kv',
                component: lazyFeatureView('products', 'kv/KvUserPage.vue'),
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
                component: lazyFeatureView('products', 'kv/KvManagementPage.vue'),
                props: { product: 'kv' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'configuration',
                name: 'product-config-kv',
                component: lazyFeatureView('products', 'kv/KvConfigPage.vue'),
                props: { product: 'kv' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'products/short_link',
            children: [
              {
                path: '',
                name: 'product-short_link',
                component: lazyFeatureView('products', 'short-link/ShortLinkUserPage.vue'),
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
                component: lazyFeatureView('products', 'short-link/ShortLinkManagementPage.vue'),
                props: { product: 'short_link' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'configuration',
                name: 'product-config-short_link',
                component: lazyFeatureView('products', 'short-link/ShortLinkConfigPage.vue'),
                props: { product: 'short_link' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
              {
                path: ':instanceId/:linkId/analytics',
                name: 'product-short_link-analytics',
                component: lazyFeatureView('products', 'short-link/ShortLinkAnalyticsPage.vue'),
                meta: { permission: Permission.PRODUCT_SHORT_LINK_READ },
              },
            ],
          },
          {
            path: 'products/secret',
            children: [
              {
                path: '',
                name: 'product-secret',
                component: lazyFeatureView('products', 'secret/SecretUserPage.vue'),
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
                component: lazyFeatureView('products', 'secret/SecretManagementPage.vue'),
                props: { product: 'secret' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'configuration',
                name: 'product-config-secret',
                component: lazyFeatureView('products', 'secret/SecretConfigPage.vue'),
                props: { product: 'secret' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'products/status',
            children: [
              {
                path: '',
                name: 'product-status',
                component: lazyFeatureView('products', 'status/StatusUserPage.vue'),
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
                component: lazyFeatureView('products', 'status/StatusManagementPage.vue'),
                props: { product: 'status' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'configuration',
                name: 'product-config-status',
                component: lazyFeatureView('products', 'status/StatusConfigPage.vue'),
                props: { product: 'status' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'products/verification',
            children: [
              {
                path: '',
                name: 'product-verification',
                component: lazyFeatureView('products', 'verification/VerificationUserPage.vue'),
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
                component: lazyFeatureView(
                  'products',
                  'verification/VerificationManagementPage.vue',
                ),
                props: { product: 'verification' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'configuration',
                name: 'product-config-verification',
                component: lazyFeatureView('products', 'verification/VerificationConfigPage.vue'),
                props: { product: 'verification' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'products/ip_geolocation',
            children: [
              {
                path: '',
                name: 'product-ip_geolocation',
                component: lazyFeatureView('products', 'ip-geolocation/IpGeolocationUserPage.vue'),
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
                component: lazyFeatureView(
                  'products',
                  'ip-geolocation/IpGeolocationManagementPage.vue',
                ),
                props: { product: 'ip_geolocation' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'configuration',
                name: 'product-config-ip_geolocation',
                component: lazyFeatureView(
                  'products',
                  'ip-geolocation/IpGeolocationConfigPage.vue',
                ),
                props: { product: 'ip_geolocation' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'products/push',
            children: [
              {
                path: '',
                name: 'product-push',
                component: lazyFeatureView('products', 'push/PushUserPage.vue'),
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
                component: lazyFeatureView('products', 'push/PushManagementPage.vue'),
                props: { product: 'push' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE },
              },
              {
                path: 'configuration',
                name: 'product-config-push',
                component: lazyFeatureView('products', 'push/PushConfigPage.vue'),
                props: { product: 'push' },
                meta: { permission: Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE },
              },
            ],
          },
          {
            path: 'kv',
            redirect: { name: 'product-kv' },
          },
          {
            path: 'short-link',
            redirect: { name: 'product-short_link' },
          },
          {
            path: 'secret',
            redirect: { name: 'product-secret' },
          },
          {
            path: 'status',
            redirect: { name: 'product-status' },
          },
          {
            path: 'verification',
            redirect: { name: 'product-verification' },
          },
          {
            path: 'ip-geolocation',
            redirect: { name: 'product-ip_geolocation' },
          },
          {
            path: 'push',
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
            path: 'billing/balance',
            name: 'balanceManagement',
            component: lazyFeatureView('relay', 'BalanceManagementView.vue'),
            meta: {
              permission: Permission.BALANCE_READ,
            },
          },
          {
            path: 'billing/monthly-passes',
            name: 'monthlyPassManagement',
            component: lazyFeatureView('relay', 'MonthlyPassManagementView.vue'),
            meta: {
              anyPermissions: [
                Permission.MONTHLY_PASS_TEMPLATE_READ,
                Permission.MONTHLY_PASS_ASSIGNMENT_READ,
                Permission.MONTHLY_PASS_USAGE_READ,
              ],
            },
          },
          {
            path: 'products/remote-terminal',
            redirect: { name: 'remoteTerminalProductTemplates' },
          },
          {
            path: 'products/remote-terminal/templates',
            name: 'remoteTerminalProductTemplates',
            component: lazyFeatureView(
              'products',
              'remote-terminal-cloud/RemoteTerminalProductTemplatesView.vue',
            ),
            meta: {
              permission: Permission.REMOTE_TERMINAL_PRODUCT_READ,
            },
          },
          {
            path: 'products/remote-terminal/entitlements',
            name: 'remoteTerminalProductEntitlements',
            component: lazyFeatureView(
              'products',
              'remote-terminal-cloud/RemoteTerminalProductEntitlementsView.vue',
            ),
            meta: {
              permission: Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
            },
          },
          {
            path: 'products/remote-terminal/devices',
            name: 'remoteTerminalProductDevices',
            component: lazyFeatureView(
              'products',
              'remote-terminal-cloud/RemoteTerminalProductDevicesView.vue',
            ),
            meta: {
              permission: Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ,
            },
          },
          {
            path: 'billing/redemption-codes',
            name: 'redemptionCodes',
            component: lazyFeatureView('relay', 'RedemptionCodeManagementView.vue'),
            meta: {
              permission: Permission.REDEMPTION_CODE_READ,
            },
          },
          {
            path: 'content/json-endpoints',
            name: 'jsonEndpointManagement',
            component: lazyFeatureView('misc', 'json-endpoint/JsonEndpointManagementView.vue'),
            meta: {
              permission: Permission.JSON_ENDPOINT_READ,
            },
          },
          {
            path: 'content/articles',
            name: 'articleManagement',
            component: lazyFeatureView('misc', 'article/ArticleManagementView.vue'),
            meta: {
              permission: Permission.ARTICLE_READ,
            },
          },
          {
            path: 'content/legal-policies',
            name: 'legalPolicyManagement',
            component: lazyFeatureView('management', 'LegalPolicyManagementView.vue'),
            meta: {
              permission: Permission.LEGAL_POLICY_READ,
            },
          },

          // --- Tools ---
          {
            path: 'scripts',
            name: 'scriptManager',
            component: lazyFeatureView('misc', 'user-script/UserScriptManagerView.vue'),
            meta: {
              permission: Permission.SCRIPT_READ,
            },
          },

          // --- Account ---
          {
            path: 'billing/balance',
            name: 'balanceHistory',
            component: lazyFeatureView('relay', 'BalanceHistoryView.vue'),
          },
          {
            path: 'billing/consumption',
            name: 'consumptionRecords',
            component: lazyFeatureView('relay', 'ConsumptionRecordsView.vue'),
          },
          {
            path: 'support/tickets',
            name: 'myTickets',
            component: lazyFeatureView('misc', 'workspace/WorkspaceTicketView.vue'),
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
            path: 'subscriptions',
            children: [
              {
                path: '',
                redirect: { name: 'myMonthlyPasses' },
              },
              {
                path: 'monthly-passes',
                name: 'myMonthlyPasses',
                component: lazyFeatureView('relay', 'MyMonthlyPassesView.vue'),
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
                redirect: { name: 'myRemoteTerminalProducts' },
              },
            ],
          },

          // --- API Relay ---
          {
            path: 'relay/tokens',
            name: 'relayTokenManagement',
            component: lazyFeatureView('relay', 'RelayTokenManagementView.vue'),
            meta: {
              permission: Permission.RELAY_TOKEN_READ,
            },
          },
          {
            path: 'relay/api-docs',
            name: 'apiDocumentation',
            component: lazyFeatureView('relay', 'ApiDocumentationView.vue'),
            meta: {
              permission: Permission.RELAY_TOKEN_READ,
            },
          },
          {
            path: 'relay/channels',
            name: 'relayChannelProvider',
            component: lazyFeatureView('relay', 'RelayChannelProviderView.vue'),
            meta: {
              anyPermissions: [
                Permission.RELAY_CHANNEL_SUBMIT,
                Permission.RELAY_CHANNEL_PROVIDER_READ,
              ],
            },
          },
          {
            path: 'channels/review',
            name: 'relayChannelReview',
            component: lazyFeatureView('relay', 'RelayChannelReviewView.vue'),
            meta: { permission: Permission.RELAY_CHANNEL_REVIEW },
          },
          {
            path: 'relay/settings',
            name: 'relaySettings',
            component: lazyFeatureView('relay', 'RelaySettingsView.vue'),
            meta: {
              permission: Permission.MODEL_PRICING_UPDATE,
            },
          },
          {
            path: 'relay/content-safety',
            name: 'relayContentSafety',
            component: lazyFeatureView('relay', 'RelayContentSafetyView.vue'),
            meta: { permission: Permission.RELAY_TOKEN_READ },
          },
          {
            path: 'channels/health',
            name: 'relayChannelHealth',
            component: lazyFeatureView('relay', 'RelayChannelHealthView.vue'),
            meta: {
              permission: Permission.RELAY_CHANNEL_HEALTH_READ,
            },
          },
          {
            path: 'diagnostics/requests',
            name: 'relayRequestDiagnostics',
            component: lazyFeatureView('relay', 'RelayRequestDiagnosticsView.vue'),
            meta: { permission: Permission.RELAY_REQUEST_DIAGNOSTICS_READ },
          },
          {
            path: 'channels/probes',
            name: 'relayChannelProbes',
            component: lazyFeatureView('relay', 'RelayChannelProbeView.vue'),
            meta: {
              permission: Permission.RELAY_CHANNEL_PROBE_READ,
            },
          },
          {
            path: 'upstreams',
            name: 'upstreamStatus',
            component: lazyFeatureView('relay', 'UpstreamStatusView.vue'),
            meta: {
              permission: Permission.UPSTREAM_STATUS_READ,
            },
          },
          {
            path: 'overview',
            name: 'terminalOverview',
            component: lazyFeatureView(
              'products',
              'remote-terminal-cloud/TerminalOverviewView.vue',
            ),
            meta: {
              anyPermissions: [
                Permission.REMOTE_TERMINAL_PRODUCT_READ,
                Permission.REMOTE_TERMINAL_DEVICE_READ,
                Permission.REMOTE_TERMINAL_SESSION_READ,
                Permission.REMOTE_TERMINAL_SESSION_CREATE,
              ],
            },
          },
          {
            path: 'workspace',
            name: 'remoteTerminal',
            component: lazyFeatureView('products', 'remote-terminal-cloud/RemoteTerminalView.vue'),
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
            component: lazyFeatureView('system', 'ServerConfigView.vue'),
            meta: {
              permission: Permission.SYSTEM_CONFIG,
            },
          },
          {
            path: 'system/ai-support',
            name: 'supportAiConfig',
            component: lazyFeatureView('system', 'SupportAiConfigView.vue'),
            meta: { permission: Permission.SUPPORT_AI_CONFIG },
          },
          {
            path: 'system/ai-support-analytics',
            name: 'supportAiAnalytics',
            component: lazyFeatureView('system', 'SupportAiAnalyticsView.vue'),
            meta: { permission: Permission.SUPPORT_AI_ANALYTICS_READ },
          },
          {
            path: 'system/ip-monitoring',
            name: 'ipMonitoring',
            component: lazyFeatureView('system', 'IPMonitoringDashboardView.vue'),
            meta: {
              permission: Permission.IP_BLACKLIST_READ,
            },
          },
          {
            path: 'system/stats',
            name: 'systemStats',
            component: lazyFeatureView('system', 'SystemStatsView.vue'),
            meta: {
              permission: Permission.SYSTEM_STATS_READ,
            },
          },
          {
            path: 'system/consumption-stats',
            name: 'systemConsumptionStats',
            component: lazyFeatureView('system', 'SystemConsumptionStatsView.vue'),
            meta: {
              permission: Permission.SYSTEM_CONSUMPTION_STATS_READ,
            },
          },
          {
            path: 'system/logs',
            name: 'systemLogs',
            component: lazyFeatureView('system', 'SystemLogsView.vue'),
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
            component: lazyFeatureView('system', 'BusinessLogsView.vue'),
            meta: {
              permission: Permission.SYSTEM_BUSINESS_LOG_READ,
            },
          },
          {
            path: 'system/error-center',
            name: 'errorCenter',
            component: lazyFeatureView('system', 'ErrorCenterView.vue'),
            meta: {
              permission: Permission.SYSTEM_ERROR_REPORT_READ,
            },
          },
          {
            path: 'system/data-lifecycle',
            name: 'dataLifecycle',
            component: lazyFeatureView('system', 'DataLifecycleView.vue'),
            meta: {
              permission: Permission.SYSTEM_DATA_LIFECYCLE_MANAGE,
            },
          },
          {
            path: 'system/data-maintenance',
            name: 'dataMaintenance',
            component: lazyFeatureView('system', 'DataMaintenanceView.vue'),
            meta: {
              permission: Permission.SYSTEM_DATA_MAINTENANCE_MANAGE,
            },
          },
          {
            path: 'system/user-online-monitor',
            name: 'userOnlineMonitor',
            component: lazyFeatureView('system', 'UserOnlineMonitorView.vue'),
            meta: {
              permission: Permission.USER_ONLINE_MONITOR_READ,
            },
          },

          // --- Analytics ---
          {
            path: 'analytics/overview',
            name: 'analyticsOverview',
            component: lazyFeatureView('analytics', 'AnalyticsOverviewView.vue'),
            meta: {
              permission: Permission.ANALYTICS_READ,
            },
          },
          {
            path: 'analytics/funnel',
            name: 'analyticsFunnel',
            component: lazyFeatureView('analytics', 'AnalyticsFunnelView.vue'),
            meta: {
              permission: Permission.ANALYTICS_READ,
            },
          },
          {
            path: 'analytics/heatmap',
            name: 'analyticsHeatmap',
            component: lazyFeatureView('analytics', 'AnalyticsHeatmapView.vue'),
            meta: {
              permission: Permission.ANALYTICS_READ,
            },
          },

          // --- OJ Submitter ---
          {
            path: 'api-keys',
            name: 'ojSubmitterRoot',
            redirect: { name: 'ojAPIKeyManagement' },
            meta: {
              anyPermissions: [
                Permission.OJ_APIKEY_READ,
                Permission.OJ_USAGE_READ,
                Permission.OJ_PRICING_READ,
              ],
            },
            children: [
              {
                path: '',
                name: 'ojAPIKeyManagement',
                component: lazyFeatureView('misc', 'oj-submitter/APIKeyManagementView.vue'),
                meta: {
                  permission: Permission.OJ_APIKEY_READ,
                },
              },
            ],
          },
          {
            path: 'usage',
            name: 'ojUsageStatistics',
            component: lazyFeatureView('misc', 'oj-submitter/UsageStatisticsView.vue'),
            meta: {
              permission: Permission.OJ_USAGE_READ,
            },
          },
          {
            path: 'pricing',
            name: 'ojPricingManagement',
            component: lazyFeatureView('misc', 'oj-submitter/PricingManagementView.vue'),
            meta: {
              permission: Permission.OJ_PRICING_READ,
            },
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

const getRouteRecordGroup = (route: RouteRecordRaw): SiteRouteGroup | undefined => {
  if (typeof route.name === 'string') return getRouteGroup(route.name)

  if (typeof route.redirect === 'object' && route.redirect && 'name' in route.redirect) {
    const routeName = route.redirect.name
    return typeof routeName === 'string' ? getRouteGroup(routeName) : undefined
  }

  return undefined
}

export const resolveCanonicalRouteUrl = (
  routeName: string,
  currentProfile: SiteProfile,
): string | undefined => {
  const entry = getRouteCatalogEntry(routeName)
  if (!entry || entry.group === 'shared' || entry.path.includes(':')) return undefined

  const targetProfile = currentProfile.routeGroups.includes(entry.group)
    ? currentProfile
    : getSiteProfileForEnvironment(entry.group, currentProfile)

  return targetProfile ? new URL(entry.path, targetProfile.canonicalOrigin).toString() : undefined
}

const cloneRouteForProfile = (
  route: RouteRecordRaw,
  profile: SiteProfile,
): RouteRecordRaw | undefined => {
  const group = getRouteRecordGroup(route)
  const children = route.children
    ?.map((child) => cloneRouteForProfile(child, profile))
    .filter(isRouteRecord)

  if (group && !profile.routeGroups.includes(group)) return undefined
  if (!group && route.children?.length && !children?.length) return undefined

  const boundComponent =
    typeof route.name === 'string' && route.component
      ? bindRouteView(route.name, route.component)
      : route.component
  const clonedRoute = {
    ...route,
    ...(boundComponent ? { component: boundComponent } : {}),
    ...(children ? { children } : {}),
  } as RouteRecordRaw

  // Product users get a capability path, while the same source branch keeps
  // the /products/* path for developer-management children.
  if (profile.kind === 'product' && children) {
    const productRoot = children.find(
      (child) =>
        child.path === '' &&
        typeof child.name === 'string' &&
        getRouteCatalogEntry(child.name)?.group === profile.id,
    )
    const productEntry = productRoot ? getRouteCatalogEntry(String(productRoot.name)) : undefined
    if (productEntry) {
      clonedRoute.path = productEntry.path.replace(/^\//, '')
    }
  }

  const isLightweightProfile = profile.id === 'public' || profile.id === 'identity'
  if (isLightweightProfile && route.path === '' && !route.name && route.component) {
    clonedRoute.component = () => import('@/app-roots/RouteOutlet.vue')
  }
  if (profile.id === 'public' && route.name === 'indexDirect') {
    clonedRoute.component = () => import('@/app-roots/RouteOutlet.vue')
  }

  if (route.name === 'root' || route.name === 'index') {
    clonedRoute.redirect = profile.defaultPath
  }

  return clonedRoute
}

export const createRoutesForProfile = (profile: SiteProfile): RouteRecordRaw[] =>
  routes.map((route) => cloneRouteForProfile(route, profile)).filter(isRouteRecord)
