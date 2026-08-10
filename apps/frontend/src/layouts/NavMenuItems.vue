<template>
  <template v-for="node in homeMenuNodes" :key="node.id">
    <el-menu-item
      :index="node.route!"
      @click="nav(node.route!, $event)"
      @contextmenu.prevent="openRouteMenu(node.route!, $event)"
    >
      <el-icon><component :is="node.icon" /></el-icon>
      <template #title>{{ i18ns.t(node.labelKey as any) }}</template>
    </el-menu-item>
  </template>

  <template v-if="showPinnedSection && hasPinnedSlot">
    <li v-if="homeMenuNodes.length" class="menu-divider" />
    <slot name="pinned" />
    <li v-if="navigationMenuNodes.length" class="menu-divider" />
  </template>

  <template v-for="(node, index) in navigationMenuNodes" :key="node.id">
    <li v-if="node.dividerBefore && index > 0" class="menu-divider" />
    <el-sub-menu v-if="node.children?.length" :index="node.id">
      <template #title>
        <el-icon><component :is="node.icon" /></el-icon>
        <span>{{ i18ns.t(node.labelKey as any) }}</span>
      </template>
      <template v-for="child in node.children" :key="child.id">
        <el-sub-menu v-if="child.children?.length" :index="child.id">
          <template #title>
            <el-icon><component :is="child.icon" /></el-icon>
            <span>{{ i18ns.t(child.labelKey as any) }}</span>
          </template>
          <el-menu-item
            v-for="entry in child.children"
            :key="entry.id"
            :index="entry.route!"
            @click="nav(entry.route!, $event)"
            @contextmenu.prevent="openRouteMenu(entry.route!, $event)"
          >
            <el-icon><component :is="entry.icon" /></el-icon>
            <template #title>{{ i18ns.t(entry.labelKey as any) }}</template>
          </el-menu-item>
        </el-sub-menu>
        <el-menu-item
          v-else
          :index="child.route!"
          @click="nav(child.route!, $event)"
          @contextmenu.prevent="openRouteMenu(child.route!, $event)"
        >
          <el-icon><component :is="child.icon" /></el-icon>
          <template #title>{{ i18ns.t(child.labelKey as any) }}</template>
        </el-menu-item>
      </template>
    </el-sub-menu>
    <el-menu-item
      v-else
      :index="node.route!"
      @click="nav(node.route!, $event)"
      @contextmenu.prevent="openRouteMenu(node.route!, $event)"
    >
      <el-icon><component :is="node.icon" /></el-icon>
      <template #title>{{ i18ns.t(node.labelKey as any) }}</template>
    </el-menu-item>
  </template>

  <li v-if="visibleMenuNodes.length && hasTrailingNavigation" class="menu-divider" />
  <div v-if="showSpacer" class="menu-spacer" />

  <PermissionWrapper :require="[Permission.DEBUG_ACCESS]">
    <el-menu-item
      v-if="router.hasRoute('debug')"
      index="debug"
      class="item-muted"
      @click="nav('debug', $event)"
      @contextmenu.prevent="openRouteMenu('debug', $event)"
    >
      <el-icon><Operation /></el-icon>
      <template #title>{{ i18ns.t('nav.debug') }}</template>
    </el-menu-item>
  </PermissionWrapper>

  <el-menu-item v-if="showLogout" index="logout" class="item-logout" @click="logout">
    <el-icon><LogoutIcon :size="16" /></el-icon>
    <template #title>{{ i18ns.t('logout') }}</template>
  </el-menu-item>
</template>

<script lang="ts" setup>
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
import { computed, useSlots } from 'vue'
import { i18ns } from '@/locales'
import { Permission } from '@/constant/permission'
import {
  DEVELOPER_PRODUCT_NAVIGATION,
  developerProductConfigRoute,
  developerProductManagementRoute,
  developerProductUserRoute,
} from '@/constant/developer-product-navigation'
import LogoutIcon from '@/components/icons/LogoutIcon.vue'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import router from '@/router'
import { authorizationService } from '@/service/authorizationService'
import { usePermissionStore } from '@/stores/permissionStore'
import type { RouteName } from '@/types/route-types.gen'

type MenuNode = {
  id: string
  labelKey: string
  icon: Component
  route?: RouteName
  permissions?: readonly Permission[]
  permissionMode?: 'all' | 'any'
  children?: readonly MenuNode[]
  dividerBefore?: boolean
  presentation?: 'flat' | 'group'
}

const item = (
  route: RouteName,
  labelKey: string,
  icon: Component,
  permissions?: readonly Permission[],
  permissionMode: 'all' | 'any' = 'all',
): MenuNode => ({ id: route, route, labelKey, icon, permissions, permissionMode })

const group = (
  id: string,
  labelKey: string,
  icon: Component,
  children: readonly MenuNode[],
  dividerBefore = false,
  presentation: 'flat' | 'group' = 'group',
): MenuNode => ({ id, labelKey, icon, children, dividerBefore, presentation })

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

const menuDefinition: readonly MenuNode[] = [
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
  item('myRemoteTerminalProducts', 'nav.myRemoteTerminalProducts', Monitor),
  item('chat', 'nav.chat', ChatDotRound, [Permission.RELAY_TOKEN_READ]),
  item(
    'oauthClientManagement',
    'nav.oauthClientManagement',
    Link,
    [Permission.OAUTH_CLIENT_READ],
    'all',
  ),
  item('authCenterClientManagement', 'nav.authCenterClientManagement', Key, [
    Permission.AUTH_CENTER_CLIENT_READ,
  ]),
  relayMenu,
  item(
    'developerProducts',
    'nav.productCatalog',
    Connection,
    [
      ...DEVELOPER_PRODUCT_NAVIGATION.flatMap((product) => product.permissions),
      Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE,
      Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE,
    ],
    'any',
  ),
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
  item(
    'remoteTerminalProductManagement',
    'nav.remoteTerminalProductManagement',
    Setting,
    [
      Permission.REMOTE_TERMINAL_PRODUCT_READ,
      Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
      Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ,
    ],
    'any',
  ),
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
        item('roleManagement', 'nav.roles', Key, [Permission.RAM_ROLE_READ]),
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

const props = withDefaults(
  defineProps<{
    showSpacer?: boolean
    showLogout?: boolean
    showPinnedSection?: boolean
    onRouteNavigate?: (name: RouteName, event?: MouseEvent) => void
    onRouteContextMenu?: (name: RouteName, event: MouseEvent) => void
  }>(),
  { showSpacer: false, showLogout: false, showPinnedSection: false },
)

const permissionStore = usePermissionStore()
const slots = useSlots()
const hasPinnedSlot = computed(() => Boolean(slots.pinned))

const isAllowed = (node: MenuNode): boolean => {
  if (!node.permissions?.length) return true
  return node.permissionMode === 'any'
    ? permissionStore.hasAnyPermission(...node.permissions)
    : permissionStore.hasAllPermissions(...node.permissions)
}

const filterVisibleNodes = (nodes: readonly MenuNode[]): MenuNode[] => {
  const visibleNodes: MenuNode[] = []

  for (const node of nodes) {
    if (!isAllowed(node)) continue
    const children = node.children ? filterVisibleNodes(node.children) : undefined
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
    } else if (node.route && router.hasRoute(node.route)) {
      visibleNodes.push({ ...node, children: undefined })
    }
  }

  return visibleNodes
}

const visibleMenuNodes = computed(() => filterVisibleNodes(menuDefinition))
const isHomeRoute = (route?: RouteName): boolean => route === 'home' || route === 'consoleDashboard'
const homeMenuNodes = computed(() =>
  visibleMenuNodes.value.filter((node) => isHomeRoute(node.route)),
)
const navigationMenuNodes = computed(() =>
  visibleMenuNodes.value.filter((node) => !isHomeRoute(node.route)),
)
const hasTrailingNavigation = computed(() => props.showLogout || router.hasRoute('debug'))

const nav = (name: RouteName, event?: MouseEvent) => {
  props.onRouteNavigate?.(name, event)
  if (!props.onRouteNavigate) router.push({ name } as any)
}

const openRouteMenu = (name: RouteName, event: MouseEvent) =>
  props.onRouteContextMenu?.(name, event)
const logout = () => authorizationService.logout()
</script>

<style scoped>
.menu-divider {
  height: 1px;
  margin: 4px 12px;
  background: var(--el-border-color-lighter);
  list-style: none;
  flex-shrink: 0;
}
.menu-spacer {
  flex: 1;
  min-height: 12px;
}
.item-muted {
  opacity: 0.55;
  font-size: 12px;
}
.item-muted:hover {
  opacity: 0.8;
}
.item-logout {
  color: var(--el-color-danger) !important;
}
.item-logout :deep(.el-icon) {
  color: var(--el-color-danger) !important;
}
.item-logout:hover {
  background: var(--el-color-danger-light-9) !important;
}
</style>
