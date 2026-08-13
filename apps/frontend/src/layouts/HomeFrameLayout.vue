<template>
  <div
    class="common-layout"
    :class="{
      'is-account-profile': isAccountProfile,
      'is-embedded': isEmbeddedShell,
    }"
  >
    <ImpersonationBanner />
    <el-container
      direction="vertical"
      class="app-container"
      :class="{ 'with-banner': impersonationStore.isImpersonating }"
    >
      <el-header v-if="showSiteHeader" class="site-header">
        <button type="button" class="site-header__drawer-trigger" @click="openSiteDrawer">
          <el-icon><Grid /></el-icon>
          <span>{{ i18ns.t('nav.switchSite') }}</span>
        </button>
        <div class="site-header__actions">
          <div class="site-header__nav-links">
            <button type="button" class="site-header__text-button" @click="openDocs">
              {{ i18ns.t('nav.docs') }}
            </button>
            <button
              type="button"
              class="site-header__text-button"
              @click="navigateToRoute('balanceHistory')"
            >
              {{ i18ns.t('nav.costAndBilling') }}
            </button>
            <button
              type="button"
              class="site-header__text-button"
              @click="navigateToRoute('myTickets')"
            >
              {{ i18ns.t('nav.myTickets') }}
            </button>
            <button
              type="button"
              class="site-header__text-button"
              @click="navigateToRoute('notificationSettings')"
            >
              {{ i18ns.t('nav.siteMessages') }}
            </button>
          </div>
          <el-dropdown
            class="site-header__nav-dropdown"
            trigger="click"
            placement="bottom-end"
            popper-class="site-header__nav-dropdown-popper"
          >
            <button
              type="button"
              class="site-header__icon-button"
              :aria-label="i18ns.t('nav.more')"
            >
              <el-icon><MoreFilled /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="openDocs">
                  {{ i18ns.t('nav.docs') }}
                </el-dropdown-item>
                <el-dropdown-item @click="navigateToRoute('balanceHistory')">
                  {{ i18ns.t('nav.costAndBilling') }}
                </el-dropdown-item>
                <el-dropdown-item @click="navigateToRoute('myTickets')">
                  {{ i18ns.t('nav.myTickets') }}
                </el-dropdown-item>
                <el-dropdown-item @click="navigateToRoute('notificationSettings')">
                  {{ i18ns.t('nav.siteMessages') }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-tooltip :content="themeButtonTitle" placement="bottom" :show-after="250">
            <button
              type="button"
              class="site-header__icon-button"
              :title="themeButtonTitle"
              :aria-label="themeButtonTitle"
              @click="toggleTheme"
            >
              <el-icon><component :is="themeIcon" /></el-icon>
            </button>
          </el-tooltip>
          <LanguageSwitcher compact />
          <el-popover
            placement="bottom-end"
            :width="300"
            trigger="hover"
            :show-after="150"
            :hide-after="120"
            popper-class="topbar-account-popover"
          >
            <template #reference>
              <button
                type="button"
                class="site-header__avatar-button"
                :aria-label="i18ns.t('nav.accountMenu')"
              >
                <el-avatar :size="32">{{ avatarLabel }}</el-avatar>
              </button>
            </template>
            <section class="account-menu">
              <div class="account-menu__identity">
                <el-avatar :size="42">{{ avatarLabel }}</el-avatar>
                <div class="account-menu__identity-copy">
                  <el-tooltip :content="i18ns.t('nav.copyAccountName')" placement="left">
                    <button
                      type="button"
                      class="account-menu__identity-value"
                      @click="copyIdentity(accountName)"
                    >
                      <strong>{{ accountName }}</strong>
                      <el-icon><CopyDocument /></el-icon>
                    </button>
                  </el-tooltip>
                  <el-tooltip :content="i18ns.t('nav.copyAccountId')" placement="left">
                    <button
                      type="button"
                      class="account-menu__identity-value account-menu__identity-value--secondary"
                      @click="copyIdentity(userInfoStore.userInfo.id)"
                    >
                      <span
                        >{{ i18ns.t('nav.accountId') }}:
                        {{ userInfoStore.userInfo.id || '—' }}</span
                      >
                      <el-icon><CopyDocument /></el-icon>
                    </button>
                  </el-tooltip>
                </div>
              </div>

              <button
                type="button"
                class="account-menu__balance"
                @click="navigateToRoute('balanceHistory')"
              >
                <span>{{ i18ns.t('relay.accountBalance') }}</span>
                <strong>{{ i18ns.t('balance.yuan') }} {{ accountBalance }}</strong>
              </button>

              <div class="account-menu__section">
                <div class="account-menu__section-title">{{ i18ns.t('nav.accountMenu') }}</div>
                <button
                  type="button"
                  class="account-menu__action"
                  @click="navigateToRoute('settingsSecurity')"
                >
                  <el-icon><Lock /></el-icon>
                  <span>{{ i18ns.t('nav.settingsSecurity') }}</span>
                </button>
                <button
                  type="button"
                  class="account-menu__action"
                  @click="navigateToRoute('balanceHistory')"
                >
                  <el-icon><Wallet /></el-icon>
                  <span>{{ i18ns.t('nav.costAndBilling') }}</span>
                </button>
              </div>

              <div v-if="hasCommonTools" class="account-menu__section">
                <div class="account-menu__section-title">{{ i18ns.t('nav.commonTools') }}</div>
                <button
                  v-if="canUseRelayTokens"
                  type="button"
                  class="account-menu__action"
                  @click="navigateToRoute('relayTokenManagement')"
                >
                  <el-icon><Key /></el-icon>
                  <span>{{ i18ns.t('nav.myTokens') }}</span>
                </button>
                <button
                  v-if="canUseScripts"
                  type="button"
                  class="account-menu__action"
                  @click="navigateToRoute('scriptManager')"
                >
                  <el-icon><Tools /></el-icon>
                  <span>{{ i18ns.t('nav.scriptManager') }}</span>
                </button>
                <button
                  v-if="canUseRam"
                  type="button"
                  class="account-menu__action"
                  @click="navigateToRoute('ramManagement')"
                >
                  <el-icon><UserFilled /></el-icon>
                  <span>{{ i18ns.t('nav.ramManagement') }}</span>
                </button>
              </div>

              <div class="account-menu__footer">
                <button
                  type="button"
                  class="account-menu__action account-menu__action--danger"
                  @click="logout"
                >
                  <el-icon><SwitchButton /></el-icon>
                  <span>{{ i18ns.t('logout') }}</span>
                </button>
              </div>
            </section>
          </el-popover>
        </div>
      </el-header>
      <el-container class="content-container">
        <AsideMenu
          v-if="isPublicProfile && !showAside"
          ref="asideMenuRef"
          class="site-switcher-only"
          :show-logout="false"
          :show-navigation="false"
        />
        <el-aside v-if="showAside" class="aside">
          <AsideMenu ref="asideMenuRef" :show-logout="isAuthenticated" />
        </el-aside>
        <el-main class="main" :class="{ 'is-embedded': isEmbeddedShell }">
          <slot />
        </el-main>
        <el-aside
          v-if="showUtilityAside && !utilitySidebarCollapsed"
          width="48px"
          class="utility-aside"
        >
          <RightUtilitySidebar v-model:collapsed="utilitySidebarCollapsed" />
        </el-aside>
      </el-container>
      <el-tooltip
        v-if="showUtilityAside && utilitySidebarCollapsed"
        :content="i18ns.t('nav.expandUtilitySidebar')"
        placement="left"
        :show-after="250"
      >
        <button
          type="button"
          class="utility-sidebar-reopen"
          :class="{ 'is-dragging': utilitySidebarReopenDragging }"
          :style="utilitySidebarReopenStyle"
          :aria-label="i18ns.t('nav.expandUtilitySidebar')"
          @click="handleUtilitySidebarReopenClick"
          @pointerdown="startUtilitySidebarReopenDrag"
          @pointermove="moveUtilitySidebarReopenDrag"
          @pointerup="endUtilitySidebarReopenDrag"
          @pointercancel="endUtilitySidebarReopenDrag"
        >
          <el-icon><ArrowLeft /></el-icon>
        </button>
      </el-tooltip>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import AsideMenu from '@/layouts/AsideMenu.vue'
import RightUtilitySidebar from '@/layouts/RightUtilitySidebar.vue'
import ImpersonationBanner from '@/components/common/ImpersonationBanner.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import {
  ArrowLeft,
  CopyDocument,
  Grid,
  Key,
  Lock,
  Moon,
  MoreFilled,
  Sunny,
  SwitchButton,
  Tools,
  UserFilled,
  Wallet,
} from '@element-plus/icons-vue'
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { useThemeToggleStore } from '@/stores/themeToggleStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { useWaterMarkTextStore } from '@/stores/waterMarkTextStore'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { useRoute } from 'vue-router'
import { AuthorizationService, authorizationService } from '@/service/authorizationService'
import { currentSiteProfile } from '@/router'
import { i18ns } from '@/locales'
import { normalizeDocsLocale, resolveDocsUrl } from '@/config/docs'
import { resolveCanonicalRouteUrl } from '@/router/routes'
import router from '@/router'
import { Permission } from '@/constant/permission'
import type { RouteName } from '@/types/route-types.gen'
import { copyToClipboard } from '@/utils/common'

const waterMarkTextStore = useWaterMarkTextStore()
const impersonationStore = useImpersonationStore()
const themeToggleStore = useThemeToggleStore()
const route = useRoute()
const isEmbeddedShell = computed(() => route.query.embed === '1')
const isAuthenticated = computed(() => Boolean(AuthorizationService.getAccessToken()))
const isPublicProfile = computed(() => currentSiteProfile.id === 'public')
const isAccountProfile = computed(() => currentSiteProfile.id === 'account')
const showAside = computed(() => !isEmbeddedShell.value && isAuthenticated.value)
const showUtilityAside = computed(() => !isEmbeddedShell.value && isAuthenticated.value)
const showSiteHeader = computed(
  () =>
    !isEmbeddedShell.value &&
    (isAuthenticated.value || isPublicProfile.value) &&
    currentSiteProfile.id !== 'rejected',
)
const asideMenuRef = useTemplateRef<InstanceType<typeof AsideMenu>>('asideMenuRef')
const utilitySidebarCollapsed = ref(true)
const utilitySidebarReopenTop = ref<number | null>(null)
const utilitySidebarReopenDragging = ref(false)
const permissionStore = usePermissionStore()
const userInfoStore = useUserInfoStore()

const isDark = themeToggleStore.useIsDark()
const themeIcon = computed(() => (isDark.value ? Sunny : Moon))
const themeButtonTitle = computed(() =>
  isDark.value
    ? i18ns.t('floatingOverlay.switchToLightTheme')
    : i18ns.t('floatingOverlay.switchToDarkTheme'),
)
const toggleTheme = () => themeToggleStore.toggleTheme()

const accountName = computed(
  () => userInfoStore.userInfo.name?.trim() || userInfoStore.userInfo.username || '—',
)
const avatarLabel = computed(() => accountName.value.slice(0, 1).toUpperCase())
const accountBalance = computed(() => Number(userInfoStore.userInfo.balance ?? 0).toFixed(4))
const canUseRelayTokens = computed(() => permissionStore.hasPermission(Permission.RELAY_TOKEN_READ))
const canUseScripts = computed(() => permissionStore.hasPermission(Permission.SCRIPT_READ))
const canUseRam = computed(() =>
  permissionStore.hasAnyPermission(
    Permission.RAM_USER_READ,
    Permission.RAM_ROLE_READ,
    Permission.RAM_BINDING_READ,
    Permission.RAM_SESSION_READ,
  ),
)
const hasCommonTools = computed(
  () => canUseRelayTokens.value || canUseScripts.value || canUseRam.value,
)
const utilitySidebarReopenStyle = computed(() =>
  utilitySidebarReopenTop.value === null
    ? undefined
    : { top: `${utilitySidebarReopenTop.value}px`, bottom: 'auto' },
)

let utilitySidebarReopenPointerId: number | null = null
let utilitySidebarReopenStartY = 0
let utilitySidebarReopenStartTop = 0
let suppressUtilitySidebarReopenClick = false

const startUtilitySidebarReopenDrag = (event: PointerEvent) => {
  if (event.button !== 0) return

  const button = event.currentTarget as HTMLButtonElement
  utilitySidebarReopenPointerId = event.pointerId
  utilitySidebarReopenStartY = event.clientY
  utilitySidebarReopenStartTop = utilitySidebarReopenTop.value ?? button.getBoundingClientRect().top
  button.setPointerCapture(event.pointerId)
}

const moveUtilitySidebarReopenDrag = (event: PointerEvent) => {
  if (utilitySidebarReopenPointerId !== event.pointerId) return

  const offset = event.clientY - utilitySidebarReopenStartY
  if (Math.abs(offset) > 3) suppressUtilitySidebarReopenClick = true

  const maxTop = Math.max(12, window.innerHeight - 52)
  utilitySidebarReopenTop.value = Math.min(
    maxTop,
    Math.max(12, utilitySidebarReopenStartTop + offset),
  )
  utilitySidebarReopenDragging.value = true
}

const endUtilitySidebarReopenDrag = (event: PointerEvent) => {
  if (utilitySidebarReopenPointerId !== event.pointerId) return

  const button = event.currentTarget as HTMLButtonElement
  if (button.hasPointerCapture(event.pointerId)) {
    button.releasePointerCapture(event.pointerId)
  }
  utilitySidebarReopenPointerId = null
  utilitySidebarReopenDragging.value = false
}

const handleUtilitySidebarReopenClick = () => {
  if (suppressUtilitySidebarReopenClick) {
    suppressUtilitySidebarReopenClick = false
    return
  }

  utilitySidebarCollapsed.value = false
}

const openSiteDrawer = () => asideMenuRef.value?.openOverview()

const navigateToRoute = (routeName: RouteName) => {
  if (currentSiteProfile.id !== 'rejected') {
    const targetUrl = resolveCanonicalRouteUrl(routeName, currentSiteProfile)
    if (targetUrl && new URL(targetUrl).origin !== window.location.origin) {
      window.location.assign(targetUrl)
      return
    }
  }

  void router.push({ name: routeName } as any)
}

const openDocs = () => {
  const routeName = typeof route.name === 'string' ? route.name : undefined
  window.open(
    resolveDocsUrl(routeName, normalizeDocsLocale(i18ns.refer.value)),
    '_blank',
    'noopener,noreferrer',
  )
}

const copyIdentity = (value?: string | null) => {
  if (!value?.trim()) return
  void copyToClipboard(value)
}

const logout = () => void authorizationService.logout()

onMounted(async () => {
  if (!isAuthenticated.value) {
    waterMarkTextStore.clearText()
    return
  }

  await userInfoStore.init().then(permissionStore.init)
  waterMarkTextStore.setText(`${userInfoStore.userInfo.username}`)
})
</script>

<style scoped>
.common-layout {
  width: 100%;
  height: 100%;
  min-width: 0;
  background: var(--color-background);
  color: var(--color-text);
}

.site-switcher-only {
  position: fixed;
  width: 0;
  height: 0;
}

.common-layout.is-embedded {
  min-height: 100vh;
}

.title {
  font-size: 18px;
  font-weight: 500;
  margin-right: 12px;
}

.app-container {
  height: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.content-container {
  min-width: 0;
  min-height: 0;
}

.site-header {
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid var(--surface-card-border);
  box-sizing: border-box;
}

.site-header__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.site-header__nav-links {
  display: flex;
  align-items: center;
  gap: 4px;
}

.site-header__nav-dropdown {
  display: none;
}

@media screen and (max-width: 1024px) {
  .site-header__nav-links {
    display: none;
  }

  .site-header__nav-dropdown {
    display: inline-flex;
  }
}

.site-header__drawer-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  color: var(--el-text-color-primary);
  font: inherit;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.site-header__drawer-trigger:hover,
.site-header__drawer-trigger:focus-visible {
  background: var(--el-fill-color-light);
  outline: none;
}

.site-header__icon-button,
.site-header__avatar-button {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--el-text-color-regular);
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.site-header__text-button {
  min-width: 0;
  height: 34px;
  padding: 0 8px;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: 13px;
  line-height: 34px;
  white-space: nowrap;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.site-header__text-button:hover,
.site-header__text-button:focus-visible {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
  outline: none;
}

.site-header__icon-button:hover,
.site-header__icon-button:focus-visible,
.site-header__avatar-button:hover,
.site-header__avatar-button:focus-visible {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
  outline: none;
}

.site-header__avatar-button {
  margin-left: 4px;
}

.account-menu {
  padding: 4px 0;
}

.account-menu__identity {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 14px;
}

.account-menu__identity-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.account-menu__identity-copy strong,
.account-menu__identity-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-menu__identity-copy span,
.account-menu__section-title {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.account-menu__identity-value {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 0;
  color: var(--el-text-color-primary);
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.account-menu__identity-value strong,
.account-menu__identity-value span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-menu__identity-value .el-icon {
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.account-menu__identity-value:hover .el-icon,
.account-menu__identity-value:focus-visible .el-icon {
  opacity: 1;
}

.account-menu__identity-value:focus-visible {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 2px;
}

.account-menu__identity-value--secondary {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.account-menu__balance {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  width: calc(100% - 24px);
  margin: 0 12px 10px;
  padding: 10px 12px;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: 12px;
  text-align: left;
  background: var(--el-fill-color-light);
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.account-menu__balance strong {
  color: var(--el-text-color-primary);
  font-size: 15px;
  font-weight: 600;
}

.account-menu__balance:hover,
.account-menu__balance:focus-visible {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  outline: none;
}

.account-menu__section,
.account-menu__footer {
  padding: 10px 6px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.account-menu__section-title {
  padding: 0 8px 6px;
}

.account-menu__action {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 0 8px;
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.account-menu__action:hover,
.account-menu__action:focus-visible {
  background: var(--el-fill-color-light);
  outline: none;
}

.account-menu__action--danger {
  color: var(--el-color-danger);
}

:global(.topbar-account-popover.el-popover) {
  padding: 0;
}

:global(.site-header__nav-dropdown-popper .el-dropdown-menu__item) {
  white-space: nowrap;
}

.with-banner {
  padding-top: 44px;
}

.header {
  padding: 0 1.5vw;
  border-bottom: 1px solid var(--surface-card-border);
  display: flex;
  align-items: center;
  justify-content: center;
}

.page-header {
  width: 100%;
  height: 100%;
  padding: 0;
}

.page-header :deep(.el-page-header__header) {
  width: 100%;
  height: 100%;
}

.aside {
  width: auto;
  overflow: hidden;
  border-right: 1px solid var(--surface-card-border);
  transition: width 0.24s ease;
}

.utility-aside {
  overflow: hidden;
  border-left: 1px solid var(--surface-card-border);
}

.utility-sidebar-reopen {
  position: fixed;
  right: 16px;
  bottom: calc(72px + env(safe-area-inset-bottom));
  z-index: 2000;
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  color: var(--el-text-color-secondary);
  background: var(--el-bg-color);
  border: 1px solid var(--surface-card-border);
  border-radius: 50%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.utility-sidebar-reopen.is-dragging {
  cursor: grabbing;
}

.utility-sidebar-reopen:hover,
.utility-sidebar-reopen:focus-visible {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  outline: none;
}

.main {
  overflow-y: auto;
  overflow-x: hidden;
  height: 100%;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  flex: 1 1 auto;
  padding: 20px;
  position: relative;
}

.main.is-embedded {
  padding: 16px;
}

.main::-webkit-scrollbar {
  width: 8px;
}

.main::-webkit-scrollbar-track {
  background: transparent;
}

.main::-webkit-scrollbar-thumb {
  background: var(--el-color-primary);
  border-radius: 4px;
}

.main::-webkit-scrollbar-thumb:hover {
  background: var(--el-color-primary-light-3);
}

/* Account profile layout rules have moved to AccountProfileLayout.vue to reduce
tight coupling between the shell and page class names. */

/* 移动端优化 */
@media screen and (max-width: 768px) {
  .site-header {
    padding: 0 10px;
  }

  .site-header__drawer-trigger span {
    display: none;
  }

  .site-header__actions {
    gap: 0;
  }

  .site-header__text-button {
    padding: 0 5px;
    font-size: 12px;
  }

  .header {
    padding: 0 12px;
    height: auto !important;
    min-height: 60px;
  }

  .aside {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100% !important;
    height: auto !important;
    z-index: 2000;
    border-right: none;
    border-top: 1px solid var(--surface-card-border);
    background: var(--el-bg-color);
  }

  .utility-aside {
    display: none;
  }

  .utility-sidebar-reopen {
    display: none;
  }

  .main {
    padding: 16px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom) + 72px); /* 留出底部 Tab Bar 空间 */
  }

  :global(.common-layout.is-account-profile .main .settings-container),
  :global(.common-layout.is-account-profile .main .balance-container),
  :global(.common-layout.is-account-profile .main .ticket-layout),
  :global(.common-layout.is-account-profile .main .page-wrap) {
    display: block;
  }

  :global(.common-layout.is-account-profile .main .notification-settings-page) {
    display: block;
  }

  .title {
    font-size: 16px;
    margin-right: 8px;
  }

  .page-header :deep(.el-page-header__header) {
    flex-wrap: wrap;
    gap: 8px;
  }

  .page-header :deep(.el-page-header__left) {
    margin-right: 8px;
  }

  .page-header :deep(.el-page-header__content) {
    flex: 1;
    min-width: 0;
  }

  .page-header :deep(.el-page-header__extra) {
    margin-left: auto;
  }

  .page-header :deep(.el-tag) {
    font-size: 12px;
    padding: 0 6px;
    height: 22px;
    line-height: 22px;
  }
}

@media screen and (max-width: 480px) {
  .header {
    padding: 0 8px;
    min-height: 56px;
  }

  .main {
    padding: 12px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom) + 72px);
  }

  .title {
    font-size: 14px;
    margin-right: 6px;
  }

  .page-header :deep(.el-page-header__header) {
    flex-direction: column;
    align-items: flex-start;
  }

  .page-header :deep(.el-page-header__extra) {
    width: 100%;
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }

  .page-header :deep(.el-button) {
    padding: 8px 12px;
    font-size: 13px;
  }
}
</style>
