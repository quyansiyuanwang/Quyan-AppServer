import { usePageDevice } from '@/composables/usePageDevice'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { balanceTransactionService } from '@/service/balanceTransactionService'
import { redemptionCodeService } from '@/service/redemptionCodeService'
import { useUserInfoStore } from '@/stores/userInfoStore'
import type { BalanceTransactionResponse } from '@/client/types.gen'
import { sessionDB, STORE_NAMES } from '@/utils/sessionDB'
import { isApiUsageRecord, isChargeableApiUsageRecord } from '@/utils/balance-transaction'

export type HistoryRangeKey = '1d' | '7d' | '30d' | 'all'

type HistoryRangeCacheEntry = {
  records: BalanceTransactionResponse[]
  complete: boolean
}

const BALANCE_HISTORY_PAGE_SIZE = 100
const DAY_MS = 24 * 60 * 60 * 1000
const BALANCE_HISTORY_PREVIEW_LIMIT = 100
const BALANCE_HISTORY_MAX_SYNC_WINDOW_MS = 30 * DAY_MS - 1
const DEFAULT_HISTORY_RANGE_LEVEL = 0
const BALANCE_HISTORY_ALL_COMPLETE_META_KEY = 'balance-history:all-complete'

const HISTORY_RANGE_LEVELS = [
  { value: 0, key: '1d' as const, label: () => i18ns.t('balance.lastDays', { days: 1 }) },
  { value: 1, key: '7d' as const, label: () => i18ns.t('balance.lastDays', { days: 7 }) },
  { value: 2, key: '30d' as const, label: () => i18ns.t('balance.lastDays', { days: 30 }) },
  { value: 3, key: 'all' as const, label: () => i18ns.t('balance.loadAll') },
] as const

export function useBalanceHistory() {
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
  const lastLoadTime = ref<string | null>(null)
  const activeHistoryRangeKey = ref<HistoryRangeKey>('1d')
  const historyRangeLevel = ref(DEFAULT_HISTORY_RANGE_LEVEL)

  let historyLoadToken = 0
  let incrementalSyncPromise: Promise<BalanceTransactionResponse[]> | null = null
  const historyRangeCache: Record<HistoryRangeKey, HistoryRangeCacheEntry> = {
    '1d': { records: [], complete: false },
    '7d': { records: [], complete: false },
    '30d': { records: [], complete: false },
    all: { records: [], complete: false },
  }

  const historyRangeHint = computed(() => {
    if (historyRangeCache.all.complete) return i18ns.t('balance.loadAllCached')
    return ''
  })

  const historyRangeSlider = computed(() => {
    return {
      value: historyRangeLevel.value,
      min: HISTORY_RANGE_LEVELS[0]?.value ?? 0,
      max: HISTORY_RANGE_LEVELS[HISTORY_RANGE_LEVELS.length - 1]?.value ?? 3,
      marks: Object.fromEntries(
        HISTORY_RANGE_LEVELS.map((item) => [
          item.value,
          {
            label: item.label(),
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
    [...records].sort((a, b) => {
      const timestampDifference = getTransactionTimestamp(b) - getTransactionTimestamp(a)
      return timestampDifference || a.id.localeCompare(b.id)
    })

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

      return detectedLevel
    } catch (error) {
      console.error('Failed to inspect cached balance history:', error)
      const fallbackLevel = DEFAULT_HISTORY_RANGE_LEVEL
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
          (getTransactionTimestamp(preferredRecord) > getTransactionTimestamp(fallbackRecord) ||
            (getTransactionTimestamp(preferredRecord) === getTransactionTimestamp(fallbackRecord) &&
              preferredRecord.id.localeCompare(fallbackRecord.id) <= 0)))
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
    lastLoadTime.value = sorted[0]?.createTime ?? null
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

  const deduplicateTransactions = (records: BalanceTransactionResponse[]) => {
    const byId = new Map<string, BalanceTransactionResponse>()
    records.forEach((record) => byId.set(record.id, record))
    return sortByCreateTimeDesc([...byId.values()])
  }

  /**
   * IndexedDB, rather than the currently displayed range, is the durable sync cursor.
   * Windows are inclusive at the API boundary and records are deduplicated by id afterwards.
   */
  const syncTransactionsSinceLatestCachedRecord = async (): Promise<
    BalanceTransactionResponse[]
  > => {
    if (incrementalSyncPromise) return incrementalSyncPromise

    incrementalSyncPromise = (async () => {
      const [latestCachedRecord] = await sessionDB.getRecent<BalanceTransactionResponse>(
        STORE_NAMES.BALANCE_TRANSACTIONS,
        1,
      )
      if (!latestCachedRecord) return []

      const latestTimestamp = getTransactionTimestamp(latestCachedRecord)
      if (!latestTimestamp) return []

      const now = Date.now()
      const fetchedRecords: BalanceTransactionResponse[] = []
      let windowStart = latestTimestamp

      while (windowStart <= now) {
        const windowEnd = Math.min(windowStart + BALANCE_HISTORY_MAX_SYNC_WINDOW_MS, now)
        fetchedRecords.push(
          ...(await fetchAllTransactions({
            startTime: new Date(windowStart).toISOString(),
            endTime: new Date(windowEnd).toISOString(),
          })),
        )
        windowStart = windowEnd + 1
      }

      const mergedRecords = deduplicateTransactions(fetchedRecords)
      if (mergedRecords.length > 0) {
        await sessionDB.save(STORE_NAMES.BALANCE_TRANSACTIONS, mergedRecords)
      }
      return mergedRecords
    })()

    try {
      return await incrementalSyncPromise
    } finally {
      incrementalSyncPromise = null
    }
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
      return
    }

    const mergedTransactions = mergeSortedTransactionsDesc(allTransactions.value, filteredCached)
    allTransactions.value = mergedTransactions
    lastLoadTime.value = mergedTransactions[0]?.createTime ?? lastLoadTime.value
    setRangeCache(rangeKey, mergedTransactions, false)
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
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('balance.loadFailed'))
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

    try {
      const newRecords = await syncTransactionsSinceLatestCachedRecord()
      if (newRecords.length > 0) {
        const filteredUpdatedRecords = filterTransactionsByRange(newRecords, rangeKey)
        if (filteredUpdatedRecords.length > 0) {
          if (loadToken != null && !isHistoryLoadCurrent(rangeKey, loadToken)) return

          const sortedUpdatedRecords = sortByCreateTimeDesc(filteredUpdatedRecords)
          allTransactions.value = mergeSortedTransactionsDesc(
            sortedUpdatedRecords,
            allTransactions.value,
          )
          lastLoadTime.value = allTransactions.value[0]?.createTime || lastLoadTime.value
          setRangeCache(rangeKey, allTransactions.value, historyRangeCache[rangeKey].complete)
        }
        mergeRecordsIntoCache(newRecords)
      }
    } catch (error: any) {
      console.error('Failed to update transactions:', error)
    }
  }

  const refreshTransactions = async () => {
    const rangeKey = activeHistoryRangeKey.value
    const loadToken = ++historyLoadToken
    loading.value = true
    loadingAllData.value = true

    try {
      if (allTransactions.value.length === 0) {
        await fetchAndApplyRangeTransactions(rangeKey, loadToken)
      } else {
        await incrementalUpdateTransactions({ rangeKey, loadToken })
      }
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('balance.loadFailed'))
      console.error('Failed to refresh transactions:', error)
    } finally {
      if (isHistoryLoadCurrent(rangeKey, loadToken)) {
        loading.value = false
        loadingAllData.value = false
      }
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
        if (forceNetworkFull) {
          backgroundTasks.push(fetchAndApplyRangeTransactions(rangeKey, loadToken))
        }
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

          if (forceNetworkFull) {
            backgroundTasks.push(fetchAndApplyRangeTransactions(rangeKey, loadToken))
          }

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
      } catch (error) {
        console.error('Failed to load balance history preview from cache:', error)
      }
    }

    try {
      await fetchAndApplyRangeTransactions(rangeKey, loadToken)
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('balance.loadFailed'))
      console.error('Failed to load transactions:', error)
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

    if (value === currentLevel) {
      return
    }

    if (value < currentLevel) {
      const currentRangeKey = activeHistoryRangeKey.value
      const currentRangeComplete = historyRangeCache[currentRangeKey].complete
      ++historyLoadToken
      activeHistoryRangeKey.value = targetRangeKey
      historyRangeLevel.value = value
      loading.value = false
      loadingAllData.value = false

      const trimmedRecords = filterTransactionsByRange(allTransactions.value, targetRangeKey)
      applyTransactions(trimmedRecords, targetRangeKey)
      setRangeCache(targetRangeKey, trimmedRecords, currentRangeComplete)

      // Cancels pending wider-range work; IndexedDB remains the durable incremental cursor.
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
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
    } finally {
      refreshingBalance.value = false
    }
  }

  onMounted(async () => {
    historyRangeLevel.value = DEFAULT_HISTORY_RANGE_LEVEL
    await primeHistoryRangeCacheFromSession()

    await Promise.all([
      refreshBalanceAndStats(),
      loadUsageStats(),
      loadTransactionsByRange('1d', {
        preferCache: true,
        forceNetworkFull: false,
      }),
    ])
  })

  return {
    isDesktop,
    i18ns,
    userInfoStore,
    loading,
    loadingStats,
    loadingAllData,
    refreshingBalance,
    redeeming,
    showCharts,
    redeemCode,
    allTransactions,
    historyRangeHint,
    historyRangeSlider,
    usageStats,
    requestCount,
    avgTPM,
    avgRPM,
    requestsChartOption,
    tpmChartOption,
    rpmChartOption,
    handleRedeem,
    refreshBalanceAndStats,
    refreshTransactions,
    incrementalUpdateTransactions,
    handleHistorySliderChange,
  }
}

export type BalanceHistoryState = ReturnType<typeof useBalanceHistory>
