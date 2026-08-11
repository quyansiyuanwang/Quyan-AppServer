<template>
  <el-collapse v-model="activeNames" class="dashboard-summary" @change="onCollapseChange">
    <el-collapse-item name="dashboard">
      <template #title>
        <div class="dashboard-header">
          <span>{{ i18ns.t('article.dashboard') }}</span>
          <el-select
            v-model="dashboardDefault"
            class="dashboard-default-select"
            @click.stop
            @change="onDefaultChange"
          >
            <el-option :label="i18ns.t('home.dashboardDefaultOpenOn')" value="open" />
            <el-option :label="i18ns.t('home.dashboardDefaultOpenOff')" value="closed" />
          </el-select>
        </div>
      </template>
      <div class="dashboard-content">
        <!-- Welcome Banner -->
        <el-card class="welcome-card" shadow="never">
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
                  @click="navigateToCanonicalRoute('balanceHistory')"
                >
                  {{ i18ns.t('home.viewDetails') }} →
                </el-button>
              </PermissionWrapper>
            </div>
          </div>
        </el-card>

        <!-- Stats Row -->
        <el-row :gutter="12" class="stats-row">
          <el-col :xs="24" :sm="12" :md="8">
            <el-card class="stat-card" shadow="never">
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
            <el-card class="stat-card" shadow="never">
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
            <el-card class="stat-card" shadow="never">
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
    </el-collapse-item>
  </el-collapse>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { i18ns } from '@/locales'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { navigateToCanonicalRoute } from '@/router/canonical-navigation'
import { Permission } from '@/constant/permission'
import { ACCOUNT_STATUS } from '@/constant/status'
import StorageKey from '@/constant/storagekey'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import {
  CircleCheck,
  User,
  Calendar,
  Sunny,
  Sunset,
  Moon,
  Collection,
} from '@element-plus/icons-vue'
const storedDefault = TypedLocalStorage.getItem(StorageKey.Home.DASHBOARD_DEFAULT_OPEN)
const dashboardDefault = ref<'open' | 'closed'>(storedDefault === 'closed' ? 'closed' : 'open')
const activeNames = ref<string[]>(dashboardDefault.value === 'open' ? ['dashboard'] : [])

function onDefaultChange(val: 'open' | 'closed') {
  TypedLocalStorage.setItem(StorageKey.Home.DASHBOARD_DEFAULT_OPEN, val)
  activeNames.value = val === 'open' ? ['dashboard'] : []
}

function onCollapseChange(val: string[]) {
  activeNames.value = val
}

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
</script>

<style scoped>
.dashboard-summary {
  margin-bottom: 20px;
  border: none;
}

.dashboard-summary :deep(.el-collapse-item__header) {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  background: transparent;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.dashboard-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  padding-right: 8px;
}

.dashboard-default-select {
  width: 180px;
  margin-left: auto;
  flex: 0 0 180px;
}

.dashboard-default-select :deep(.el-select__wrapper) {
  min-height: 30px;
}

.dashboard-summary :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.dashboard-content {
  padding-top: 12px;
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
  .dashboard-default-select {
    width: 120px;
    flex: 0 0 120px;
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
</style>
