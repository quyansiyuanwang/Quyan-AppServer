<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="balance-container">
      <el-card
        class="info-card page-card"
        v-loading="loadingStats"
        :element-loading-text="loadingStats ? i18ns.t('relay.firstLoadTip') : ''"
      >
        <div class="card-header-section">
          <el-row :gutter="20" align="middle">
            <el-col :xs="24" :sm="12" :md="10">
              <div class="balance-info">
                <span class="balance-label">
                  <el-icon><Wallet /></el-icon>
                  {{ i18ns.t('relay.accountBalance') }}
                  <el-button
                    :icon="Refresh"
                    :loading="refreshingBalance"
                    @click="refreshBalanceAndStats"
                    size="small"
                    class="balance-refresh-btn"
                  >
                    {{ i18ns.t('refresh') }}
                  </el-button>
                </span>
                <span class="balance-amount">{{ userInfoStore.userInfo.balance ?? 0 }}</span>
              </div>
            </el-col>
            <el-col :xs="24" :sm="12" :md="14">
              <el-form inline class="redeem-form toolbar-row">
                <el-form-item :label="i18ns.t('redemption.code')" style="margin-bottom: 0">
                  <el-input
                    v-model="redeemCode"
                    :placeholder="i18ns.t('redemption.enterCode')"
                    style="width: 100%; max-width: 240px"
                    clearable
                  />
                </el-form-item>
                <el-form-item style="margin-bottom: 0">
                  <el-button type="primary" @click="handleRedeem" :loading="redeeming">
                    {{ i18ns.t('redemption.redeem') }}
                  </el-button>
                </el-form-item>
              </el-form>
            </el-col>
          </el-row>
        </div>

        <el-divider />

        <div class="statistics-section">
          <el-row :gutter="16" class="stats-row">
            <el-col :xs="24" :sm="12" :md="6">
              <div class="stat-item">
                <div class="stat-content">
                  <div class="stat-info">
                    <span class="stat-label">{{ i18ns.t('balance.usedQuota') }}</span>
                    <span class="stat-value">{{ usageStats.used }}</span>
                    <span class="stat-total">/ {{ usageStats.total }}</span>
                  </div>
                  <div class="stat-chart">
                    <el-progress
                      type="circle"
                      :percentage="
                        Math.round(
                          usageStats.total > 0 ? (usageStats.used / usageStats.total) * 100 : 0,
                        )
                      "
                      :width="60"
                      :stroke-width="6"
                    />
                  </div>
                </div>
              </div>
            </el-col>
            <el-col :xs="24" :sm="12" :md="6">
              <div class="stat-item" v-loading="loadingAllData">
                <div class="stat-content">
                  <div class="stat-info">
                    <span class="stat-label">{{ i18ns.t('balance.totalRequests') }}</span>
                    <span class="stat-value">{{ requestCount }}</span>
                  </div>
                  <div class="stat-chart">
                    <v-chart
                      v-if="showCharts"
                      :option="requestsChartOption"
                      style="height: 60px; width: 100%"
                    />
                  </div>
                </div>
              </div>
            </el-col>
            <el-col :xs="24" :sm="12" :md="6">
              <div class="stat-item" v-loading="loadingAllData">
                <div class="stat-content">
                  <div class="stat-info">
                    <span class="stat-label">{{ i18ns.t('balance.avgTPM') }}</span>
                    <span class="stat-value">{{ avgTPM.toFixed(2) }}</span>
                  </div>
                  <div class="stat-chart">
                    <v-chart
                      v-if="showCharts"
                      :option="tpmChartOption"
                      style="height: 60px; width: 100%"
                    />
                  </div>
                </div>
              </div>
            </el-col>
            <el-col :xs="24" :sm="12" :md="6">
              <div class="stat-item" v-loading="loadingAllData">
                <div class="stat-content">
                  <div class="stat-info">
                    <span class="stat-label">{{ i18ns.t('balance.avgRPM') }}</span>
                    <span class="stat-value">{{ avgRPM.toFixed(2) }}</span>
                  </div>
                  <div class="stat-chart">
                    <v-chart
                      v-if="showCharts"
                      :option="rpmChartOption"
                      style="height: 60px; width: 100%"
                    />
                  </div>
                </div>
              </div>
            </el-col>
          </el-row>
        </div>
      </el-card>

      <el-card class="transaction-card page-card">
        <ComponentErrorBoundary>
          <TransactionHistory
            :transactions="allTransactions"
            :loading="loading"
            :loading-full="loadingAllData"
            :range-hint="historyRangeHint"
            :range-slider="historyRangeSlider"
            @refresh="incrementalUpdateTransactions"
            @range-slider-change="handleHistorySliderChange"
          />
        </ComponentErrorBoundary>
      </el-card>
    </div>
  </div>
  <div v-else class="mobile-page">
    <div>
      <div class="balance-container">
        <el-card
          class="info-card mobile-card"
          v-loading="loadingStats"
          :element-loading-text="loadingStats ? i18ns.t('relay.firstLoadTip') : ''"
        >
          <div class="card-header-section">
            <el-row :gutter="20" align="middle">
              <el-col :xs="24" :sm="12" :md="10">
                <div class="balance-info">
                  <span class="balance-label">
                    <el-icon><Wallet /></el-icon>
                    {{ i18ns.t('relay.accountBalance') }}
                    <el-button
                      :icon="Refresh"
                      :loading="refreshingBalance"
                      @click="refreshBalanceAndStats"
                      size="small"
                      class="balance-refresh-btn"
                    >
                      {{ i18ns.t('refresh') }}
                    </el-button>
                  </span>
                  <span class="balance-amount">{{ userInfoStore.userInfo.balance ?? 0 }}</span>
                </div>
              </el-col>
              <el-col :xs="24" :sm="12" :md="14">
                <el-form inline class="redeem-form toolbar-row">
                  <el-form-item :label="i18ns.t('redemption.code')" style="margin-bottom: 0">
                    <el-input
                      v-model="redeemCode"
                      :placeholder="i18ns.t('redemption.enterCode')"
                      style="width: 100%; max-width: 240px"
                      clearable
                    />
                  </el-form-item>
                  <el-form-item style="margin-bottom: 0">
                    <el-button type="primary" @click="handleRedeem" :loading="redeeming">
                      {{ i18ns.t('redemption.redeem') }}
                    </el-button>
                  </el-form-item>
                </el-form>
              </el-col>
            </el-row>
          </div>

          <el-divider />

          <div class="statistics-section">
            <el-row :gutter="16" class="stats-row">
              <el-col :xs="24" :sm="12" :md="6">
                <div class="stat-item">
                  <div class="stat-content">
                    <div class="stat-info">
                      <span class="stat-label">{{ i18ns.t('balance.usedQuota') }}</span>
                      <span class="stat-value">{{ usageStats.used }}</span>
                      <span class="stat-total">/ {{ usageStats.total }}</span>
                    </div>
                    <div class="stat-chart">
                      <el-progress
                        type="circle"
                        :percentage="
                          Math.round(
                            usageStats.total > 0 ? (usageStats.used / usageStats.total) * 100 : 0,
                          )
                        "
                        :width="60"
                        :stroke-width="6"
                      />
                    </div>
                  </div>
                </div>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
                <div class="stat-item" v-loading="loadingAllData">
                  <div class="stat-content">
                    <div class="stat-info">
                      <span class="stat-label">{{ i18ns.t('balance.totalRequests') }}</span>
                      <span class="stat-value">{{ requestCount }}</span>
                    </div>
                    <div class="stat-chart" v-if="showCharts">
                      <v-chart :option="requestsChartOption" style="height: 60px; width: 100%" />
                    </div>
                  </div>
                </div>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
                <div class="stat-item" v-loading="loadingAllData">
                  <div class="stat-content">
                    <div class="stat-info">
                      <span class="stat-label">{{ i18ns.t('balance.avgTPM') }}</span>
                      <span class="stat-value">{{ avgTPM.toFixed(2) }}</span>
                    </div>
                    <div class="stat-chart" v-if="showCharts">
                      <v-chart :option="tpmChartOption" style="height: 60px; width: 100%" />
                    </div>
                  </div>
                </div>
              </el-col>
              <el-col :xs="24" :sm="12" :md="6">
                <div class="stat-item" v-loading="loadingAllData">
                  <div class="stat-content">
                    <div class="stat-info">
                      <span class="stat-label">{{ i18ns.t('balance.avgRPM') }}</span>
                      <span class="stat-value">{{ avgRPM.toFixed(2) }}</span>
                    </div>
                    <div class="stat-chart" v-if="showCharts">
                      <v-chart :option="rpmChartOption" style="height: 60px; width: 100%" />
                    </div>
                  </div>
                </div>
              </el-col>
            </el-row>
          </div>
        </el-card>

        <el-card class="transaction-card mobile-card">
          <ComponentErrorBoundary>
            <TransactionHistory
              :transactions="allTransactions"
              :loading="loading"
              :loading-full="loadingAllData"
              :range-hint="historyRangeHint"
              :range-slider="historyRangeSlider"
              @refresh="incrementalUpdateTransactions"
              @range-slider-change="handleHistorySliderChange"
            />
          </ComponentErrorBoundary>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, onMounted, computed, watch, shallowRef } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Wallet, Refresh } from '@element-plus/icons-vue'
import { balanceTransactionService } from '@/service/balanceTransactionService'
import { redemptionCodeService } from '@/service/redemptionCodeService'
import { useUserInfoStore } from '@/stores/userInfoStore'
import type { BalanceTransactionResponse } from '@/client/types.gen'
import ComponentErrorBoundary from '@/components/common/ComponentErrorBoundary.vue'
import TransactionHistory from '@/components/balance/TransactionHistory.vue'
import { sessionDB, STORE_NAMES } from '@/utils/sessionDB'
import { isApiUsageRecord, isChargeableApiUsageRecord } from '@/utils/balance-transaction'
import { AsyncVChart as VChart } from '@/utils/asyncChart'
const { isDesktop } = usePageDevice()
const userInfoStore = useUserInfoStore()

const loading = ref(false)
const loadingStats = ref(false)
const loadingAllData = ref(false)
const refreshingBalance = ref(false)
const redeeming = ref(false)
const showCharts = ref(false)
const redeemCode = ref('')
const allTransactions = shallowRef<BalanceTransactionResponse[]>([])
const cachedApiUsageTransactions = shallowRef<BalanceTransactionResponse[]>([])
const cachedSortedTransactions = shallowRef<BalanceTransactionResponse[]>([])
const _lastLoadTime = ref<string | null>(null)
const activeHistoryRangeKey = ref<HistoryRangeKey>('1d')
const BALANCE_HISTORY_PAGE_SIZE = 100
const DAY_MS = 24 * 60 * 60 * 1000
const BALANCE_HISTORY_PREVIEW_LIMIT = 100
const DEFAULT_HISTORY_RANGE_LEVEL = 0
const BALANCE_HISTORY_ALL_COMPLETE_META_KEY = 'balance-history:all-complete'

type HistoryRangeKey = '1d' | '7d' | '30d' | 'all'
type HistoryRangeCacheEntry = {
  records: BalanceTransactionResponse[]
  complete: boolean
}

const HISTORY_RANGE_LEVELS = [
  { value: 0, key: '1d' as const, label: () => i18ns.t('balance.lastDays', { days: 1 }) },
  { value: 1, key: '7d' as const, label: () => i18ns.t('balance.lastDays', { days: 7 }) },
  { value: 2, key: '30d' as const, label: () => i18ns.t('balance.lastDays', { days: 30 }) },
  { value: 3, key: 'all' as const, label: () => i18ns.t('balance.loadAll') },
] as const

let historyLoadToken = 0
const historyRangeCache: Record<HistoryRangeKey, HistoryRangeCacheEntry> = {
  '1d': { records: [], complete: false },
  '7d': { records: [], complete: false },
  '30d': { records: [], complete: false },
  all: { records: [], complete: false },
}

const historyRangeLevel = ref(DEFAULT_HISTORY_RANGE_LEVEL)

const historyRangeHint = computed(() => {
  if (historyRangeCache.all.complete) return i18ns.t('balance.loadAllCached')
  return ''
})

const historyRangeSlider = computed(() => {
  const minLevel = historyRangeLevel.value
  return {
    value: historyRangeLevel.value,
    min: HISTORY_RANGE_LEVELS[0]?.value ?? 0,
    max: HISTORY_RANGE_LEVELS[HISTORY_RANGE_LEVELS.length - 1]?.value ?? 3,
    lockedMin: minLevel,
    marks: Object.fromEntries(
      HISTORY_RANGE_LEVELS.map((item) => [
        item.value,
        {
          label: item.label(),
          style: item.value < minLevel ? { color: 'var(--el-text-color-placeholder)' } : undefined,
        },
      ]),
    ),
  }
})

const getRangeKeyByLevel = (value: number): HistoryRangeKey =>
  HISTORY_RANGE_LEVELS.find((item) => item.value === value)?.key ?? '7d'

const getRangeLevelByKey = (rangeKey: HistoryRangeKey): number =>
  HISTORY_RANGE_LEVELS.find((item) => item.key === rangeKey)?.value ?? 1

const loadSessionHistoryAllComplete = async (): Promise<boolean> =>
  (await sessionDB.getItem<boolean>(
    STORE_NAMES.SESSION_META,
    BALANCE_HISTORY_ALL_COMPLETE_META_KEY,
  )) === true

const persistHistoryAllComplete = async (value: boolean) => {
  if (value) {
    await sessionDB.setItem(STORE_NAMES.SESSION_META, BALANCE_HISTORY_ALL_COMPLETE_META_KEY, true)
    return
  }
  await sessionDB.removeItem(STORE_NAMES.SESSION_META, BALANCE_HISTORY_ALL_COMPLETE_META_KEY)
}

const getHistoryRangeStartTime = (rangeKey: HistoryRangeKey): string | undefined => {
  if (rangeKey === 'all') return undefined
  const dayCount = rangeKey === '1d' ? 1 : rangeKey === '7d' ? 7 : 30
  return new Date(Date.now() - dayCount * DAY_MS).toISOString()
}

const getHistoryRangeStartTimestamp = (rangeKey: HistoryRangeKey): number | null => {
  const startTime = getHistoryRangeStartTime(rangeKey)
  if (!startTime) return null

  const timestamp = new Date(startTime).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

const usageStats = ref({
  total: 0,
  used: 0,
  remaining: 0,
})

const getTransactionTimestamp = (record: BalanceTransactionResponse): number => {
  const timestamp = new Date(record.createTime).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

const sortByCreateTimeDesc = (records: BalanceTransactionResponse[]) =>
  [...records].sort((a, b) => getTransactionTimestamp(b) - getTransactionTimestamp(a))

const filterTransactionsByRange = (
  records: BalanceTransactionResponse[],
  rangeKey: HistoryRangeKey,
): BalanceTransactionResponse[] => {
  const startTimestamp = getHistoryRangeStartTimestamp(rangeKey)
  if (startTimestamp == null) return records

  return records.filter((record) => getTransactionTimestamp(record) >= startTimestamp)
}

const setRangeCache = (
  rangeKey: HistoryRangeKey,
  records: BalanceTransactionResponse[],
  complete: boolean,
) => {
  historyRangeCache[rangeKey] = {
    records: sortByCreateTimeDesc(records),
    complete,
  }

  if (complete) {
    const level = getRangeLevelByKey(rangeKey)
    if (level > historyRangeLevel.value) {
      historyRangeLevel.value = level
    }

    if (rangeKey === 'all') {
      void persistHistoryAllComplete(true)
    }
  }

  if (rangeKey !== 'all' || !complete) return
  ;(['1d', '7d', '30d'] as const).forEach((key) => {
    historyRangeCache[key] = {
      records: sortByCreateTimeDesc(filterTransactionsByRange(records, key)),
      complete: true,
    }
  })
}

const getRangeCacheSnapshot = (rangeKey: HistoryRangeKey): HistoryRangeCacheEntry | null => {
  const directCache = historyRangeCache[rangeKey]
  if (directCache.records.length > 0) return directCache

  if (
    rangeKey !== 'all' &&
    historyRangeCache.all.complete &&
    historyRangeCache.all.records.length > 0
  ) {
    const derivedRecords = sortByCreateTimeDesc(
      filterTransactionsByRange(historyRangeCache.all.records, rangeKey),
    )
    setRangeCache(rangeKey, derivedRecords, true)
    return historyRangeCache[rangeKey]
  }

  return null
}

const detectAvailableRangeLevelFromRecords = (
  records: BalanceTransactionResponse[],
  hasAllComplete: boolean,
): number => {
  if (records.length === 0) return DEFAULT_HISTORY_RANGE_LEVEL
  if (hasAllComplete) return 3

  const oldestTimestamp = getTransactionTimestamp(records[records.length - 1] ?? records[0]!)
  if (oldestTimestamp <= Date.now() - 30 * DAY_MS) return 2
  if (oldestTimestamp <= Date.now() - 7 * DAY_MS) return 1
  return 0
}

const detectAvailableRangeLevelFromCache = (): number => {
  if (historyRangeCache.all.complete && historyRangeCache.all.records.length > 0) return 3
  if (historyRangeCache['30d'].records.length > 0) return 2
  if (historyRangeCache['7d'].records.length > 0) return 1
  if (historyRangeCache['1d'].records.length > 0) return 0
  return DEFAULT_HISTORY_RANGE_LEVEL
}

const syncHistoryRangeLevelFromCache = () => {
  const detectedLevel = detectAvailableRangeLevelFromCache()
  if (detectedLevel > historyRangeLevel.value) {
    historyRangeLevel.value = detectedLevel
  }
}

const primeHistoryRangeCacheFromSession = async (): Promise<number> => {
  try {
    const cachedRecords = sortByCreateTimeDesc(
      await sessionDB.getAllByIndex<BalanceTransactionResponse>(
        STORE_NAMES.BALANCE_TRANSACTIONS,
        'createTime',
        'prev',
      ),
    )

    if (cachedRecords.length === 0) {
      await persistHistoryAllComplete(false)
      const fallbackLevel = DEFAULT_HISTORY_RANGE_LEVEL
      historyRangeLevel.value = fallbackLevel
      return fallbackLevel
    }

    const hasAllComplete = await loadSessionHistoryAllComplete()
    const detectedLevel = detectAvailableRangeLevelFromRecords(cachedRecords, hasAllComplete)

    if (hasAllComplete) {
      setRangeCache('all', cachedRecords, true)
    } else {
      HISTORY_RANGE_LEVELS.filter((item) => item.value <= detectedLevel).forEach((item) => {
        const rangeRecords = filterTransactionsByRange(cachedRecords, item.key)
        if (rangeRecords.length === 0) return

        setRangeCache(item.key, rangeRecords, true)
      })
    }

    historyRangeLevel.value = detectedLevel
    return detectedLevel
  } catch (error) {
    console.error('Failed to inspect cached balance history:', error)
    const fallbackLevel = DEFAULT_HISTORY_RANGE_LEVEL
    historyRangeLevel.value = fallbackLevel
    return fallbackLevel
  }
}

const mergeSortedTransactionsDesc = (
  preferredRecords: BalanceTransactionResponse[],
  fallbackRecords: BalanceTransactionResponse[],
): BalanceTransactionResponse[] => {
  if (preferredRecords.length === 0) return fallbackRecords
  if (fallbackRecords.length === 0) return preferredRecords

  const merged: BalanceTransactionResponse[] = []
  const seenIds = new Set<string>()
  let preferredIndex = 0
  let fallbackIndex = 0

  const pushIfNeeded = (record: BalanceTransactionResponse | undefined) => {
    if (!record || seenIds.has(record.id)) return
    seenIds.add(record.id)
    merged.push(record)
  }

  while (preferredIndex < preferredRecords.length || fallbackIndex < fallbackRecords.length) {
    const preferredRecord = preferredRecords[preferredIndex]
    const fallbackRecord = fallbackRecords[fallbackIndex]

    if (
      !fallbackRecord ||
      (preferredRecord &&
        getTransactionTimestamp(preferredRecord) >= getTransactionTimestamp(fallbackRecord))
    ) {
      pushIfNeeded(preferredRecord)
      preferredIndex += 1
      continue
    }

    pushIfNeeded(fallbackRecord)
    fallbackIndex += 1
  }

  return merged
}

const isHistoryLoadCurrent = (rangeKey: HistoryRangeKey, loadToken: number): boolean =>
  activeHistoryRangeKey.value === rangeKey && historyLoadToken === loadToken

const applyTransactions = (
  records: BalanceTransactionResponse[],
  rangeKey: HistoryRangeKey,
): BalanceTransactionResponse[] => {
  const sorted = sortByCreateTimeDesc(filterTransactionsByRange(records, rangeKey))
  allTransactions.value = sorted
  _lastLoadTime.value = sorted[0]?.createTime ?? null
  showCharts.value = true
  return sorted
}

const mergeRecordsIntoCache = (records: BalanceTransactionResponse[]) => {
  if (records.length === 0) return
  ;(['all', '30d', '7d', '1d'] as const).forEach((rangeKey) => {
    if (!historyRangeCache[rangeKey].complete) return

    const filteredRecords = sortByCreateTimeDesc(filterTransactionsByRange(records, rangeKey))
    if (filteredRecords.length === 0) return

    historyRangeCache[rangeKey] = {
      records: mergeSortedTransactionsDesc(filteredRecords, historyRangeCache[rangeKey].records),
      complete: true,
    }
  })
}

const fetchAllTransactions = async (params?: {
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
    const result = await balanceTransactionService.getMyTransactions({
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

const getCachedTransactionPreview = async (
  rangeKey: HistoryRangeKey,
): Promise<BalanceTransactionResponse[]> => {
  const recent = await sessionDB.getRecent<BalanceTransactionResponse>(
    STORE_NAMES.BALANCE_TRANSACTIONS,
    BALANCE_HISTORY_PREVIEW_LIMIT,
  )
  return sortByCreateTimeDesc(filterTransactionsByRange(recent, rangeKey))
}

const hydrateTransactionsFromCache = async (
  rangeKey: HistoryRangeKey,
  loadToken: number,
): Promise<void> => {
  const cached = await sessionDB.getAllByIndex<BalanceTransactionResponse>(
    STORE_NAMES.BALANCE_TRANSACTIONS,
    'createTime',
    'prev',
  )

  if (!isHistoryLoadCurrent(rangeKey, loadToken)) return

  const filteredCached = sortByCreateTimeDesc(filterTransactionsByRange(cached, rangeKey))
  if (filteredCached.length === 0) return

  if (allTransactions.value.length === 0) {
    applyTransactions(filteredCached, rangeKey)
    setRangeCache(rangeKey, filteredCached, false)
    syncHistoryRangeLevelFromCache()
    return
  }

  const mergedTransactions = mergeSortedTransactionsDesc(allTransactions.value, filteredCached)
  allTransactions.value = mergedTransactions
  _lastLoadTime.value = mergedTransactions[0]?.createTime ?? _lastLoadTime.value
  setRangeCache(rangeKey, mergedTransactions, false)
  syncHistoryRangeLevelFromCache()
}

const fetchAndApplyRangeTransactions = async (
  rangeKey: HistoryRangeKey,
  loadToken: number,
): Promise<void> => {
  const records = await fetchAllTransactions({
    startTime: getHistoryRangeStartTime(rangeKey),
  })

  if (!isHistoryLoadCurrent(rangeKey, loadToken)) return

  const sortedRecords = applyTransactions(records, rangeKey)
  setRangeCache(rangeKey, sortedRecords, true)
  syncHistoryRangeLevelFromCache()
  await sessionDB.save(STORE_NAMES.BALANCE_TRANSACTIONS, sortedRecords)
}

const updateCache = (transactions: BalanceTransactionResponse[]) => {
  const chargeableApiUsage: BalanceTransactionResponse[] = []
  const apiUsageDescending: BalanceTransactionResponse[] = []

  transactions.forEach((tx) => {
    if (!isApiUsageRecord(tx)) return

    apiUsageDescending.push(tx)
    if (isChargeableApiUsageRecord(tx)) {
      chargeableApiUsage.push(tx)
    }
  })

  cachedApiUsageTransactions.value = chargeableApiUsage
  cachedSortedTransactions.value = [...apiUsageDescending].reverse()
}

watch(allTransactions, (transactions) => updateCache(transactions), { immediate: true })

const requestCount = computed(() => cachedApiUsageTransactions.value.length)

const timePeriodMinutes = computed(() => {
  if (cachedSortedTransactions.value.length === 0) return 1

  const firstTime = new Date(cachedSortedTransactions.value[0]!.createTime).getTime()
  const lastTime = new Date(
    cachedSortedTransactions.value[cachedSortedTransactions.value.length - 1]!.createTime,
  ).getTime()

  return Math.max((lastTime - firstTime) / 60000, 1)
})

const avgTPM = computed(() => {
  if (cachedApiUsageTransactions.value.length === 0) return 0

  const totalTokens = cachedApiUsageTransactions.value.reduce(
    (sum, tx) => sum + (tx.inputTokens || 0) + (tx.outputTokens || 0),
    0,
  )

  return totalTokens / timePeriodMinutes.value
})

const avgRPM = computed(() => requestCount.value / timePeriodMinutes.value)

const requestsChartOption = computed(() => {
  const requestData = cachedApiUsageTransactions.value.map((t) => Math.abs(Number(t.amount)))
  return {
    grid: { left: 0, right: 0, top: 5, bottom: 0 },
    xAxis: { type: 'category', show: false, data: requestData.map((_, i) => i) },
    yAxis: { type: 'value', show: false },
    series: [
      {
        type: 'bar',
        data: requestData,
        itemStyle: { color: '#409eff', borderRadius: [4, 4, 0, 0] },
        barWidth: '60%',
      },
    ],
  }
})

const tpmChartOption = computed(() => {
  const tpmData = cachedApiUsageTransactions.value.map(
    (t) => (t.inputTokens || 0) + (t.outputTokens || 0),
  )
  return {
    grid: { left: 0, right: 0, top: 5, bottom: 0 },
    xAxis: { type: 'category', show: false, data: tpmData.map((_, i) => i) },
    yAxis: { type: 'value', show: false },
    series: [
      {
        type: 'line',
        data: tpmData,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#67c23a', width: 2 },
        areaStyle: { color: 'rgba(103, 194, 58, 0.2)' },
      },
    ],
  }
})

const rpmChartOption = computed(() => {
  const rpmByMinute = new Map<number, number>()
  cachedApiUsageTransactions.value.forEach((t) => {
    const minuteTimestamp = Math.floor(new Date(t.createTime).getTime() / 60000) * 60000
    rpmByMinute.set(minuteTimestamp, (rpmByMinute.get(minuteTimestamp) || 0) + 1)
  })
  const sortedMinutes = Array.from(rpmByMinute.keys()).sort((a, b) => a - b)
  const rpmData = sortedMinutes.map((minute) => rpmByMinute.get(minute) || 0)
  return {
    grid: { left: 0, right: 0, top: 5, bottom: 0 },
    xAxis: { type: 'category', show: false, data: sortedMinutes.map((_, i) => i) },
    yAxis: { type: 'value', show: false },
    series: [
      {
        type: 'line',
        data: rpmData,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#e6a23c', width: 2 },
        areaStyle: { color: 'rgba(230, 162, 60, 0.2)' },
      },
    ],
  }
})

const handleRedeem = async () => {
  if (!redeemCode.value.trim()) return
  redeeming.value = true
  try {
    const result = await redemptionCodeService.redeemCode(redeemCode.value.trim())
    if (result.code !== 0) {
      ElMessage.error(i18ns.t('redemption.redeemFailed'))
      throw new Error(result.message)
    }
    ElMessage.success(i18ns.t('redemption.redeemSuccess'))
    userInfoStore.setUserInfo({ balance: result.data?.balance })
    redeemCode.value = ''
    // 触发增量加载
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('redemption.redeemFailed'))
  } finally {
    redeeming.value = false
  }
}

const loadUsageStats = async () => {
  loadingStats.value = true
  try {
    const result = await balanceTransactionService.getUsageStatistics()
    if (result.data) {
      usageStats.value = {
        total: result.data.total || 0,
        used: result.data.used || 0,
        remaining: result.data.remaining || 0,
      }
    }
  } catch (e: any) {
    ElMessage.error(e.message || i18ns.t('balance.loadFailed'))
  } finally {
    loadingStats.value = false
  }
}

const incrementalUpdateTransactions = async (options?: {
  rangeKey?: HistoryRangeKey
  loadToken?: number
}) => {
  const rangeKey = options?.rangeKey ?? activeHistoryRangeKey.value
  const loadToken = options?.loadToken

  if (!_lastLoadTime.value || allTransactions.value.length === 0)
    return loadTransactionsByRange(rangeKey)

  try {
    const latestTime = allTransactions.value[0]?.createTime
    if (!latestTime) return

    const newRecords = await fetchAllTransactions({
      startTime: latestTime,
    })
    if (newRecords.length > 0) {
      const existingIds = new Set(allTransactions.value.map((record) => record.id))
      const uniqueNew = newRecords.filter((record) => !existingIds.has(record.id))
      if (uniqueNew.length > 0) {
        const filteredUniqueNew = filterTransactionsByRange(uniqueNew, rangeKey)
        if (loadToken != null && !isHistoryLoadCurrent(rangeKey, loadToken)) return

        const sortedUniqueNew = sortByCreateTimeDesc(filteredUniqueNew)
        allTransactions.value = mergeSortedTransactionsDesc(sortedUniqueNew, allTransactions.value)
        _lastLoadTime.value = allTransactions.value[0]?.createTime || _lastLoadTime.value
        setRangeCache(rangeKey, allTransactions.value, historyRangeCache[rangeKey].complete)
        mergeRecordsIntoCache(uniqueNew)
        syncHistoryRangeLevelFromCache()
        await sessionDB.save(STORE_NAMES.BALANCE_TRANSACTIONS, uniqueNew)
      }
    }
  } catch (e: any) {
    console.error('Failed to update transactions:', e)
  }
}

const loadTransactionsByRange = async (
  rangeKey: HistoryRangeKey,
  options?: {
    preferCache?: boolean
    forceNetworkFull?: boolean
  },
) => {
  historyRangeLevel.value = getRangeLevelByKey(rangeKey)
  const preferCache = options?.preferCache ?? true
  const forceNetworkFull = options?.forceNetworkFull ?? false
  activeHistoryRangeKey.value = rangeKey
  const loadToken = ++historyLoadToken
  loading.value = true
  loadingAllData.value = true

  const memorySnapshot = getRangeCacheSnapshot(rangeKey)
  if (memorySnapshot && memorySnapshot.records.length > 0) {
    applyTransactions(memorySnapshot.records, rangeKey)
    loading.value = false

    const backgroundTasks: Promise<unknown>[] = [
      incrementalUpdateTransactions({ rangeKey, loadToken }),
    ]

    if (!memorySnapshot.complete) {
      backgroundTasks.push(hydrateTransactionsFromCache(rangeKey, loadToken))
      if (forceNetworkFull)
        backgroundTasks.push(fetchAndApplyRangeTransactions(rangeKey, loadToken))
    }

    Promise.allSettled(backgroundTasks)
      .catch((error) => {
        console.error('Failed to hydrate balance history from memory cache:', error)
      })
      .finally(() => {
        if (isHistoryLoadCurrent(rangeKey, loadToken)) {
          loadingAllData.value = false
        }
      })
    return
  }

  if (preferCache) {
    try {
      const preview = await getCachedTransactionPreview(rangeKey)
      if (!isHistoryLoadCurrent(rangeKey, loadToken)) return

      if (preview.length > 0) {
        applyTransactions(preview, rangeKey)
        setRangeCache(rangeKey, preview, false)
        loading.value = false

        const backgroundTasks: Promise<unknown>[] = [
          incrementalUpdateTransactions({ rangeKey, loadToken }),
          hydrateTransactionsFromCache(rangeKey, loadToken),
        ]

        if (forceNetworkFull)
          backgroundTasks.push(fetchAndApplyRangeTransactions(rangeKey, loadToken))

        Promise.allSettled(backgroundTasks)
          .catch((error) => {
            console.error('Failed to hydrate balance history in background:', error)
          })
          .finally(() => {
            if (isHistoryLoadCurrent(rangeKey, loadToken)) {
              loadingAllData.value = false
            }
          })
        return
      }
    } catch (e) {
      console.error('Failed to load balance history preview from cache:', e)
    }
  }

  try {
    await fetchAndApplyRangeTransactions(rangeKey, loadToken)
  } catch (e: any) {
    ElMessage.error(e.message || i18ns.t('balance.loadFailed'))
    console.error('Failed to load transactions:', e)
  } finally {
    if (isHistoryLoadCurrent(rangeKey, loadToken)) {
      loading.value = false
      loadingAllData.value = false
    }
  }
}

const handleHistorySliderChange = async (value: number) => {
  const targetRangeKey = getRangeKeyByLevel(value)
  const currentLevel = getRangeLevelByKey(activeHistoryRangeKey.value)

  if (value <= currentLevel) {
    historyRangeLevel.value = currentLevel
    return
  }

  if (
    targetRangeKey === 'all' &&
    historyRangeCache.all.complete &&
    historyRangeCache.all.records.length > 0
  ) {
    await loadTransactionsByRange('all', { preferCache: true, forceNetworkFull: false })
    return
  }

  if (targetRangeKey === 'all') {
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
      historyRangeLevel.value = currentLevel
      return
    }
  }

  await loadTransactionsByRange(targetRangeKey, { preferCache: true, forceNetworkFull: true })
}

const refreshBalanceAndStats = async () => {
  refreshingBalance.value = true
  try {
    const result = await balanceTransactionService.getMyBalance()
    userInfoStore.setUserInfo({ balance: result.data?.balance })
  } catch (e: any) {
    ElMessage.error(e.message || i18ns.t('relay.loadFailed'))
  } finally {
    refreshingBalance.value = false
  }
}

onMounted(async () => {
  historyRangeLevel.value = DEFAULT_HISTORY_RANGE_LEVEL
  const initialLevel = await primeHistoryRangeCacheFromSession()

  await Promise.all([
    refreshBalanceAndStats(),
    loadUsageStats(),
    loadTransactionsByRange(getRangeKeyByLevel(initialLevel), {
      preferCache: true,
      forceNetworkFull: false,
    }),
  ])
})
</script>

<style scoped lang="scss">
.balance-container {
  padding: 20px;
}

.info-card {
  margin-bottom: 20px;

  :deep(.el-card__body) {
    padding: 24px;
  }
}

.transaction-card {
  margin-bottom: 20px;
}

.card-header-section {
  margin-bottom: 0;
}

.statistics-section {
  margin-top: 0;
}

:deep(.el-divider) {
  margin: 20px 0;
}

.stats-row {
  .el-col {
    margin-bottom: 12px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  @media (min-width: 768px) {
    .el-col {
      margin-bottom: 0;
    }
  }
}

.stat-item {
  padding: 16px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--el-fill-color-light) 0%, var(--el-fill-color) 100%);
  border: 1px solid var(--el-border-color-lighter);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  height: 100%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
    border-color: var(--el-color-primary-light-5);
  }
}

.stat-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.stat-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  font-weight: 500;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-color-primary);
  line-height: 1;
}

.stat-total {
  font-size: 14px;
  color: var(--el-text-color-placeholder);
  font-weight: 400;
}

.stat-chart {
  flex-shrink: 0;
}

.balance-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.balance-display {
  display: flex;
  align-items: center;
  gap: 12px;
}

.balance-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--el-text-color-secondary);
  flex-wrap: wrap;
}

.balance-refresh-btn {
  min-width: 84px;
  margin-left: 2px;
}

.balance-amount {
  font-size: 24px;
  font-weight: bold;
  color: var(--el-color-primary);
}

.redeem-form {
  margin: 0;
  display: flex;
  justify-content: flex-end;
}

.transaction-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-section {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mobile-filter-section {
  width: 100%;
  flex-direction: column;
  align-items: stretch;
}

.mobile-filter-section > :deep(*) {
  width: 100% !important;
  max-width: 100% !important;
  margin-left: 0 !important;
}

.amount-positive {
  color: #67c23a;
  font-weight: 600;
}

.amount-negative {
  color: #f56c6c;
  font-weight: 600;
}

.chart-view {
  min-height: 400px;
}

.chart-item {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}

.chart-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.chart-date {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.chart-bar-container {
  position: relative;
  height: 32px;
}

.chart-bar {
  height: 100%;
  border-radius: 4px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  transition: width 0.3s ease;
}

.bar-positive {
  background: linear-gradient(90deg, #67c23a, #85ce61);
}

.bar-negative {
  background: linear-gradient(90deg, #f56c6c, #f78989);
}

.bar-value {
  color: white;
  font-weight: 600;
  font-size: 14px;
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

.timing-metrics {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 4px;
  height: 100%;
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
  min-width: 45px;
}

.metric-value {
  color: var(--el-color-primary);
  font-weight: 600;
  font-family: monospace;
}

.metric-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--el-fill-color);
  border: 1px solid var(--el-border-color-lighter);
}

.metric-badge__label {
  color: var(--el-text-color-secondary);
}

.metric-badge__value {
  color: var(--el-text-color-primary);
  font-weight: 600;
  font-family: monospace;
}

.stream-badge {
  display: inline-flex;
  align-items: center;
  align-self: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 4px;
}

.stream-badge--yes {
  color: #67c23a;
  background: rgba(103, 194, 58, 0.1);
}

.stream-badge--no {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
}

.stream-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stream-badge--yes .stream-dot {
  background: #67c23a;
}

.stream-badge--no .stream-dot {
  background: var(--el-text-color-placeholder);
}

.charts-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
  gap: 20px;
  padding: 20px 0;
}

.chart-view .chart-item {
  background: var(--el-bg-color);
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }

  .balance-container .transaction-header {
    flex-direction: column;
    align-items: stretch;
  }

  .balance-container .filter-section {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }

  .balance-container .filter-section > * {
    width: 100% !important;
    max-width: 100% !important;
    margin-left: 0 !important;
  }

  .charts-container {
    grid-template-columns: 1fr !important;
    gap: 12px !important;
    padding: 12px 0 !important;
  }

  .chart-view .chart-item {
    padding: 12px !important;
  }

  .chart-view .chart-item v-chart {
    height: 280px !important;
  }
}

@media (max-width: 480px) {
  .balance-container .card-header-section .el-row {
    flex-direction: column;
    align-items: flex-start;
  }
  .balance-container .redeem-form {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    margin-top: 12px;
  }
  .balance-container .redeem-form .el-form-item {
    width: 100%;
    margin-bottom: 12px !important;
  }
  .balance-container .transaction-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
}

:global(.mobile-datetime-range-popper .el-picker-panel__body-wrapper) {
  display: flex;
  flex-direction: column;
}

:global(.mobile-datetime-range-popper .el-date-range-picker__content) {
  width: 100%;
}

:global(.mobile-datetime-range-popper .el-date-range-picker__content.is-left) {
  border-right: 0;
}
</style>

<style scoped>
.balance-history-mobile {
  padding: 8px 6px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.balance-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.balance-line .label {
  color: var(--el-text-color-secondary);
}

.balance-line .value {
  color: var(--el-color-primary);
  font-weight: 700;
  font-size: 22px;
}

.stats-line {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.actions,
.filters {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.actions .el-button {
  width: 100%;
  margin-left: 0;
}

.filters :deep(.el-date-editor),
.filters :deep(.el-select),
.filters :deep(.el-input),
.filters :deep(.el-button) {
  width: 100%;
}

.record-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.record-item {
  border: 1px solid var(--el-border-color-lighter);
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.amount {
  font-weight: 700;
}

.amount.minus {
  color: var(--el-color-danger);
}

.amount.plus {
  color: var(--el-color-success);
}

.meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
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

.details-collapse {
  margin-top: 8px;
}

.details-collapse :deep(.el-collapse-item__header) {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  border-radius: 8px;
  padding: 0 10px;
  background: var(--el-fill-color-light);
}

.details-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 4px;
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

.pager-wrap {
  margin-top: 10px;
  display: flex;
  justify-content: center;
}

.balance-history-mobile :deep(.el-collapse-item__header) {
  min-height: 38px;
}

@media (max-width: 420px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
