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
        <button
          v-if="!isPublicProfile"
          type="button"
          class="site-header__drawer-trigger"
          @click="openSiteDrawer"
        >
          <el-icon><Grid /></el-icon>
          <span>{{ i18ns.t('nav.switchSite') }}</span>
        </button>
        <div class="site-header__actions">
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
                  <strong>{{ accountName }}</strong>
                  <span
                    >{{ i18ns.t('nav.accountId') }}: {{ userInfoStore.userInfo.id || '—' }}</span
                  >
                </div>
              </div>

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
        <el-aside v-if="showAside" class="aside">
          <AsideMenu ref="asideMenuRef" :show-logout="isAuthenticated" />
        </el-aside>
        <el-main class="main" :class="{ 'is-embedded': isEmbeddedShell }">
          <slot />
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import AsideMenu from '@/layouts/AsideMenu.vue'
import ImpersonationBanner from '@/components/common/ImpersonationBanner.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import {
  Grid,
  Key,
  Lock,
  Moon,
  Sunny,
  SwitchButton,
  Tools,
  UserFilled,
  Wallet,
} from '@element-plus/icons-vue'
import { computed, onMounted, ref } from 'vue'
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

const waterMarkTextStore = useWaterMarkTextStore()
const impersonationStore = useImpersonationStore()
const themeToggleStore = useThemeToggleStore()
const route = useRoute()
const isEmbeddedShell = computed(() => route.query.embed === '1')
const isAuthenticated = computed(() => Boolean(AuthorizationService.getAccessToken()))
const isPublicProfile = computed(() => currentSiteProfile.id === 'public')
const isAccountProfile = computed(() => currentSiteProfile.id === 'account')
const showAside = computed(() => !isEmbeddedShell.value && isAuthenticated.value)
const showSiteHeader = computed(
  () =>
    !isEmbeddedShell.value &&
    (isAuthenticated.value || isPublicProfile.value) &&
    currentSiteProfile.id !== 'rejected',
)
const asideMenuRef = ref<InstanceType<typeof AsideMenu> | null>(null)
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

:global(.common-layout.is-account-profile) {
  --account-card-min-width: 20rem;
  --account-card-gap: 16px;
}

/* Account pages are form and record workspaces, not full-width dashboards. */
:global(.common-layout.is-account-profile .main .settings-container),
:global(.common-layout.is-account-profile .main .balance-container),
:global(.common-layout.is-account-profile .main .ticket-layout),
:global(.common-layout.is-account-profile .main .page-wrap) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--account-card-min-width), 1fr));
  grid-auto-flow: row dense;
  align-items: start;
  gap: var(--account-card-gap);
}

:global(.common-layout.is-account-profile .main .settings-container .page-header),
:global(.common-layout.is-account-profile .main .balance-container > header) {
  grid-column: 1 / -1;
}

:global(.common-layout.is-account-profile .main .el-card) {
  inline-size: 100%;
  margin: 0;
}

:global(.common-layout.is-account-profile .main .settings-container > .el-card),
:global(.common-layout.is-account-profile .main .balance-container > .el-card),
:global(.common-layout.is-account-profile .main .page-wrap > .el-card),
:global(.common-layout.is-account-profile .main .ticket-layout > *) {
  min-inline-size: 0;
  inline-size: 100%;
  max-inline-size: none;
}

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

  .main {
    padding: 16px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom) + 72px); /* 留出底部 Tab Bar 空间 */
  }

  :global(.common-layout.is-account-profile .main .settings-container),
  :global(.common-layout.is-account-profile .main .balance-container),
  :global(.common-layout.is-account-profile .main .ticket-layout),
  :global(.common-layout.is-account-profile .main .page-wrap) {
    grid-template-columns: minmax(0, 1fr);
  }

  :global(.common-layout.is-account-profile .main .el-card),
  :global(.common-layout.is-account-profile .main .settings-container > .el-card),
  :global(.common-layout.is-account-profile .main .balance-container > .el-card),
  :global(.common-layout.is-account-profile .main .page-wrap > .el-card),
  :global(.common-layout.is-account-profile .main .ticket-layout > *) {
    inline-size: 100%;
    max-inline-size: none;
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
