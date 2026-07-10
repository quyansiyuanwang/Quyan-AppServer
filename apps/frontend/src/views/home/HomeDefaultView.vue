<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="home-container">
      <!-- Welcome Banner -->
      <el-card class="welcome-card page-card" shadow="never">
        <div class="welcome-content">
          <div class="welcome-left">
            <div class="greeting-row">
              <el-icon :size="20" class="greeting-icon">
                <Sunny v-if="timeOfDay === 'morning'" />
                <Sunset v-else-if="timeOfDay === 'afternoon'" />
                <Moon v-else />
              </el-icon>
              <span class="greeting-text">{{ timeGreeting }}</span>
            </div>
            <h1 class="welcome-title">{{ username }}</h1>
            <div class="welcome-meta">
              <el-tag :type="statusType" size="small" round>
                <el-icon><CircleCheck /></el-icon>
                {{ statusLabel }}
              </el-tag>
              <span class="meta-divider" />
              <span class="meta-item">
                <el-icon><Collection /></el-icon>
                {{ groupName || i18ns.t('home.noGroup') }}
              </span>
              <span class="meta-divider" />
              <span class="meta-item">
                <el-icon><Calendar /></el-icon>
                {{ i18ns.t('home.memberSince') }} {{ memberSince }}
              </span>
            </div>
          </div>
          <div class="welcome-balance">
            <div class="balance-label">{{ i18ns.t('home.balance') }}</div>
            <div class="balance-value">
              <span class="balance-currency">{{ i18ns.t('balance.yuan') }}</span>
              <span class="balance-amount">{{ balance.toFixed(4) }}</span>
            </div>
            <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
              <el-button
                size="small"
                text
                type="primary"
                @click="router.push({ name: 'balanceHistory' })"
              >
                {{ i18ns.t('home.viewDetails') }} →
              </el-button>
            </PermissionWrapper>
          </div>
        </div>
      </el-card>

      <!-- Quick Actions -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">{{ i18ns.t('home.quickActions') }}</span>
        </div>
        <el-row :gutter="12">
          <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
            <el-col :xs="8" :sm="8" :md="6" :lg="4">
              <div class="action-card" @click="router.push({ name: 'relayTokenManagement' })">
                <div class="action-icon-wrap" style="background: #ecf5ff">
                  <el-icon :size="22" color="#409EFF"><Key /></el-icon>
                </div>
                <span class="action-label">{{ i18ns.t('nav.myTokens') }}</span>
              </div>
            </el-col>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
            <el-col :xs="8" :sm="8" :md="6" :lg="4">
              <div class="action-card" @click="router.push({ name: 'balanceHistory' })">
                <div class="action-icon-wrap" style="background: #f0f9eb">
                  <el-icon :size="22" color="#67C23A"><Wallet /></el-icon>
                </div>
                <span class="action-label">{{ i18ns.t('nav.balanceHistory') }}</span>
              </div>
            </el-col>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.JSON_ENDPOINT_READ]">
            <el-col :xs="8" :sm="8" :md="6" :lg="4">
              <div class="action-card" @click="router.push({ name: 'jsonEndpointManagement' })">
                <div class="action-icon-wrap" style="background: #fdf6ec">
                  <el-icon :size="22" color="#E6A23C"><Document /></el-icon>
                </div>
                <span class="action-label">{{ i18ns.t('nav.jsonEndpoints') }}</span>
              </div>
            </el-col>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.OJ_APIKEY_READ]">
            <el-col :xs="8" :sm="8" :md="6" :lg="4">
              <div class="action-card" @click="router.push({ name: 'ojAPIKeyManagement' })">
                <div class="action-icon-wrap" style="background: #f3eeff">
                  <el-icon :size="22" color="#9B59B6"><Cpu /></el-icon>
                </div>
                <span class="action-label">{{ i18ns.t('nav.ojSubmitter') }}</span>
              </div>
            </el-col>
          </PermissionWrapper>
          <el-col :xs="8" :sm="8" :md="6" :lg="4">
            <div class="action-card" @click="router.push({ name: 'apiDocumentation' })">
              <div class="action-icon-wrap" style="background: #fef0f0">
                <el-icon :size="22" color="#F56C6C"><Reading /></el-icon>
              </div>
              <span class="action-label">{{ i18ns.t('nav.apiDocumentation') }}</span>
            </div>
          </el-col>
          <el-col :xs="8" :sm="8" :md="6" :lg="4">
            <div class="action-card" @click="router.push({ name: 'settings' })">
              <div class="action-icon-wrap" style="background: #f4f4f5">
                <el-icon :size="22" color="#909399"><Setting /></el-icon>
              </div>
              <span class="action-label">{{ i18ns.t('nav.settings') }}</span>
            </div>
          </el-col>
        </el-row>
      </div>

      <!-- Stats Row -->
      <el-row :gutter="12" class="stats-row">
        <el-col :xs="24" :sm="12" :md="8">
          <el-card class="stat-card page-card" shadow="never">
            <div class="stat-inner">
              <div class="stat-icon-wrap" style="background: #ecf5ff">
                <el-icon :size="20" color="#409EFF"><User /></el-icon>
              </div>
              <div class="stat-body">
                <div class="stat-label">{{ i18ns.t('home.accountId') }}</div>
                <div class="stat-value mono">{{ shortId }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="8">
          <el-card class="stat-card page-card" shadow="never">
            <div class="stat-inner">
              <div class="stat-icon-wrap" style="background: #f0f9eb">
                <el-icon :size="20" color="#67C23A"><Collection /></el-icon>
              </div>
              <div class="stat-body">
                <div class="stat-label">{{ i18ns.t('home.userGroup') }}</div>
                <div class="stat-value">{{ groupName || '—' }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="8">
          <el-card class="stat-card page-card" shadow="never">
            <div class="stat-inner">
              <div class="stat-icon-wrap" style="background: #f4f4f5">
                <el-icon :size="20" color="#909399"><Calendar /></el-icon>
              </div>
              <div class="stat-body">
                <div class="stat-label">{{ i18ns.t('home.memberSince') }}</div>
                <div class="stat-value">{{ memberSince }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>
  </div>
  <div v-else class="mobile-page mobile-adapter">
    <div class="home-container">
      <!-- Welcome Banner -->
      <el-card class="welcome-card mobile-card" shadow="never">
        <div class="welcome-content">
          <div class="welcome-left">
            <div class="greeting-row">
              <el-icon :size="20" class="greeting-icon">
                <Sunny v-if="timeOfDay === 'morning'" />
                <Sunset v-else-if="timeOfDay === 'afternoon'" />
                <Moon v-else />
              </el-icon>
              <span class="greeting-text">{{ timeGreeting }}</span>
            </div>
            <h1 class="welcome-title">{{ username }}</h1>
            <div class="welcome-meta">
              <el-tag :type="statusType" size="small" round>
                <el-icon><CircleCheck /></el-icon>
                {{ statusLabel }}
              </el-tag>
              <span class="meta-divider" />
              <span class="meta-item">
                <el-icon><Collection /></el-icon>
                {{ groupName || i18ns.t('home.noGroup') }}
              </span>
              <span class="meta-divider" />
              <span class="meta-item">
                <el-icon><Calendar /></el-icon>
                {{ i18ns.t('home.memberSince') }} {{ memberSince }}
              </span>
            </div>
          </div>
          <div class="welcome-balance">
            <div class="balance-label">{{ i18ns.t('home.balance') }}</div>
            <div class="balance-value">
              <span class="balance-currency">{{ i18ns.t('balance.yuan') }}</span>
              <span class="balance-amount">{{ balance.toFixed(4) }}</span>
            </div>
            <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
              <el-button
                size="small"
                text
                type="primary"
                @click="router.push({ name: 'balanceHistory' })"
              >
                {{ i18ns.t('home.viewDetails') }} →
              </el-button>
            </PermissionWrapper>
          </div>
        </div>
      </el-card>

      <!-- Quick Actions -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">{{ i18ns.t('home.quickActions') }}</span>
        </div>
        <el-row :gutter="12">
          <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
            <el-col :xs="8" :sm="8" :md="6" :lg="4">
              <div class="action-card" @click="router.push({ name: 'relayTokenManagement' })">
                <div class="action-icon-wrap" style="background: #ecf5ff">
                  <el-icon :size="22" color="#409EFF"><Key /></el-icon>
                </div>
                <span class="action-label">{{ i18ns.t('nav.myTokens') }}</span>
              </div>
            </el-col>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
            <el-col :xs="8" :sm="8" :md="6" :lg="4">
              <div class="action-card" @click="router.push({ name: 'balanceHistory' })">
                <div class="action-icon-wrap" style="background: #f0f9eb">
                  <el-icon :size="22" color="#67C23A"><Wallet /></el-icon>
                </div>
                <span class="action-label">{{ i18ns.t('nav.balanceHistory') }}</span>
              </div>
            </el-col>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.JSON_ENDPOINT_READ]">
            <el-col :xs="8" :sm="8" :md="6" :lg="4">
              <div class="action-card" @click="router.push({ name: 'jsonEndpointManagement' })">
                <div class="action-icon-wrap" style="background: #fdf6ec">
                  <el-icon :size="22" color="#E6A23C"><Document /></el-icon>
                </div>
                <span class="action-label">{{ i18ns.t('nav.jsonEndpoints') }}</span>
              </div>
            </el-col>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.OJ_APIKEY_READ]">
            <el-col :xs="8" :sm="8" :md="6" :lg="4">
              <div class="action-card" @click="router.push({ name: 'ojAPIKeyManagement' })">
                <div class="action-icon-wrap" style="background: #f3eeff">
                  <el-icon :size="22" color="#9B59B6"><Cpu /></el-icon>
                </div>
                <span class="action-label">{{ i18ns.t('nav.ojSubmitter') }}</span>
              </div>
            </el-col>
          </PermissionWrapper>
          <el-col :xs="8" :sm="8" :md="6" :lg="4">
            <div class="action-card" @click="router.push({ name: 'apiDocumentation' })">
              <div class="action-icon-wrap" style="background: #fef0f0">
                <el-icon :size="22" color="#F56C6C"><Reading /></el-icon>
              </div>
              <span class="action-label">{{ i18ns.t('nav.apiDocumentation') }}</span>
            </div>
          </el-col>
          <el-col :xs="8" :sm="8" :md="6" :lg="4">
            <div class="action-card" @click="router.push({ name: 'settings' })">
              <div class="action-icon-wrap" style="background: #f4f4f5">
                <el-icon :size="22" color="#909399"><Setting /></el-icon>
              </div>
              <span class="action-label">{{ i18ns.t('nav.settings') }}</span>
            </div>
          </el-col>
        </el-row>
      </div>

      <!-- Stats Row -->
      <el-row :gutter="12" class="stats-row">
        <el-col :xs="24" :sm="12" :md="8">
          <el-card class="stat-card mobile-card" shadow="never">
            <div class="stat-inner">
              <div class="stat-icon-wrap" style="background: #ecf5ff">
                <el-icon :size="20" color="#409EFF"><User /></el-icon>
              </div>
              <div class="stat-body">
                <div class="stat-label">{{ i18ns.t('home.accountId') }}</div>
                <div class="stat-value mono">{{ shortId }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="8">
          <el-card class="stat-card mobile-card" shadow="never">
            <div class="stat-inner">
              <div class="stat-icon-wrap" style="background: #f0f9eb">
                <el-icon :size="20" color="#67C23A"><Collection /></el-icon>
              </div>
              <div class="stat-body">
                <div class="stat-label">{{ i18ns.t('home.userGroup') }}</div>
                <div class="stat-value">{{ groupName || '—' }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="24" :sm="12" :md="8">
          <el-card class="stat-card mobile-card" shadow="never">
            <div class="stat-inner">
              <div class="stat-icon-wrap" style="background: #f4f4f5">
                <el-icon :size="20" color="#909399"><Calendar /></el-icon>
              </div>
              <div class="stat-body">
                <div class="stat-label">{{ i18ns.t('home.memberSince') }}</div>
                <div class="stat-value">{{ memberSince }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { onMounted, computed } from 'vue'
import router from '@/router'
import { Permission } from '@/constant/permission'
import { ACCOUNT_STATUS } from '@/constant/status'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import {
  Key,
  Wallet,
  Document,
  Setting,
  CircleCheck,
  User,
  Calendar,
  Sunny,
  Sunset,
  Moon,
  Collection,
  Cpu,
  Reading,
} from '@element-plus/icons-vue'

const userInfoStore = useUserInfoStore()

const userInfo = computed(() => userInfoStore.userInfo)
const username = computed(() => userInfo.value.username)
const shortId = computed(() => (userInfo.value.id ? userInfo.value.id.slice(0, 8) + '...' : '—'))
const balance = computed(() => userInfo.value.balance ?? 0)
const groupName = computed(() => userInfo.value.groupName || '')

const memberSince = computed(() => {
  if (!userInfo.value.createdAt) return '—'
  return new Date(userInfo.value.createdAt).toLocaleDateString()
})

const statusType = computed(() =>
  userInfo.value.status === ACCOUNT_STATUS.ACTIVE ? 'success' : 'danger',
)
const statusLabel = computed(() =>
  userInfo.value.status === ACCOUNT_STATUS.ACTIVE
    ? i18ns.t('home.active')
    : i18ns.t('home.inactive'),
)

const timeOfDay = computed(() => {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 18) return 'afternoon'
  return 'evening'
})

const timeGreeting = computed(
  () =>
    ({
      morning: i18ns.t('home.goodMorning'),
      afternoon: i18ns.t('home.goodAfternoon'),
      evening: i18ns.t('home.goodEvening'),
    })[timeOfDay.value],
)

onMounted(async () => {
  await userInfoStore.fetchUserInfo()
})

const { isDesktop } = usePageDevice()

if (!isDesktop.value) {
  useMobileTableCardLabels('.mobile-adapter')
}
</script>

<style scoped>
.home-container {
  width: 100%;
  min-width: 0;
}

.welcome-card {
  margin-bottom: 20px;
  background: linear-gradient(135deg, var(--el-color-primary-light-9) 0%, var(--el-bg-color) 100%);
  border-color: var(--el-color-primary-light-7);
}

.welcome-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
}

.welcome-left {
  flex: 1;
  min-width: 0;
}

.greeting-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.greeting-icon {
  color: var(--el-color-warning);
}

.greeting-text {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.welcome-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin: 0 0 12px 0;
}

.welcome-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.meta-divider {
  width: 1px;
  height: 14px;
  background: var(--el-border-color);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.welcome-balance {
  text-align: right;
  flex-shrink: 0;
  padding: 12px 20px;
  background: var(--el-bg-color);
  border-radius: 10px;
  border: 1px solid var(--el-border-color-lighter);
}

.balance-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.balance-value {
  display: flex;
  align-items: baseline;
  gap: 2px;
  justify-content: flex-end;
  margin-bottom: 6px;
}

.balance-currency {
  font-size: 16px;
  color: var(--el-color-primary);
  font-weight: 600;
}

.balance-amount {
  font-size: 28px;
  font-weight: 700;
  color: var(--el-color-primary);
  line-height: 1;
}

.section {
  margin-bottom: 20px;
}

.section-header {
  margin-bottom: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.action-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 8px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 12px;
  text-align: center;
}

.action-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.action-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-label {
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-weight: 500;
  line-height: 1.3;
}

.stats-row {
  margin-bottom: 20px;
}

.stat-card {
  margin-bottom: 12px;
}

.stat-inner {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-body {
  flex: 1;
  min-width: 0;
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 2px;
}

.stat-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: monospace;
  font-size: 13px;
}

@media (max-width: 768px) {
  .home-container {
    padding: 12px;
  }

  .welcome-content {
    flex-direction: column;
    align-items: flex-start;
  }

  .welcome-balance {
    width: 100%;
    text-align: left;
  }

  .balance-value {
    justify-content: flex-start;
  }

  .welcome-title {
    font-size: 22px;
  }
}

@media (max-width: 480px) {
  .welcome-title {
    font-size: 20px;
  }
  .balance-amount {
    font-size: 24px;
  }
  .action-label {
    font-size: 11px;
  }
  .stat-value {
    font-size: 13px;
  }
}
</style>

<style scoped>
.mobile-adapter {
  padding: 8px 6px 16px;
  overflow-x: hidden;
}

.mobile-adapter :deep(.hide-on-mobile),
.mobile-adapter :deep(.el-table__header-wrapper),
.mobile-adapter :deep(.el-scrollbar__bar.is-horizontal),
.mobile-adapter :deep(.el-table__body colgroup),
.mobile-adapter :deep(.el-table__header colgroup) {
  display: none !important;
}

.mobile-adapter :deep(.el-form--inline) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.mobile-adapter :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 10px;
}

.mobile-adapter :deep(.el-form-item__label) {
  float: none;
  display: block;
  text-align: left;
  padding: 0 0 6px;
}

.mobile-adapter :deep(.el-form-item__content) {
  margin-left: 0 !important;
}

.mobile-adapter :deep(.el-input),
.mobile-adapter :deep(.el-select),
.mobile-adapter :deep(.el-date-editor),
.mobile-adapter :deep(.el-input-number),
.mobile-adapter :deep(.el-textarea),
.mobile-adapter :deep(.el-button) {
  width: 100%;
}

.mobile-adapter :deep(.el-table__inner-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__wrap),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__view) {
  overflow-x: hidden !important;
}

.mobile-adapter :deep(.el-table__body-wrapper) {
  overflow-y: visible !important;
  padding: 4px 0 10px;
}

.mobile-adapter :deep(.el-table__body tbody) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mobile-adapter :deep(.el-table__body tr) {
  display: block;
  width: 100% !important;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
}

.mobile-adapter :deep(.el-table__body td) {
  display: block;
  border: none !important;
  padding: 5px 0;
}

.mobile-adapter :deep(.el-table__body td::before) {
  content: attr(data-label);
  display: block;
  margin-bottom: 2px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}

.mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.mobile-adapter :deep(.el-drawer) {
  max-height: 92vh;
}

.mobile-adapter :deep(.el-pagination) {
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
