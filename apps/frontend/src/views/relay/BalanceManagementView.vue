<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="balance-management">
      <el-card class="page-card">
        <template #header>
          <span>{{ i18ns.t('balance.management') }}</span>
        </template>

        <el-form inline class="toolbar-row">
          <el-form-item :label="i18ns.t('balance.userId')">
            <el-input
              v-model="filters.userId"
              :placeholder="i18ns.t('balance.enterUserId')"
              clearable
              style="width: 200px"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="handleSearch">{{ i18ns.t('search') }}</el-button>
            <el-button @click="refreshList">{{ i18ns.t('refresh') }}</el-button>
          </el-form-item>
        </el-form>

        <el-table :data="users" v-loading="loading">
          <el-table-column
            prop="userId"
            :label="i18ns.t('balance.userId')"
            min-width="150"
            class-name="hide-on-mobile"
          />
          <el-table-column prop="username" :label="i18ns.t('username')" min-width="120" />
          <el-table-column prop="balance" :label="i18ns.t('balance.currentBalance')" width="120">
            <template #default="{ row }">
              <span class="balance-amount">{{ formatBalanceAmount(row.balance) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            prop="updateTime"
            :label="i18ns.t('balance.updateTime')"
            width="180"
            class-name="hide-on-mobile"
          >
            <template #default="{ row }">
              {{ new Date(row.updateTime).toLocaleString() }}
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" min-width="300">
            <template #default="{ row }">
              <el-button type="primary" size="small" @click="openAdjustDialog(row)">
                {{ i18ns.t('balance.adjustBalance') }}
              </el-button>
              <el-button type="info" size="small" @click="viewHistory(row)">
                {{ i18ns.t('balance.viewHistory') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.pageSize"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="loadUsers"
          style="margin-top: 20px; justify-content: center"
        />
      </el-card>

      <el-dialog v-model="showAdjustDialog" :title="i18ns.t('balance.adjustBalance')" width="400px">
        <el-form :model="adjustForm" label-width="120px">
          <el-form-item :label="i18ns.t('balance.userId')">
            <el-input v-model="adjustForm.userId" disabled />
          </el-form-item>
          <el-form-item :label="i18ns.t('balance.currentBalance')">
            <el-input v-model="adjustForm.currentBalance" disabled />
          </el-form-item>
          <el-form-item :label="i18ns.t('balance.amount')">
            <el-input-number v-model="adjustForm.amount" style="width: 100%" />
          </el-form-item>
          <el-form-item :label="i18ns.t('balance.resultBalance')">
            <el-input-number v-model="adjustForm.resultBalance" style="width: 100%" />
          </el-form-item>
          <el-form-item :label="i18ns.t('balance.countAsStatistics')">
            <el-switch v-model="adjustForm.countAsStatistics" />
            <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px">
              {{ i18ns.t('balance.countAsStatisticsHint') }}
            </div>
          </el-form-item>
          <el-form-item :label="i18ns.t('balance.description')">
            <el-input v-model="adjustForm.description" type="textarea" :rows="3" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showAdjustDialog = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" @click="handleAdjust" :loading="adjusting">{{
            i18ns.t('confirm')
          }}</el-button>
        </template>
      </el-dialog>

      <el-dialog
        v-model="showHistoryDialog"
        :title="i18ns.t('balance.transactionHistory')"
        width="80%"
      >
        <TransactionHistory
          :transactions="allHistoryTransactions"
          :loading="loadingHistory"
          :loading-full="loadingHistory"
          :active-range-key="activeHistoryRangeKey"
          :range-actions="historyRangeActions"
          @refresh="_incrementalUpdateHistory"
          @range-action="handleHistoryRangeAction"
        />
      </el-dialog>
    </div>
  </div>
  <div v-else class="mobile-page">
    <div class="balance-mobile">
      <el-card class="mobile-card">
        <template #header>
          <span>{{ i18ns.t('balance.management') }}</span>
        </template>

        <div class="toolbar">
          <el-input
            v-model="filters.userId"
            :placeholder="i18ns.t('balance.enterUserId')"
            clearable
          />
          <div class="toolbar-actions">
            <el-button type="primary" @click="handleSearch">{{ i18ns.t('search') }}</el-button>
            <el-button @click="refreshList">{{ i18ns.t('refresh') }}</el-button>
          </div>
        </div>

        <el-skeleton :loading="loading" :rows="4" animated>
          <div v-if="users.length" class="user-list">
            <el-card
              v-for="row in users"
              :key="row.userId"
              class="user-item mobile-card"
              shadow="never"
            >
              <div class="head">
                <div class="name">{{ row.username }}</div>
                <div class="balance">{{ formatBalanceAmount(row.balance) }}</div>
              </div>
              <div class="meta">
                <div>{{ i18ns.t('balance.userId') }}: {{ row.userId }}</div>
                <div>
                  {{ i18ns.t('balance.updateTime') }}:
                  {{ new Date(row.updateTime).toLocaleString() }}
                </div>
              </div>
              <div class="actions">
                <el-button size="small" type="primary" @click="openAdjustDialog(row)">{{
                  i18ns.t('balance.adjustBalance')
                }}</el-button>
                <el-button size="small" type="info" @click="viewHistory(row)">{{
                  i18ns.t('balance.viewHistory')
                }}</el-button>
              </div>
            </el-card>
          </div>
          <el-empty v-else />
        </el-skeleton>

        <div class="pager-wrap">
          <el-pagination
            v-model:current-page="pagination.page"
            :page-size="pagination.pageSize"
            :total="pagination.total"
            layout="total, prev, pager, next"
            @current-change="loadUsers"
          />
        </div>
      </el-card>

      <el-dialog v-model="showAdjustDialog" :title="i18ns.t('balance.adjustBalance')" width="92%">
        <el-form :model="adjustForm" label-position="top">
          <el-form-item :label="i18ns.t('balance.userId')"
            ><el-input v-model="adjustForm.userId" disabled
          /></el-form-item>
          <el-form-item :label="i18ns.t('balance.currentBalance')"
            ><el-input v-model="adjustForm.currentBalance" disabled
          /></el-form-item>
          <el-form-item :label="i18ns.t('balance.amount')"
            ><el-input-number v-model="adjustForm.amount" style="width: 100%"
          /></el-form-item>
          <el-form-item :label="i18ns.t('balance.resultBalance')"
            ><el-input-number v-model="adjustForm.resultBalance" style="width: 100%"
          /></el-form-item>
          <el-form-item :label="i18ns.t('balance.countAsStatistics')">
            <el-switch v-model="adjustForm.countAsStatistics" />
          </el-form-item>
          <el-form-item :label="i18ns.t('balance.description')"
            ><el-input v-model="adjustForm.description" type="textarea" :rows="3"
          /></el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showAdjustDialog = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="adjusting" @click="handleAdjust">{{
            i18ns.t('confirm')
          }}</el-button>
        </template>
      </el-dialog>

      <el-dialog
        v-model="showHistoryDialog"
        :title="i18ns.t('balance.transactionHistory')"
        width="96%"
      >
        <TransactionHistory
          :transactions="allHistoryTransactions"
          :loading="loadingHistory"
          :loading-full="loadingHistory"
          :active-range-key="activeHistoryRangeKey"
          :range-actions="historyRangeActions"
          @refresh="_incrementalUpdateHistory"
          @range-action="handleHistoryRangeAction"
        />
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, reactive, onMounted, watch, computed } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage, ElMessageBox } from 'element-plus'
import { balanceTransactionService } from '@/service/balanceTransactionService'
import TransactionHistory from '@/components/balance/TransactionHistory.vue'
import { userService } from '@/service/userService'
import type {
  BalanceAccountResponse,
  BalanceTransactionResponse,
  UserDto,
} from '@/client/types.gen'

interface UserBalanceInfo {
  userId: string
  username: string
  balance: number
  updateTime: string
}

const loading = ref(false)
const adjusting = ref(false)
const loadingHistory = ref(false)
const showAdjustDialog = ref(false)
const showHistoryDialog = ref(false)
const users = ref<UserBalanceInfo[]>([])
const allHistoryTransactions = ref<BalanceTransactionResponse[]>([])
const activeHistoryRangeKey = ref('7d')
let lastHistoryLoadTime = ''

const filters = reactive({
  userId: '',
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
})

const adjustForm = reactive({
  userId: '',
  currentBalance: 0,
  amount: 0,
  resultBalance: 0,
  description: '',
  countAsStatistics: true,
})

let isUpdatingAmount = false
let isUpdatingResult = false

const BALANCE_AMOUNT_MAX_DECIMALS = 8

const formatBalanceAmount = (value: number): string => {
  if (!Number.isFinite(value)) return '0.00000000'
  return Number(value).toFixed(BALANCE_AMOUNT_MAX_DECIMALS)
}

watch(
  () => adjustForm.amount,
  () => {
    if (isUpdatingAmount) return
    isUpdatingResult = true
    adjustForm.resultBalance = adjustForm.currentBalance + adjustForm.amount
    isUpdatingResult = false
  },
)

watch(
  () => adjustForm.resultBalance,
  () => {
    if (isUpdatingResult) return
    isUpdatingAmount = true
    adjustForm.amount = adjustForm.resultBalance - adjustForm.currentBalance
    isUpdatingAmount = false
  },
)

let currentHistoryUserId = ''

const BALANCE_HISTORY_PAGE_SIZE = 100
const DAY_MS = 24 * 60 * 60 * 1000

type HistoryRangeKey = '1d' | '7d' | '30d' | 'all'

const historyRangeActions = computed(() => [
  { key: '1d', label: i18ns.t('balance.lastDays', { days: 1 }) },
  { key: '7d', label: i18ns.t('balance.lastDays', { days: 7 }) },
  { key: '30d', label: i18ns.t('balance.lastDays', { days: 30 }) },
  { key: 'all', label: i18ns.t('balance.loadAll') },
])

const getHistoryRangeStartTime = (rangeKey: HistoryRangeKey): string | undefined => {
  if (rangeKey === 'all') return undefined
  const dayCount = rangeKey === '1d' ? 1 : rangeKey === '7d' ? 7 : 30
  return new Date(Date.now() - dayCount * DAY_MS).toISOString()
}

const fetchAllHistoryTransactions = async (params?: {
  userId?: string
  type?: string
  model?: string
  tokenName?: string
  startTime?: string
  endTime?: string
}) => {
  const records: BalanceTransactionResponse[] = []
  let offset = 0
  let total = 0

  while (true) {
    const result = await balanceTransactionService.getAllTransactions({
      ...(params || {}),
      limit: BALANCE_HISTORY_PAGE_SIZE,
      offset,
    })

    const pageRecords = result.data?.records || []
    total = result.data?.total || 0
    records.push(...pageRecords)

    if (pageRecords.length === 0 || pageRecords.length < BALANCE_HISTORY_PAGE_SIZE) break
    if (records.length >= total) break

    offset += pageRecords.length
  }

  return records
}

const loadHistoryByRange = async (rangeKey: HistoryRangeKey) => {
  if (!currentHistoryUserId) return
  activeHistoryRangeKey.value = rangeKey
  loadingHistory.value = true
  try {
    const records = await fetchAllHistoryTransactions({
      userId: currentHistoryUserId,
      startTime: getHistoryRangeStartTime(rangeKey),
    })
    allHistoryTransactions.value = records
    if (allHistoryTransactions.value.length > 0 && allHistoryTransactions.value[0]) {
      lastHistoryLoadTime = allHistoryTransactions.value[0].createTime
    } else {
      lastHistoryLoadTime = ''
    }
  } catch (_error) {
    ElMessage.error(i18ns.t('balance.loadFailed'))
  } finally {
    loadingHistory.value = false
  }
}

const _incrementalUpdateHistory = async () => {
  if (!currentHistoryUserId || !lastHistoryLoadTime)
    return loadHistoryByRange(activeHistoryRangeKey.value as HistoryRangeKey)
  try {
    const newRecords = await fetchAllHistoryTransactions({
      userId: currentHistoryUserId,
      startTime: lastHistoryLoadTime,
    })
    if (newRecords.length > 0) {
      const recordMap = new Map(allHistoryTransactions.value.map((r) => [r.id, r]))
      newRecords.forEach((r) => recordMap.set(r.id, r))
      allHistoryTransactions.value = Array.from(recordMap.values()).sort(
        (a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime(),
      )
      if (allHistoryTransactions.value[0]) {
        lastHistoryLoadTime = allHistoryTransactions.value[0].createTime
      }
    }
  } catch (error) {
    console.error('Failed to update history:', error)
  }
}

const handleHistoryRangeAction = async (rangeKey: string) => {
  const normalizedRangeKey = rangeKey as HistoryRangeKey
  if (normalizedRangeKey === 'all') {
    try {
      await ElMessageBox.confirm(
        i18ns.t('balance.loadAllConfirm'),
        i18ns.t('balance.loadAllConfirmTitle'),
        {
          type: 'warning',
          confirmButtonText: i18ns.t('confirm'),
          cancelButtonText: i18ns.t('cancel'),
        },
      )
    } catch {
      return
    }
  }

  await loadHistoryByRange(normalizedRangeKey)
}

const loadUsers = async () => {
  loading.value = true
  try {
    const response = await userService.getAllUsers({
      page: pagination.page,
      pageSize: pagination.pageSize,
      userId: filters.userId || undefined,
    })
    const pagedUsers = response?.users || []
    pagination.total = response?.total || 0

    const userIds = pagedUsers.map((u: any) => u.id)
    const balancesRes = userIds.length
      ? await balanceTransactionService.getBatchBalances(userIds)
      : { data: [] }
    const balances = balancesRes.data
    const balanceMap = new Map<string, BalanceAccountResponse>(balances.map((b) => [b.userId, b]))

    users.value = pagedUsers.map((user: UserDto) => {
      const balanceData = balanceMap.get(user.id)
      return {
        userId: user.id,
        username: user.username,
        balance: balanceData?.balance || 0,
        updateTime: balanceData?.updateTime || new Date().toISOString(),
      }
    })
  } catch (error) {
    ElMessage.error(i18ns.t('balance.loadFailed'))
    throw error
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  pagination.page = 1
  loadUsers()
}

const refreshList = () => {
  filters.userId = ''
  pagination.page = 1
  loadUsers()
}

const openAdjustDialog = (row: any) => {
  adjustForm.userId = row.userId
  adjustForm.currentBalance = row.balance
  adjustForm.amount = 0
  adjustForm.resultBalance = row.balance
  adjustForm.description = ''
  adjustForm.countAsStatistics = true
  showAdjustDialog.value = true
}

const handleAdjust = async () => {
  if (adjustForm.amount === 0) {
    ElMessage.warning(i18ns.t('balance.adjustAmountZero'))
    return
  }

  adjusting.value = true
  try {
    await balanceTransactionService.recharge({
      userId: adjustForm.userId,
      amount: adjustForm.amount,
      description:
        adjustForm.description ||
        (adjustForm.amount > 0
          ? i18ns.t('balance.adminRecharge')
          : i18ns.t('balance.adminDeduction')),
      countAsStatistics: adjustForm.countAsStatistics,
    })

    ElMessage.success(i18ns.t('balance.adjustSuccess'))
    showAdjustDialog.value = false
    loadUsers()
  } catch (error) {
    ElMessage.error(i18ns.t('balance.adjustFailed'))
    throw error
  } finally {
    adjusting.value = false
  }
}

const viewHistory = async (row: any) => {
  currentHistoryUserId = row.userId
  lastHistoryLoadTime = ''
  allHistoryTransactions.value = []
  activeHistoryRangeKey.value = '7d'
  showHistoryDialog.value = true
  loadHistoryByRange('7d')
}

onMounted(() => {
  loadUsers()
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.balance-amount {
  font-weight: bold;
  color: #409eff;
  font-size: 16px;
}
.text-success {
  color: #67c23a;
}
.text-danger {
  color: #f56c6c;
}

.amount-positive {
  color: #67c23a;
  font-weight: 600;
}

.amount-negative {
  color: #f56c6c;
  font-weight: 600;
}

.expand-content {
  padding: 16px 50px;
  background: var(--el-fill-color-lighter);
}

.expand-section {
  padding: 12px;
  background: var(--el-bg-color);
  border-radius: 6px;
  margin-bottom: 12px;
}

.expand-section:last-child {
  margin-bottom: 0;
}

.calc-detail {
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
  display: flex;
  align-items: center;
  gap: 8px;
}

.calc-label {
  color: var(--el-text-color-secondary);
  font-weight: 500;
  min-width: 80px;
}

.calc-value {
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.calc-formula {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-family: monospace;
  color: var(--el-color-primary);
  border-left: 3px solid var(--el-color-primary);
}

.timing-metrics {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.metric-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.metric-value {
  color: var(--el-color-primary);
  font-weight: 600;
  font-family: monospace;
}

@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }

  .history-filter-section {
    flex-direction: column;
    align-items: stretch;
  }

  .history-filter-section > * {
    width: 100% !important;
    max-width: 100% !important;
    margin-left: 0 !important;
  }
}

@media (max-width: 480px) {
  .balance-management .el-form--inline {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .balance-management .el-form--inline .el-form-item {
    margin-right: 0;
    width: 100%;
  }
  .balance-management .el-form--inline .el-form-item__content {
    width: 100%;
  }
  .balance-management .el-input {
    width: 100% !important;
  }
}
</style>

<style scoped>
.balance-mobile {
  padding: 8px 6px 16px;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.toolbar :deep(.el-input),
.toolbar :deep(.el-select),
.toolbar :deep(.el-date-editor) {
  width: 100% !important;
  max-width: 100% !important;
}

.toolbar :deep(.el-button) {
  width: 100%;
  min-height: 36px;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  width: 100%;
}

.toolbar-actions .el-button {
  flex: 1;
}

.user-list,
.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-item,
.history-item {
  border: 1px solid var(--el-border-color-lighter);
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.name {
  font-weight: 600;
}

.balance {
  color: #409eff;
  font-weight: 700;
}

.meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}

.actions .el-button {
  flex: 1;
  min-height: 34px;
}

.pager-wrap {
  margin-top: 12px;
  display: flex;
  justify-content: center;
}

.history-dialog-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--el-color-warning-light-9) 78%, transparent);
  border: 1px solid var(--el-color-warning-light-5);
}

.history-dialog-hint__badge {
  min-width: 24px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--el-color-warning);
  color: var(--el-color-white);
  font-size: 12px;
  font-weight: 700;
}

.history-dialog-hint__text {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.balance-mobile :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.balance-mobile :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.balance-mobile :deep(.el-dialog__footer .el-button) {
  min-height: 36px;
}

.details-collapse {
  margin-top: 8px;
}

.details-collapse :deep(.el-collapse-item__header) {
  min-height: 38px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  padding: 0 10px;
  background: var(--el-fill-color-light);
}

.detail-grid {
  margin-top: 6px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.detail-grid > div {
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  font-size: 12px;
  line-height: 1.35;
  color: var(--el-text-color-regular);
}

.formula {
  margin-top: 10px;
  padding: 10px;
  border-radius: 8px;
  border: 1px dashed var(--el-border-color);
  background: var(--el-fill-color-blank);
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.5;
  word-break: break-word;
}

:global(.mobile-daterange-popper) {
  max-width: 92vw !important;
  left: 4vw !important;
  transform: none !important;
}

:global(.mobile-daterange-popper .el-picker-panel) {
  width: 100% !important;
  min-width: auto !important;
}

:global(.mobile-daterange-popper .el-picker-panel__body-wrapper) {
  display: flex;
  flex-direction: column;
}

:global(.mobile-daterange-popper .el-date-range-picker__content) {
  width: 100%;
}

:global(.mobile-daterange-popper .el-date-range-picker__content.is-left) {
  border-right: 0;
}

:global(.mobile-daterange-popper .el-date-table td) {
  padding: 2px 0;
}

:global(.mobile-daterange-popper .el-date-table-cell) {
  height: 28px;
  line-height: 28px;
}

:global(.mobile-daterange-popper .el-date-range-picker__time-header) {
  font-size: 12px;
}

:global(.mobile-daterange-popper .el-time-spinner__item) {
  height: 28px;
  line-height: 28px;
}

@media (max-width: 420px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
