<template>
  <div class="page-wrap">
    <el-card class="page-card">
      <template #header>
        <div class="header-row">
          <div class="left-content">
            <div class="title">{{ i18ns.t('monthlyPass.pageTitle') }}</div>
            <div class="subtitle">{{ i18ns.t('monthlyPass.myDescription') }}</div>
            <div class="subtitle">{{ i18ns.t('monthlyPass.purchaseCenterHint') }}</div>
          </div>
          <div class="right-content">
            <div class="monthly-pass-purchase-header-actions">
              <el-tag type="success" effect="plain" style="margin-right: 12px">
                {{ i18ns.t('remoteTerminalProduct.currentBalance') }}:
                {{ monthlyPassBalance ? formatMonthlyPassPrice(monthlyPassBalance) : '-' }}
              </el-tag>
              <el-button
                :icon="Refresh"
                :loading="loadingPublishedMonthlyPasses"
                type="primary"
                @click="refreshMonthlyPassTemplates"
              >
                {{ i18ns.t('refresh') }}
              </el-button>
            </div>
          </div>
        </div>
      </template>

      <div v-if="!canView" class="permission-empty">
        <el-empty :description="'TODO'" />
      </div>

      <el-tabs v-model="activeTabName">
        <el-tab-pane :label="i18ns.t('monthlyPass.viewMyPasses')" name="myPasses">
          <template #header>
            <div class="title">{{ i18ns.t('monthlyPass.myTitle') }}</div>
          </template>

          <div class="toolbar-row">
            <el-select v-model="viewStatus" class="status-filter">
              <el-option :label="i18ns.t('all')" value="all" />
              <el-option :label="i18ns.t('monthlyPass.statusActive')" value="active" />
              <el-option :label="i18ns.t('monthlyPass.statusPending')" value="pending" />
              <el-option :label="i18ns.t('monthlyPass.statusExpired')" value="expired" />
              <el-option :label="i18ns.t('monthlyPass.statusDisabled')" value="disabled" />
            </el-select>
          </div>

          <el-empty
            v-if="!loading && filteredRecords.length === 0"
            :description="i18ns.t('monthlyPass.myNoRecords')"
          />

          <el-table v-else-if="isDesktop" :data="filteredRecords" v-loading="loading" stripe>
            <el-table-column
              prop="templateName"
              :label="i18ns.t('monthlyPass.template')"
              min-width="180"
            />
            <el-table-column :label="i18ns.t('monthlyPass.quotaUnit')" width="130">
              <template #default="{ row }">{{ formatQuotaUnit(row.quotaUnit) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.quotaWindowHours')" width="140">
              <template #default="{ row }">{{
                formatQuotaWindowHours(row.quotaWindowHours)
              }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.validPeriod')" min-width="220">
              <template #default="{ row }">
                <div>{{ formatDateTime(row.startAt) }}</div>
                <div class="secondary-text">{{ formatDateTime(row.endAt) }}</div>
              </template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.remainingQuota')" width="180">
              <template #default="{ row }">
                <div>{{ formatQuotaValue(row.remainingQuota, row.quotaUnit) }}</div>
                <div class="secondary-text">
                  {{ formatQuotaValue(row.usedQuota, row.quotaUnit) }} /
                  {{ formatQuotaValue(row.totalQuota, row.quotaUnit) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.dailyQuota')" width="130">
              <template #default="{ row }">{{
                formatDailyQuota(row.dailyQuota, row.quotaUnit)
              }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.allowedChannels')" min-width="220">
              <template #default="{ row }">{{
                formatScope(row.allowedChannels, i18ns.t('monthlyPass.allChannels'))
              }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.allowedModels')" min-width="260">
              <template #default="{ row }">{{
                formatScope(row.allowedModels, i18ns.t('monthlyPass.allModels'))
              }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('monthlyPass.status')" width="120">
              <template #default="{ row }">
                <el-tag :type="statusTagType(getPassStatus(row))" size="small">
                  {{ i18ns.t(statusTextKey(getPassStatus(row))) }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>

          <div v-else class="my-pass-mobile-list" v-loading="loading">
            <el-card
              v-for="row in filteredRecords"
              :key="row.id"
              class="my-pass-mobile-card"
              shadow="never"
            >
              <div class="card-head">
                <div class="card-title">{{ row.templateName }}</div>
                <el-tag :type="statusTagType(getPassStatus(row))" size="small">
                  {{ i18ns.t(statusTextKey(getPassStatus(row))) }}
                </el-tag>
              </div>

              <div class="card-grid">
                <div class="field full">
                  <span class="label">{{ i18ns.t('monthlyPass.validPeriod') }}</span>
                  <span class="value"
                    >{{ formatDateTime(row.startAt) }} ~ {{ formatDateTime(row.endAt) }}</span
                  >
                </div>
                <div class="field">
                  <span class="label">{{ i18ns.t('monthlyPass.remainingQuota') }}</span>
                  <span class="value">{{
                    formatQuotaValue(row.remainingQuota, row.quotaUnit)
                  }}</span>
                </div>
                <div class="field">
                  <span class="label">{{ i18ns.t('monthlyPass.usedQuota') }}</span>
                  <span class="value">{{ formatQuotaValue(row.usedQuota, row.quotaUnit) }}</span>
                </div>
                <div class="field">
                  <span class="label">{{ i18ns.t('monthlyPass.totalQuota') }}</span>
                  <span class="value">{{ formatQuotaValue(row.totalQuota, row.quotaUnit) }}</span>
                </div>
                <div class="field">
                  <span class="label">{{ i18ns.t('monthlyPass.dailyQuota') }}</span>
                  <span class="value">{{ formatDailyQuota(row.dailyQuota, row.quotaUnit) }}</span>
                </div>
                <div class="field">
                  <span class="label">{{ i18ns.t('monthlyPass.quotaUnit') }}</span>
                  <span class="value">{{ formatQuotaUnit(row.quotaUnit) }}</span>
                </div>
                <div class="field">
                  <span class="label">{{ i18ns.t('monthlyPass.quotaWindowHours') }}</span>
                  <span class="value">{{ formatQuotaWindowHours(row.quotaWindowHours) }}</span>
                </div>
                <div class="field full">
                  <span class="label">{{ i18ns.t('monthlyPass.allowedChannels') }}</span>
                  <span class="value">{{
                    formatScope(row.allowedChannels, i18ns.t('monthlyPass.allChannels'))
                  }}</span>
                </div>
                <div class="field full">
                  <span class="label">{{ i18ns.t('monthlyPass.allowedModels') }}</span>
                  <span class="value">{{
                    formatScope(row.allowedModels, i18ns.t('monthlyPass.allModels'))
                  }}</span>
                </div>
              </div>
            </el-card>
          </div>
        </el-tab-pane>

        <el-tab-pane :label="i18ns.t('monthlyPass.purchaseCenter')" name="purchase">
          <MonthlyPassPurchaseView embedded />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElCard, ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import { MANAGED_STATUS } from '@/constant/status'
import { monthlyPassService } from '@/service/monthlyPassService'
import type { MonthlyPassTemplateDto, UserMonthlyPassDto } from '@/client/types.gen'
import MonthlyPassPurchaseView from '@/views/relay/MonthlyPassPurchaseView.vue'
import { useRoute } from 'vue-router'
import { usePermissionStore } from '@/stores/permissionStore'
import { Refresh } from '@element-plus/icons-vue'
import { balanceService } from '@/service/balanceService'
import { useApiDocumentationPricing } from '@/composables/useApiDocumentationPricing'

type PassStatusFilter = 'all' | 'active' | 'pending' | 'expired' | 'disabled'
type QuotaUnit = 'amount' | 'request' | 'token'
type MonthlyPassTab = 'myPasses' | 'purchase'

const permissionStore = usePermissionStore()
const { isDesktop } = usePageDevice()
const route = useRoute()
const monthlyPassLoadError = ref('')
const monthlyPassBalance = ref<number | null>(null)
const loadingPublishedMonthlyPasses = ref(false)
const publishedMonthlyPasses = ref<MonthlyPassTemplateDto[]>([])
const { channels, loadChannels } = useApiDocumentationPricing()

const loading = ref(false)
const records = ref<UserMonthlyPassDto[]>([])
const viewStatus = ref<PassStatusFilter>('all')
const activeTabName = ref<MonthlyPassTab>('myPasses')
const loadingMonthlyPassBalance = ref(false)

const canView = computed(() => Boolean(permissionStore))

const resolveTabFromRoute = (): MonthlyPassTab =>
  route.query.tab === 'purchase' ? 'purchase' : 'myPasses'

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

const formatMonthlyPassDecimal = (value: number, precision = 4) => {
  return value.toFixed(precision).replace(/\.?0+$/, '')
}

const formatMonthlyPassPrice = (value?: number) => {
  if (value == null) return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return formatMonthlyPassDecimal(numeric)
}

const refreshMonthlyPassTemplates = async () => {
  await loadPublishedMonthlyPasses()
}

const formatDateTime = (value?: string) => {
  if (!value) return '-'
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return value
  return time.toLocaleString()
}

const normalizeQuotaUnit = (value?: string): QuotaUnit => {
  if (value === 'request' || value === 'token') return value
  return 'amount'
}

const formatQuotaUnit = (value?: string) => {
  const unit = normalizeQuotaUnit(value)
  if (unit === 'request') return i18ns.t('monthlyPass.quotaUnitRequest')
  if (unit === 'token') return i18ns.t('monthlyPass.quotaUnitToken')
  return i18ns.t('monthlyPass.quotaUnitAmount')
}

const formatQuotaWindowHours = (value?: number) => {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) return '-'
  return `${Math.floor(Number(value))}${i18ns.t('monthlyPass.hoursUnit')}`
}

const formatQuotaValue = (value?: number, unit?: string) => {
  if (value == null) return '-'
  const quotaUnit = normalizeQuotaUnit(unit)
  if (quotaUnit === 'request' || quotaUnit === 'token')
    return String(Math.max(0, Math.floor(Number(value))))
  return Number(value).toFixed(4)
}

const formatDailyQuota = (value?: number, unit?: string) => {
  if (value == null) return i18ns.t('monthlyPass.unlimited')
  return formatQuotaValue(value, unit)
}

const formatScope = (values: string[] | undefined, allLabel: string) => {
  if (!values || values.length === 0) return allLabel
  return values.join(', ')
}

const getPassStatus = (row: UserMonthlyPassDto): Exclude<PassStatusFilter, 'all'> => {
  if (row.status !== MANAGED_STATUS.ENABLED) return 'disabled'

  const now = Date.now()
  const startAt = new Date(row.startAt).getTime()
  const endAt = new Date(row.endAt).getTime()

  if (Number.isNaN(startAt) || Number.isNaN(endAt)) return 'disabled'
  if (now < startAt) return 'pending'
  if (now > endAt) return 'expired'
  return 'active'
}

const statusTextKey = (status: Exclude<PassStatusFilter, 'all'>) => {
  if (status === 'active') return 'monthlyPass.statusActive'
  if (status === 'pending') return 'monthlyPass.statusPending'
  if (status === 'expired') return 'monthlyPass.statusExpired'
  return 'monthlyPass.statusDisabled'
}

const statusTagType = (status: Exclude<PassStatusFilter, 'all'>) => {
  if (status === 'active') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'expired') return 'info'
  return 'danger'
}

const filteredRecords = computed(() => {
  if (viewStatus.value === 'all') return records.value
  return records.value.filter((item) => getPassStatus(item) === viewStatus.value)
})

const loadMyPasses = async () => {
  loading.value = true
  try {
    const result = await monthlyPassService.listMyUserPasses({ page: 1, pageSize: 100 })
    records.value = result.records || []
  } catch (error) {
    ElMessage.error(toErrorMessage(error, i18ns.t('monthlyPass.refreshFailed')))
  } finally {
    loading.value = false
  }
}
const loadMonthlyPassBalance = async () => {
  loadingMonthlyPassBalance.value = true
  try {
    const result = await balanceService.getMyBalance()
    monthlyPassBalance.value = Number.isFinite(Number(result.balance))
      ? Number(result.balance)
      : null
  } catch {
    monthlyPassBalance.value = null
  } finally {
    loadingMonthlyPassBalance.value = false
  }
}

const loadPublishedMonthlyPasses = async () => {
  loadingPublishedMonthlyPasses.value = true
  monthlyPassLoadError.value = ''

  try {
    const [templates] = await Promise.all([
      monthlyPassService.listPublishedTemplates(),
      loadMonthlyPassBalance(),
    ])
    publishedMonthlyPasses.value = templates
    if (!channels.value.length) {
      void loadChannels().catch(() => {
        // Keep monthly pass cards usable even if channel names fail to load.
      })
    }
  } catch (error) {
    publishedMonthlyPasses.value = []
    monthlyPassLoadError.value = toErrorMessage(error, i18ns.t('apiDoc.monthlyPassesLoadFailed'))
  } finally {
    loadingPublishedMonthlyPasses.value = false
  }
}

onMounted(async () => {
  activeTabName.value = resolveTabFromRoute()
  await Promise.all([loadPublishedMonthlyPasses(), loadMyPasses()])
})

watch(
  () => route.name,
  () => {
    activeTabName.value = resolveTabFromRoute()
  },
)
</script>

<style scoped>
.page-wrap {
  width: 100%;
}
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.left-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.right-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.my-pass-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.title {
  font-size: 16px;
  font-weight: 600;
}

.subtitle {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-top: 4px;
}

.toolbar-row {
  display: flex;
  justify-content: flex-end;
}

.status-filter {
  width: 180px;
}

.secondary-text {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.my-pass-mobile-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.my-pass-mobile-card {
  border: 1px solid var(--el-border-color-light);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  word-break: break-word;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.field.full {
  grid-column: 1 / -1;
}

.field .label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.field .value {
  color: var(--el-text-color-primary);
  font-size: 13px;
  word-break: break-word;
}

@media (max-width: 768px) {
  .header-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .toolbar-row {
    justify-content: flex-start;
  }

  .status-filter {
    width: 100%;
  }

  .card-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
