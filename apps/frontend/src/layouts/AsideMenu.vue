<template>
  <div
    class="aside-menu"
    :class="{
      'is-collapsed': showIsDesktopIcon,
      'is-mobile': !isDesktop,
    }"
  >
    <!-- Brand header (desktop only) -->
    <div v-if="isDesktop" class="aside-header">
      <div class="aside-brand">
        <el-icon size="18"><Grid /></el-icon>
        <span class="brand-name">AppServer</span>
      </div>
      <div class="header-actions">
        <el-tooltip
          :content="i18ns.t(showIsDesktopIcon ? 'nav.expandSidebar' : 'nav.collapseSidebar')"
        >
          <button type="button" class="header-icon-button" @click.stop="toggleCollapse">
            <el-icon class="toggle-icon" size="14">
              <component :is="showIsDesktopIcon ? Expand : Fold" />
            </el-icon>
          </button>
        </el-tooltip>
        <el-tooltip
          :content="i18ns.t(showOverview ? 'nav.collapseOverview' : 'nav.expandOverview')"
        >
          <button
            type="button"
            class="header-icon-button"
            :class="{ 'is-active': showOverview }"
            @click.stop="toggleOverview"
          >
            <el-icon size="14"><Operation /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </div>

    <!-- Desktop sidebar menu -->
    <el-menu ref="menuRef" :collapse="showIsDesktopIcon" class="aside-nav">
      <NavMenuItems
        :show-spacer="true"
        :show-logout="true"
        :show-pinned-section="pinnedItems.length > 0 && !showIsDesktopIcon"
        :on-route-navigate="handleRouteNavigation"
        :on-route-context-menu="openRouteContextMenu"
      >
        <template #pinned>
          <li class="pinned-menu-section">
            <div class="pinned-menu-section__header">
              <span class="pinned-menu-section__title">{{ i18ns.t('nav.pinnedPages') }}</span>
            </div>
            <div ref="desktopPinnedListRef" class="pinned-menu-list">
              <div
                v-for="item in pinnedItems"
                :key="item.key"
                :data-route-name="item.route"
                class="pinned-menu-link"
                :class="{
                  'is-active': item.route ? router.currentRoute.value.name === item.route : false,
                }"
                @contextmenu.prevent="item.route && openRouteContextMenu(item.route, $event)"
              >
                <button
                  type="button"
                  class="pinned-menu-link__drag"
                  :aria-label="i18ns.t('nav.dragPinnedPage')"
                  @click.stop
                >
                  <el-icon><Rank /></el-icon>
                </button>
                <button
                  type="button"
                  class="pinned-menu-link__main"
                  @click="
                    item.route
                      ? handleRouteNavigation(item.route, $event)
                      : handleOverviewItem(item)
                  "
                >
                  <span class="pinned-menu-link__content">
                    <el-icon><component :is="item.icon" /></el-icon>
                    <span>{{ item.label }}</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="pinned-menu-link__remove"
                  :aria-label="i18ns.t('nav.unpinPage')"
                  @click.stop="item.route && confirmTogglePinnedRoute(item.route)"
                >
                  <el-icon><Close /></el-icon>
                </button>
              </div>
            </div>
          </li>
        </template>
      </NavMenuItems>
    </el-menu>

    <div
      v-if="isDesktop && routeContextMenu.visible && routeContextMenuItem"
      ref="routeContextMenuRef"
      class="route-context-menu"
      :style="routeContextMenuStyle"
      @click.stop
      @contextmenu.prevent
    >
      <div class="route-context-menu__header">
        <el-icon><component :is="routeContextMenuItem.icon" /></el-icon>
        <span>{{ routeContextMenuItem.label }}</span>
      </div>
      <button type="button" class="route-context-menu__item" @click="openRouteInNewTabFromMenu">
        <el-icon><Link /></el-icon>
        <span>{{ i18ns.t('nav.openInNewTab') }}</span>
      </button>
      <button type="button" class="route-context-menu__item" @click="togglePinnedRouteFromMenu">
        <el-icon><component :is="routeContextMenuPinned ? StarFilled : Star" /></el-icon>
        <span>{{ i18ns.t(routeContextMenuPinned ? 'nav.unpinPage' : 'nav.pinPage') }}</span>
      </button>
    </div>

    <el-drawer
      v-if="isDesktop"
      v-model="showOverview"
      direction="ltr"
      :size="overviewDrawerSize"
      class="overview-drawer"
      :with-header="false"
    >
      <div class="overview-panel">
        <div class="overview-banner overview-banner--drawer">
          <div class="overview-banner__text">
            <div class="overview-banner__title">{{ i18ns.t('nav.overviewTitle') }}</div>
            <div class="overview-banner__description">{{ i18ns.t('nav.overviewDescription') }}</div>
          </div>
          <button
            type="button"
            class="header-icon-button overview-close-button"
            :aria-label="i18ns.t('nav.collapseOverview')"
            @click="showOverview = false"
          >
            <el-icon size="16"><Close /></el-icon>
          </button>
        </div>

        <div class="overview-sections">
          <div class="overview-toolbar">
            <el-input
              v-model="categoryKeyword"
              clearable
              size="large"
              class="overview-search"
              :placeholder="i18ns.t('nav.categorySearchPlaceholder')"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-input
              v-model="featureKeyword"
              clearable
              size="large"
              class="overview-search"
              :placeholder="i18ns.t('nav.featureSearchPlaceholder')"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
          </div>

          <div v-if="pinnedItems.length > 0" class="overview-pinned-strip">
            <div class="overview-pinned-strip__title">
              <el-icon><StarFilled /></el-icon>
              <span>{{ i18ns.t('nav.pinnedPages') }}</span>
            </div>
            <div class="overview-pinned-strip__hint">{{ i18ns.t('nav.pinnedPagesHint') }}</div>
            <div ref="overviewPinnedListRef" class="overview-pinned-strip__list">
              <div
                v-for="item in pinnedItems"
                :key="item.key"
                :data-route-name="item.route"
                class="overview-chip"
                :class="{
                  'is-active': item.route ? router.currentRoute.value.name === item.route : false,
                }"
                @contextmenu.prevent="item.route && openRouteContextMenu(item.route, $event)"
              >
                <button
                  type="button"
                  class="overview-chip__drag"
                  :aria-label="i18ns.t('nav.dragPinnedPage')"
                  @click.stop
                >
                  <el-icon><Rank /></el-icon>
                </button>
                <button type="button" class="overview-chip__main" @click="handleOverviewItem(item)">
                  <el-icon><component :is="item.icon" /></el-icon>
                  <span>{{ item.label }}</span>
                </button>
                <button
                  v-if="item.route"
                  type="button"
                  class="overview-chip__remove"
                  :aria-label="i18ns.t('nav.unpinPage')"
                  @click.stop="confirmTogglePinnedRoute(item.route)"
                >
                  <el-icon><Close /></el-icon>
                </button>
              </div>
            </div>
          </div>

          <div v-if="filteredOverviewSections.length > 0" class="overview-table-grid">
            <section
              v-for="section in filteredOverviewSections"
              :key="section.key"
              class="overview-card"
            >
              <header class="overview-card__header">
                <div class="overview-card__title">
                  <el-icon><component :is="section.icon" /></el-icon>
                  <span>{{ section.title }}</span>
                </div>
              </header>
              <div class="overview-card__body">
                <div
                  v-for="item in section.items"
                  :key="item.key"
                  class="overview-link"
                  :class="{
                    'is-active': item.route ? router.currentRoute.value.name === item.route : false,
                  }"
                >
                  <button
                    type="button"
                    class="overview-link__main"
                    @contextmenu.prevent="item.route && openRouteContextMenu(item.route, $event)"
                    @click="handleOverviewItem(item)"
                  >
                    <span class="overview-link__content">
                      <el-icon><component :is="item.icon" /></el-icon>
                      <span>{{ item.label }}</span>
                    </span>
                  </button>
                  <button
                    v-if="item.route"
                    type="button"
                    class="overview-pin-button"
                    :class="{ 'is-pinned': isPinned(item.route) }"
                    :aria-label="i18ns.t(isPinned(item.route) ? 'nav.unpinPage' : 'nav.pinPage')"
                    @click.stop="confirmTogglePinnedRoute(item.route)"
                  >
                    <el-icon><component :is="isPinned(item.route) ? StarFilled : Star" /></el-icon>
                  </button>
                </div>
              </div>
            </section>
          </div>

          <el-empty v-else :description="i18ns.t('nav.noMatchedFeatures')" />
        </div>
      </div>
    </el-drawer>

    <!-- Mobile bottom Tab Bar -->
    <div v-if="!isDesktop" class="mobile-tab-bar">
      <div
        class="tab-item"
        :class="{ active: router.currentRoute.value.name === 'home' }"
        @click="router.push({ name: 'home' })"
      >
        <el-icon><HomeFilled /></el-icon>
        <span>{{ i18ns.t('nav.home') }}</span>
      </div>

      <div
        class="tab-item"
        :class="{ active: router.currentRoute.value.name === 'settings' }"
        @click="router.push({ name: 'settings' })"
      >
        <el-icon><Setting /></el-icon>
        <span>{{ i18ns.t('nav.settings') }}</span>
      </div>

      <div class="tab-item" @click="authorizationService.logout()">
        <el-icon><LogoutIcon :size="22" /></el-icon>
        <span>{{ i18ns.t('logout') }}</span>
      </div>

      <div class="tab-item" @click="showMobileDrawer = true">
        <el-icon><MoreFilled /></el-icon>
        <span>{{ i18ns.t('nav.more') }}</span>
      </div>
    </div>

    <!-- Mobile side drawer -->
    <el-drawer
      v-model="showMobileDrawer"
      direction="rtl"
      size="82%"
      class="mobile-menu-drawer"
      :with-header="false"
    >
      <div class="mobile-drawer-content">
        <div class="drawer-header">
          <div class="aside-brand">
            <el-icon size="20"><Grid /></el-icon>
            <span class="brand-name">AppServer</span>
          </div>
          <el-icon class="close-icon" @click="showMobileDrawer = false"><Close /></el-icon>
        </div>

        <div class="mobile-quick-actions">
          <el-button @click="toggleDark">
            <el-icon><component :is="iconRef" /></el-icon>
            <span>{{ i18ns.t('SettingsView.themeLabel') }}</span>
          </el-button>
          <LanguageSwitcher />
        </div>

        <el-menu ref="mobileMenuRef" class="mobile-aside-nav" @select="showMobileDrawer = false">
          <NavMenuItems
            :show-spacer="false"
            :show-logout="true"
            :show-pinned-section="pinnedItems.length > 0"
            :on-route-navigate="handleRouteNavigation"
          >
            <template #pinned>
              <li class="pinned-menu-section">
                <div class="pinned-menu-section__header">
                  <span class="pinned-menu-section__title">{{ i18ns.t('nav.pinnedPages') }}</span>
                </div>
                <div ref="mobilePinnedListRef" class="pinned-menu-list">
                  <div
                    v-for="item in pinnedItems"
                    :key="item.key"
                    :data-route-name="item.route"
                    class="pinned-menu-link"
                    :class="{
                      'is-active': item.route
                        ? router.currentRoute.value.name === item.route
                        : false,
                    }"
                  >
                    <button
                      type="button"
                      class="pinned-menu-link__drag"
                      :aria-label="i18ns.t('nav.dragPinnedPage')"
                      @click.stop
                    >
                      <el-icon><Rank /></el-icon>
                    </button>
                    <button
                      type="button"
                      class="pinned-menu-link__main"
                      @click="handlePinnedMobileItem(item)"
                    >
                      <span class="pinned-menu-link__content">
                        <el-icon><component :is="item.icon" /></el-icon>
                        <span>{{ item.label }}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      class="pinned-menu-link__remove"
                      :aria-label="i18ns.t('nav.unpinPage')"
                      @click.stop="item.route && confirmTogglePinnedRoute(item.route)"
                    >
                      <el-icon><Close /></el-icon>
                    </button>
                  </div>
                </div>
              </li>
            </template>
          </NavMenuItems>
        </el-menu>
      </div>
    </el-drawer>
  </div>
</template>

<script lang="ts" setup>
import {
  Expand,
  Fold,
  Grid,
  Operation,
  HomeFilled,
  ChatDotRound,
  Setting,
  Close,
  MoreFilled,
  Sunny,
  Moon,
  Search,
  Rank,
  Star,
  StarFilled,
  DataAnalysis,
  TrendCharts,
  Document,
  Notebook,
  User,
  UserFilled,
  Collection,
  Tools,
  Monitor,
  Key,
  CreditCard,
  Connection,
  Postcard,
  Wallet,
  Histogram,
  FolderOpened,
  Box,
  Cpu,
  Bell,
  Link,
} from '@element-plus/icons-vue'
import Sortable from 'sortablejs'
import { ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
  type Component,
} from 'vue'
import router from '@/router'
import { useIsDesktopStore } from '@/stores/isDesktopStore'
import { authorizationService } from '@/service/authorizationService'
import LogoutIcon from '@/components/icons/LogoutIcon.vue'
import NavMenuItems from '@/layouts/NavMenuItems.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import { useThemeToggleStore } from '@/stores/themeToggleStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { Permission } from '@/constant/permission'
import type { RouteName } from '@/types/route-types.gen'
import { normalizeDocsLocale, resolveDocsUrl } from '@/config/docs'

const isDesktopStore = useIsDesktopStore()
const isDesktop = isDesktopStore.useIsDesktop()

const themeToggleStore = useThemeToggleStore()
const isDark = themeToggleStore.useIsDark()
const toggleDark = () => themeToggleStore.toggleTheme()
const iconRef = computed(() => (isDark.value ? Sunny : Moon))
const permissionStore = usePermissionStore()

const isCollapse = ref(false)
const showOverview = ref(false)
const showIsDesktopIcon = computed(() => (!isDesktop.value ? true : isCollapse.value))
const menuRef = useTemplateRef('menuRef')
const mobileMenuRef = useTemplateRef('mobileMenuRef')
const routeContextMenuRef = useTemplateRef('routeContextMenuRef')
const desktopPinnedListRef = useTemplateRef<HTMLDivElement>('desktopPinnedListRef')
const mobilePinnedListRef = useTemplateRef<HTMLDivElement>('mobilePinnedListRef')
const overviewPinnedListRef = useTemplateRef<HTMLDivElement>('overviewPinnedListRef')
const showMobileDrawer = ref(false)
const categoryKeyword = ref('')
const featureKeyword = ref('')
const pinnedRouteNames = ref<RouteName[]>([])
const hasRestoredPinnedRoutes = ref(false)
const overviewDrawerSize = 'min(80vw, calc(100vw - 72px))'
const routeContextMenu = ref<{
  visible: boolean
  x: number
  y: number
  routeName: RouteName | null
}>({
  visible: false,
  x: 0,
  y: 0,
  routeName: null,
})

const PINNED_ROUTE_STORAGE_KEY = 'appserver.sidebar.pinnedRoutes'
const PINNED_ROUTE_SELECTOR = '[data-route-name]'

let desktopPinnedSortable: Sortable | null = null
let mobilePinnedSortable: Sortable | null = null
let overviewPinnedSortable: Sortable | null = null

type OverviewItem = {
  key: string
  label: string
  icon: Component
  route?: RouteName
  action?: () => void
  visible: boolean
}

type OverviewSection = {
  key: string
  title: string
  icon: Component
  items: OverviewItem[]
}

const can = (permission: Permission) => permissionStore.hasPermission(permission)
const canAny = (...permissions: Permission[]) => permissionStore.hasAnyPermission(...permissions)

const toggleCollapse = () => {
  showOverview.value = false
  isCollapse.value = !isCollapse.value
}

const toggleOverview = () => {
  showOverview.value = !showOverview.value
  if (showOverview.value) {
    isCollapse.value = false
  }
}

const closeRouteContextMenu = () => {
  routeContextMenu.value.visible = false
  routeContextMenu.value.routeName = null
}

const openRouteInNewTab = (routeName: RouteName) => {
  const resolvedRoute = router.resolve({ name: routeName } as any)
  window.open(resolvedRoute.href, '_blank', 'noopener,noreferrer')
}

const handleRouteNavigation = (routeName: RouteName, event?: MouseEvent) => {
  if (event && (event.ctrlKey || event.metaKey || event.button === 1)) {
    openRouteInNewTab(routeName)
    closeRouteContextMenu()
    return
  }

  closeRouteContextMenu()
  router.push({ name: routeName } as any)
}

const openRouteContextMenu = (routeName: RouteName, event: MouseEvent) => {
  if (!isDesktop.value) {
    return
  }

  const menuWidth = 220
  const menuHeight = 132
  const viewportPadding = 12

  routeContextMenu.value = {
    visible: true,
    routeName,
    x: Math.min(event.clientX, window.innerWidth - menuWidth - viewportPadding),
    y: Math.min(event.clientY, window.innerHeight - menuHeight - viewportPadding),
  }
}

const handleOverviewItem = (item: OverviewItem) => {
  if (item.action) {
    item.action()
    return
  }

  if (item.route) {
    router.push({ name: item.route } as any)
  }
}

const handlePinnedMobileItem = (item: OverviewItem) => {
  handleOverviewItem(item)
  showMobileDrawer.value = false
}

const normalizeKeyword = (value: string) => value.trim().toLocaleLowerCase()

const openDocs = () => {
  const routeName =
    typeof router.currentRoute.value.name === 'string' ? router.currentRoute.value.name : null
  window.open(
    resolveDocsUrl(routeName, normalizeDocsLocale(i18ns.refer.value)),
    '_blank',
    'noopener,noreferrer',
  )
}

const overviewSections = computed<OverviewSection[]>(() => {
  const sections: OverviewSection[] = [
    {
      key: 'quickAccess',
      title: i18ns.t('nav.quickAccess'),
      icon: HomeFilled,
      items: [
        { key: 'home', label: i18ns.t('nav.home'), icon: HomeFilled, route: 'home', visible: true },
        { key: 'docs', label: i18ns.t('nav.docs'), icon: Link, action: openDocs, visible: true },
        {
          key: 'debug',
          label: i18ns.t('nav.debug'),
          icon: Operation,
          route: 'debug',
          visible: can(Permission.DEBUG_ACCESS),
        },
      ],
    },
    {
      key: 'myAccount',
      title: i18ns.t('nav.myAccount'),
      icon: Wallet,
      items: [
        {
          key: 'settings',
          label: i18ns.t('nav.settings'),
          icon: Setting,
          route: 'settings',
          visible: true,
        },
        {
          key: 'notificationSettings',
          label: i18ns.t('nav.notificationSettings'),
          icon: Bell,
          route: 'notificationSettings',
          visible: true,
        },
        {
          key: 'balanceHistory',
          label: i18ns.t('relay.accountBalance'),
          icon: Wallet,
          route: 'balanceHistory',
          visible: can(Permission.RELAY_TOKEN_READ),
        },
        {
          key: 'myFeedback',
          label: i18ns.t('nav.myFeedback'),
          icon: ChatDotRound,
          route: 'myFeedback',
          visible: canAny(
            Permission.FEEDBACK_SUBMIT,
            Permission.FEEDBACK_SELF_READ,
            Permission.FEEDBACK_SELF_UPDATE,
            Permission.FEEDBACK_COMMENT,
          ),
        },
      ],
    },
    {
      key: 'productSubscriptions',
      title: i18ns.t('nav.productSubscriptions'),
      icon: Box,
      items: [
        {
          key: 'myMonthlyPasses',
          label: i18ns.t('nav.myMonthlyPasses'),
          icon: CreditCard,
          route: 'myMonthlyPasses',
          visible: can(Permission.RELAY_TOKEN_READ),
        },
        {
          key: 'myRemoteTerminalProducts',
          label: i18ns.t('nav.myRemoteTerminalProducts'),
          icon: Monitor,
          route: 'myRemoteTerminalProducts',
          visible: true,
        },
      ],
    },
    {
      key: 'myTools',
      title: i18ns.t('nav.myTools'),
      icon: Connection,
      items: [
        {
          key: 'chat',
          label: i18ns.t('nav.chat'),
          icon: ChatDotRound,
          route: 'chat',
          visible: can(Permission.RELAY_TOKEN_READ),
        },
        {
          key: 'scriptManager',
          label: i18ns.t('nav.scriptManager'),
          icon: Cpu,
          route: 'scriptManager',
          visible: can(Permission.SCRIPT_READ),
        },
      ],
    },
    {
      key: 'developerCenter',
      title: i18ns.t('nav.developerCenter'),
      icon: Key,
      items: [
        {
          key: 'relayTokenManagement',
          label: i18ns.t('nav.myTokens'),
          icon: Key,
          route: 'relayTokenManagement',
          visible: can(Permission.RELAY_TOKEN_READ),
        },
        {
          key: 'apiDocumentation',
          label: i18ns.t('nav.apiDocumentation'),
          icon: Document,
          route: 'apiDocumentation',
          visible: can(Permission.RELAY_TOKEN_READ),
        },
        {
          key: 'oauthClientManagement',
          label: i18ns.t('nav.oauthClientManagement'),
          icon: Link,
          route: 'oauthClientManagement',
          visible: can(Permission.OAUTH_CLIENT_READ),
        },
        {
          key: 'authCenterClientManagement',
          label: i18ns.t('nav.authCenterClientManagement'),
          icon: Key,
          route: 'authCenterClientManagement',
          visible: can(Permission.AUTH_CENTER_CLIENT_READ),
        },
      ],
    },
    {
      key: 'openPlatform',
      title: i18ns.t('nav.openPlatform'),
      icon: Link,
      items: [
        {
          key: 'oauthClientReviewManagement',
          label: i18ns.t('nav.oauthClientReviewManagement'),
          icon: Document,
          route: 'oauthClientReviewManagement',
          visible: can(Permission.OAUTH_CLIENT_REVIEW_READ),
        },
        {
          key: 'authCenterClientReviewManagement',
          label: i18ns.t('nav.authCenterClientReviewManagement'),
          icon: Document,
          route: 'authCenterClientReviewManagement',
          visible: can(Permission.AUTH_CENTER_CLIENT_REVIEW_READ),
        },
        {
          key: 'feedbackReviewManagement',
          label: i18ns.t('nav.feedbackReviewManagement'),
          icon: ChatDotRound,
          route: 'feedbackReviewManagement',
          visible: can(Permission.FEEDBACK_REVIEW_READ),
        },
      ],
    },
    {
      key: 'financial',
      title: i18ns.t('nav.financial'),
      icon: Wallet,
      items: [
        {
          key: 'balanceManagement',
          label: i18ns.t('nav.balanceManagement'),
          icon: CreditCard,
          route: 'balanceManagement',
          visible: can(Permission.BALANCE_READ),
        },
        {
          key: 'monthlyPassManagement',
          label: i18ns.t('nav.monthlyPassManagement'),
          icon: CreditCard,
          route: 'monthlyPassManagement',
          visible: canAny(
            Permission.MONTHLY_PASS_TEMPLATE_READ,
            Permission.MONTHLY_PASS_ASSIGNMENT_READ,
            Permission.MONTHLY_PASS_USAGE_READ,
          ),
        },
        {
          key: 'redemptionCodes',
          label: i18ns.t('nav.redemptionCodes'),
          icon: Postcard,
          route: 'redemptionCodes',
          visible: can(Permission.REDEMPTION_CODE_READ),
        },
      ],
    },
    {
      key: 'apiRelay',
      title: i18ns.t('nav.relay'),
      icon: Connection,
      items: [
        {
          key: 'relaySettings',
          label: i18ns.t('nav.relaySettings'),
          icon: Tools,
          route: 'relaySettings',
          visible: can(Permission.MODEL_PRICING_UPDATE),
        },
        {
          key: 'upstreamStatus',
          label: i18ns.t('nav.upstreamStatus'),
          icon: Connection,
          route: 'upstreamStatus',
          visible: can(Permission.UPSTREAM_STATUS_READ),
        },
      ],
    },
    {
      key: 'remoteTerminalProducts',
      title: i18ns.t('nav.remoteTerminal'),
      icon: Monitor,
      items: [
        {
          key: 'remoteTerminal',
          label: i18ns.t('nav.remoteTerminal'),
          icon: Monitor,
          route: 'remoteTerminal',
          visible: canAny(
            Permission.REMOTE_TERMINAL_DEVICE_READ,
            Permission.REMOTE_TERMINAL_SESSION_READ,
            Permission.REMOTE_TERMINAL_SESSION_CREATE,
          ),
        },
        {
          key: 'remoteTerminalProductManagement',
          label: i18ns.t('nav.remoteTerminalProductManagement'),
          icon: Setting,
          route: 'remoteTerminalProductManagement',
          visible: canAny(
            Permission.REMOTE_TERMINAL_PRODUCT_READ,
            Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
            Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_READ,
            Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ,
          ),
        },
      ],
    },
    {
      key: 'ojSubmitter',
      title: i18ns.t('nav.ojSubmitter'),
      icon: Cpu,
      items: [
        {
          key: 'ojAPIKeyManagement',
          label: i18ns.t('nav.ojAPIKeyManagement'),
          icon: Key,
          route: 'ojAPIKeyManagement',
          visible: can(Permission.OJ_APIKEY_READ),
        },
        {
          key: 'ojUsageStatistics',
          label: i18ns.t('nav.ojUsageStatistics'),
          icon: Histogram,
          route: 'ojUsageStatistics',
          visible: can(Permission.OJ_USAGE_READ),
        },
        {
          key: 'ojPricingManagement',
          label: i18ns.t('nav.ojPricingManagement'),
          icon: TrendCharts,
          route: 'ojPricingManagement',
          visible: can(Permission.OJ_PRICING_READ),
        },
      ],
    },
    {
      key: 'dataServices',
      title: i18ns.t('nav.dataServices'),
      icon: FolderOpened,
      items: [
        {
          key: 'jsonEndpointManagement',
          label: i18ns.t('nav.jsonEndpoints'),
          icon: Document,
          route: 'jsonEndpointManagement',
          visible: can(Permission.JSON_ENDPOINT_READ),
        },
        {
          key: 'articleManagement',
          label: i18ns.t('nav.articleManagement'),
          icon: Notebook,
          route: 'articleManagement',
          visible: can(Permission.ARTICLE_READ),
        },
        {
          key: 'legalPolicyManagement',
          label: i18ns.t('nav.legalPolicyManagement'),
          icon: Document,
          route: 'legalPolicyManagement',
          visible: can(Permission.LEGAL_POLICY_READ),
        },
      ],
    },
    {
      key: 'userManagement',
      title: i18ns.t('nav.userManagement'),
      icon: UserFilled,
      items: [
        {
          key: 'userManagement',
          label: i18ns.t('nav.users'),
          icon: User,
          route: 'userManagement',
          visible: can(Permission.USER_READ),
        },
        {
          key: 'groupManagement',
          label: i18ns.t('nav.groups'),
          icon: Collection,
          route: 'groupManagement',
          visible: can(Permission.GROUP_READ),
        },
        {
          key: 'permission',
          label: i18ns.t('nav.permissions'),
          icon: Operation,
          route: 'permission',
          visible: can(Permission.PERMISSION_VIEW),
        },
        {
          key: 'ramManagement',
          label: i18ns.t('nav.ramManagement'),
          icon: Key,
          route: 'ramManagement',
          visible: canAny(
            Permission.RAM_USER_READ,
            Permission.RAM_ROLE_READ,
            Permission.RAM_BINDING_READ,
            Permission.RAM_SESSION_READ,
          ),
        },
      ],
    },
    {
      key: 'systemConfigSecurity',
      title: i18ns.t('nav.systemConfigSecurity'),
      icon: Tools,
      items: [
        {
          key: 'serverConfig',
          label: i18ns.t('nav.serverConfig'),
          icon: Tools,
          route: 'serverConfig',
          visible: can(Permission.SYSTEM_CONFIG),
        },
        {
          key: 'ipMonitoring',
          label: i18ns.t('nav.ipMonitoring'),
          icon: DataAnalysis,
          route: 'ipMonitoring',
          visible: can(Permission.IP_BLACKLIST_READ),
        },
      ],
    },
    {
      key: 'systemMonitoring',
      title: i18ns.t('nav.systemMonitoring'),
      icon: TrendCharts,
      items: [
        {
          key: 'systemStats',
          label: i18ns.t('nav.systemStats'),
          icon: TrendCharts,
          route: 'systemStats',
          visible: can(Permission.SYSTEM_STATS_READ),
        },
        {
          key: 'systemConsumptionStats',
          label: i18ns.t('nav.systemConsumptionStats'),
          icon: Histogram,
          route: 'systemConsumptionStats',
          visible: can(Permission.SYSTEM_CONSUMPTION_STATS_READ),
        },
      ],
    },
    {
      key: 'systemAudit',
      title: i18ns.t('nav.systemAudit'),
      icon: Monitor,
      items: [
        {
          key: 'systemLogs',
          label: i18ns.t('nav.systemLogs'),
          icon: Document,
          route: 'systemLogs',
          visible: canAny(
            Permission.SYSTEM_LOG_READ,
            Permission.API_LOG_READ,
            Permission.SYSTEM_SERVER_LOG_READ,
          ),
        },
        {
          key: 'businessLogs',
          label: i18ns.t('nav.businessLogs'),
          icon: Notebook,
          route: 'businessLogs',
          visible: can(Permission.SYSTEM_BUSINESS_LOG_READ),
        },
        {
          key: 'userOnlineMonitor',
          label: i18ns.t('nav.userOnlineMonitor'),
          icon: Monitor,
          route: 'userOnlineMonitor',
          visible: can(Permission.USER_ONLINE_MONITOR_READ),
        },
      ],
    },
  ]

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.visible),
    }))
    .filter((section) => section.items.length > 0)
})

const filteredOverviewSections = computed<OverviewSection[]>(() => {
  const normalizedCategoryKeyword = normalizeKeyword(categoryKeyword.value)
  const normalizedFeatureKeyword = normalizeKeyword(featureKeyword.value)

  return overviewSections.value
    .map((section) => {
      const matchesCategory =
        normalizedCategoryKeyword.length === 0 ||
        section.title.toLocaleLowerCase().includes(normalizedCategoryKeyword)

      const items = matchesCategory
        ? section.items.filter(
            (item) =>
              normalizedFeatureKeyword.length === 0 ||
              item.label.toLocaleLowerCase().includes(normalizedFeatureKeyword),
          )
        : []

      return {
        ...section,
        items,
      }
    })
    .filter((section) => section.items.length > 0)
})

const pinnableItemsByRoute = computed(() => {
  const routeMap = new Map<RouteName, OverviewItem>()

  for (const section of overviewSections.value) {
    for (const item of section.items) {
      if (item.route) {
        routeMap.set(item.route, item)
      }
    }
  }

  return routeMap
})

const pinnedItems = computed(() =>
  pinnedRouteNames.value
    .map((routeName) => pinnableItemsByRoute.value.get(routeName))
    .filter((item): item is OverviewItem => Boolean(item)),
)

const routeContextMenuItem = computed(() => {
  const routeName = routeContextMenu.value.routeName
  if (!routeName) {
    return null
  }

  return pinnableItemsByRoute.value.get(routeName) ?? null
})

const routeContextMenuPinned = computed(() => {
  const routeName = routeContextMenu.value.routeName
  return routeName ? isPinned(routeName) : false
})

const routeContextMenuStyle = computed(() => ({
  left: `${routeContextMenu.value.x}px`,
  top: `${routeContextMenu.value.y}px`,
}))

const isPinned = (routeName: RouteName) => pinnedRouteNames.value.includes(routeName)

const normalizePinnedRouteNames = (values: unknown[]): RouteName[] => {
  return values.filter(
    (value, index, source): value is RouteName =>
      typeof value === 'string' && source.indexOf(value) === index,
  )
}

const togglePinnedRoute = (routeName: RouteName) => {
  if (isPinned(routeName)) {
    pinnedRouteNames.value = pinnedRouteNames.value.filter((name) => name !== routeName)
    return
  }

  pinnedRouteNames.value = [...pinnedRouteNames.value, routeName]
}

const confirmTogglePinnedRoute = async (routeName: RouteName) => {
  if (!isPinned(routeName)) {
    togglePinnedRoute(routeName)
    return
  }

  try {
    await ElMessageBox.confirm(i18ns.t('nav.unpinPageConfirm'), i18ns.t('warning'), {
      type: 'warning',
      confirmButtonText: i18ns.t('confirm'),
      cancelButtonText: i18ns.t('cancel'),
    })
  } catch {
    return
  }

  togglePinnedRoute(routeName)
}

const reorderPinnedRoutes = (routeNames: RouteName[]) => {
  const normalizedRouteNames = routeNames.filter(
    (routeName, index, source) =>
      pinnableItemsByRoute.value.has(routeName) && source.indexOf(routeName) === index,
  )

  if (
    normalizedRouteNames.length === pinnedRouteNames.value.length &&
    normalizedRouteNames.every((routeName, index) => pinnedRouteNames.value[index] === routeName)
  ) {
    return
  }

  pinnedRouteNames.value = normalizedRouteNames
}

const readPinnedRouteOrderFromElement = (element: HTMLElement): RouteName[] => {
  return Array.from(element.querySelectorAll<HTMLElement>(PINNED_ROUTE_SELECTOR))
    .map((item) => item.dataset.routeName)
    .filter((routeName): routeName is RouteName => {
      return typeof routeName === 'string' && pinnableItemsByRoute.value.has(routeName as RouteName)
    })
}

const destroyPinnedSortable = (instance: Sortable | null) => {
  instance?.destroy()
}

const createPinnedSortable = (element: HTMLElement | null | undefined) => {
  if (!element || pinnedItems.value.length < 2) {
    return null
  }

  return Sortable.create(element, {
    animation: 180,
    draggable: PINNED_ROUTE_SELECTOR,
    handle: '.pinned-menu-link__drag, .overview-chip__drag',
    ghostClass: 'is-drag-ghost',
    chosenClass: 'is-drag-chosen',
    dragClass: 'is-drag-active',
    delayOnTouchOnly: true,
    delay: 150,
    fallbackTolerance: 6,
    onEnd: () => {
      reorderPinnedRoutes(readPinnedRouteOrderFromElement(element))
    },
  })
}

const refreshPinnedSortables = async () => {
  await nextTick()

  destroyPinnedSortable(desktopPinnedSortable)
  destroyPinnedSortable(mobilePinnedSortable)
  destroyPinnedSortable(overviewPinnedSortable)

  desktopPinnedSortable =
    isDesktop.value && !showIsDesktopIcon.value
      ? createPinnedSortable(desktopPinnedListRef.value)
      : null

  mobilePinnedSortable =
    !isDesktop.value && showMobileDrawer.value
      ? createPinnedSortable(mobilePinnedListRef.value)
      : null

  overviewPinnedSortable =
    isDesktop.value && showOverview.value ? createPinnedSortable(overviewPinnedListRef.value) : null
}

const openRouteInNewTabFromMenu = () => {
  const routeName = routeContextMenu.value.routeName
  if (!routeName) {
    return
  }

  openRouteInNewTab(routeName)
  closeRouteContextMenu()
}

const togglePinnedRouteFromMenu = () => {
  const routeName = routeContextMenu.value.routeName
  if (!routeName) {
    return
  }

  closeRouteContextMenu()
  void confirmTogglePinnedRoute(routeName)
}

const syncPinnedRoutes = () => {
  if (!permissionStore.isLoaded) {
    return
  }

  pinnedRouteNames.value = pinnedRouteNames.value.filter((routeName, index, source) => {
    return pinnableItemsByRoute.value.has(routeName) && source.indexOf(routeName) === index
  })
}

const loadPinnedRoutes = () => {
  try {
    const rawValue = window.localStorage.getItem(PINNED_ROUTE_STORAGE_KEY)
    if (!rawValue) {
      return
    }

    const parsedValue = JSON.parse(rawValue)
    if (!Array.isArray(parsedValue)) {
      return
    }

    pinnedRouteNames.value = normalizePinnedRouteNames(parsedValue)
  } catch {
    pinnedRouteNames.value = []
  }
}

const handleGlobalClick = (event: MouseEvent) => {
  if (routeContextMenuRef.value?.contains(event.target as Node)) {
    return
  }

  closeRouteContextMenu()
}

const handleGlobalContextMenu = (event: MouseEvent) => {
  if (routeContextMenuRef.value?.contains(event.target as Node)) {
    return
  }

  closeRouteContextMenu()
}

onMounted(async () => {
  document.addEventListener('click', handleGlobalClick, true)
  document.addEventListener('contextmenu', handleGlobalContextMenu, true)
  window.addEventListener('resize', closeRouteContextMenu)
  window.addEventListener('blur', closeRouteContextMenu)

  loadPinnedRoutes()

  try {
    await permissionStore.untilReady()
    syncPinnedRoutes()
  } catch (error) {
    console.warn('Pinned routes restore skipped permission sync:', error)
  } finally {
    hasRestoredPinnedRoutes.value = true
  }

  const name = router.currentRoute.value.name
  menuRef.value?.updateActiveIndex(name)
  mobileMenuRef.value?.updateActiveIndex(name)
  await refreshPinnedSortables()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleGlobalClick, true)
  document.removeEventListener('contextmenu', handleGlobalContextMenu, true)
  window.removeEventListener('resize', closeRouteContextMenu)
  window.removeEventListener('blur', closeRouteContextMenu)
  destroyPinnedSortable(desktopPinnedSortable)
  destroyPinnedSortable(mobilePinnedSortable)
  destroyPinnedSortable(overviewPinnedSortable)
})

watch(pinnableItemsByRoute, () => {
  if (!hasRestoredPinnedRoutes.value) {
    return
  }

  syncPinnedRoutes()
})

watch(
  [
    () => pinnedItems.value.map((item) => item.route ?? item.key).join('|'),
    () => isDesktop.value,
    () => showIsDesktopIcon.value,
    () => showOverview.value,
    () => showMobileDrawer.value,
  ],
  () => {
    void refreshPinnedSortables()
  },
  { flush: 'post' },
)

watch(
  pinnedRouteNames,
  (value) => {
    if (!hasRestoredPinnedRoutes.value) {
      return
    }

    window.localStorage.setItem(PINNED_ROUTE_STORAGE_KEY, JSON.stringify(value))
  },
  { deep: true },
)

watch(
  () => router.currentRoute.value.name,
  (name) => {
    closeRouteContextMenu()
    menuRef.value?.updateActiveIndex(name)
    mobileMenuRef.value?.updateActiveIndex(name)
  },
)
</script>

<style lang="scss">
.aside-menu {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--el-menu-bg-color);
  border-right: 1px solid var(--el-border-color-lighter);
  overflow: hidden;
  width: 220px;
  transition: width 0.25s ease;

  &.is-collapsed {
    width: 64px;

    .aside-brand .brand-name {
      opacity: 0;
      max-width: 0;
    }
    .toggle-icon {
      opacity: 0.5;
    }
  }
}

.aside-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 56px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
  user-select: none;
  transition: background-color 0.2s;

  .aside-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--el-text-color-primary);
    font-weight: 600;
    font-size: 14px;
    overflow: hidden;

    .el-icon {
      flex-shrink: 0;
      color: var(--el-color-primary);
    }

    .brand-name {
      white-space: nowrap;
      max-width: 160px;
      overflow: hidden;
      transition:
        opacity 0.2s ease,
        max-width 0.25s ease;
    }
  }

  .toggle-icon {
    flex-shrink: 0;
    color: var(--el-text-color-secondary);
    transition: opacity 0.2s;
  }
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-icon-button {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;

  &:hover {
    background: var(--el-fill-color-light);
    color: var(--el-text-color-primary);
  }

  &.is-active {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }
}

.overview-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.overview-drawer :deep(.el-drawer__body) {
  padding: 0;
}

.overview-drawer :deep(.el-drawer) {
  max-width: calc(100vw - 24px);
}

.overview-banner {
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background:
    linear-gradient(135deg, var(--el-color-primary-light-9), transparent),
    var(--el-fill-color-blank);
}

.overview-banner--drawer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.overview-close-button {
  flex-shrink: 0;
}

.overview-banner__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.overview-banner__description {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.overview-sections {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.overview-toolbar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.overview-search :deep(.el-input__wrapper) {
  border-radius: 12px;
}

.overview-pinned-strip {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  background: var(--el-fill-color-blank);
  padding: 12px;
}

.overview-pinned-strip__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.overview-pinned-strip__hint {
  margin-bottom: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.overview-pinned-strip__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.overview-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 999px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  padding: 6px;
  transition:
    color 0.2s ease,
    border-color 0.2s ease,
    background-color 0.2s ease;

  &:hover,
  &.is-active {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-5);
    background: var(--el-color-primary-light-9);
  }
}

.overview-chip__drag,
.overview-chip__remove,
.overview-chip__main {
  border: none;
  background: transparent;
  color: inherit;
  display: inline-flex;
  align-items: center;
}

.overview-chip__drag,
.overview-chip__remove {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    opacity 0.2s ease;

  &:hover {
    background: rgba(0, 0, 0, 0.08);
  }
}

.overview-chip__drag {
  cursor: grab;
  color: var(--el-text-color-secondary);
}

.overview-chip__main {
  gap: 8px;
  min-width: 0;
  padding: 2px 6px;
  cursor: pointer;

  span {
    white-space: nowrap;
  }
}

.overview-chip__remove {
  color: inherit;
  opacity: 0.72;
}

.overview-table-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
  align-items: start;
}

.overview-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  background: var(--el-bg-color);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  min-height: 100%;
}

.overview-card__header {
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}

.overview-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.overview-card__body {
  padding: 12px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}

.overview-link {
  min-height: 44px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 6px 6px 12px;
  text-align: left;
  color: var(--el-text-color-regular);
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease;

  span {
    min-width: 0;
    font-size: 12px;
    line-height: 1.35;
  }

  &:hover {
    border-color: var(--el-color-primary-light-5);
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }

  &.is-active {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }
}

.overview-link__main {
  border: none;
  background: transparent;
  color: inherit;
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 4px 0;
  cursor: pointer;
}

.overview-link__content {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.overview-pin-button {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--el-text-color-placeholder);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;

  &:hover,
  &.is-pinned {
    color: var(--el-color-warning);
    background: rgba(230, 162, 60, 0.12);
  }
}

.pinned-menu-section {
  list-style: none;
  padding: 0;
}

.pinned-menu-section__header {
  padding: 8px 20px;
}

.pinned-menu-section__title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--el-text-color-secondary);
}

.pinned-menu-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.pinned-menu-link {
  min-height: 56px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  padding: 0 12px 0 20px;
  color: var(--el-text-color-regular);
  transition:
    background-color 0.2s ease,
    color 0.2s ease;

  &:hover {
    background: var(--el-fill-color-light);
  }

  &.is-active {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-weight: 500;
    border-right: 3px solid var(--el-color-primary);
    padding-right: 9px;
  }
}

.pinned-menu-link__drag {
  width: 24px;
  height: 24px;
  margin-right: 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: grab;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;

  &:hover {
    background: rgba(0, 0, 0, 0.06);
    color: var(--el-text-color-primary);
  }
}

.pinned-menu-link__main {
  border: none;
  background: transparent;
  color: inherit;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 0;
  cursor: pointer;
}

.pinned-menu-link__content {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.pinned-menu-link__remove {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
  cursor: pointer;
  transition:
    opacity 0.2s ease,
    background-color 0.2s ease;

  &:hover {
    opacity: 1;
    background: rgba(0, 0, 0, 0.06);
  }
}

.is-drag-ghost {
  opacity: 0.45;
}

.is-drag-chosen {
  box-shadow: 0 0 0 1px var(--el-color-primary-light-5);
}

.is-drag-active {
  cursor: grabbing;
}

.route-context-menu {
  position: fixed;
  z-index: 2400;
  min-width: 220px;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-bg-color-overlay);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.route-context-menu__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.route-context-menu__item {
  width: 100%;
  min-height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-regular);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;

  &:hover {
    background: var(--el-fill-color-light);
    color: var(--el-text-color-primary);
  }
}

.aside-nav {
  flex: 1;
  border-right: none !important;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  transition:
    width 0.25s ease,
    min-width 0.25s ease;
  will-change: width;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--el-border-color);
    border-radius: 4px;
    &:hover {
      background: var(--el-border-color-darker);
    }
  }

  &:not(.el-menu--collapse) {
    width: 220px;
    min-width: 220px;
  }

  > .el-menu-item > span,
  > .el-sub-menu > .el-sub-menu__title > span {
    display: inline-block !important;
    max-width: 160px;
    overflow: hidden !important;
    white-space: nowrap;
    opacity: 1;
    height: auto !important;
    visibility: visible !important;
    width: auto !important;
    transition:
      opacity 0.2s ease,
      max-width 0.25s ease;
  }

  > .el-sub-menu > .el-sub-menu__title .el-sub-menu__icon-arrow {
    transition: opacity 0.2s ease;
    opacity: 1;
  }

  &.el-menu--collapse {
    > .el-menu-item > span,
    > .el-sub-menu > .el-sub-menu__title > span {
      max-width: 0 !important;
      opacity: 0 !important;
      width: auto !important;
      height: auto !important;
      visibility: visible !important;
    }
    > .el-sub-menu > .el-sub-menu__title .el-sub-menu__icon-arrow {
      display: inline-flex !important;
      opacity: 0 !important;
    }
  }

  .el-menu-item.is-active {
    background-color: var(--el-color-primary-light-9) !important;
    color: var(--el-color-primary) !important;
    font-weight: 500;
    border-right: 3px solid var(--el-color-primary);
    .el-icon {
      color: var(--el-color-primary);
    }
  }

  .el-menu-item:not(.is-active):hover {
    background-color: var(--el-fill-color-light) !important;
  }

  .el-sub-menu.is-active > .el-sub-menu__title {
    color: var(--el-color-primary) !important;
  }
}

.mobile-tab-bar {
  display: flex;
  justify-content: space-around;
  align-items: center;
  width: 100%;
  height: 60px;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--el-bg-color);
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  height: 60px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  transition: color 0.2s;
  overflow: hidden;

  .el-icon {
    font-size: 22px;
    margin-bottom: 2px;
    flex-shrink: 0;
  }

  span {
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    padding: 0 4px;
    box-sizing: border-box;
  }

  &.active {
    color: var(--el-color-primary);
  }
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--el-border-color-lighter);

  .aside-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 16px;
    color: var(--el-text-color-primary);
    .el-icon {
      color: var(--el-color-primary);
    }
  }

  .close-icon {
    font-size: 20px;
    color: var(--el-text-color-secondary);
    cursor: pointer;
  }
}

.mobile-drawer-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.mobile-menu-drawer :deep(.el-drawer__body) {
  padding: 0;
}

.mobile-aside-nav {
  border-right: none;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
}

.mobile-quick-actions {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.mobile-quick-actions .el-button,
.mobile-quick-actions :deep(.el-dropdown) {
  flex: 1;
}

.mobile-quick-actions :deep(.el-dropdown .el-button) {
  width: 100%;
}

@media screen and (max-width: 768px) {
  .aside-menu {
    border-right: none;
    width: 100% !important;
    min-width: 100% !important;
  }
  .aside-nav {
    display: none !important;
  }

  .overview-panel {
    display: none !important;
  }

  .overview-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
