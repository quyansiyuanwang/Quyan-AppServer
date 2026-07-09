import { i18ns } from '@/locales'
import type {
  ConsumptionFilterSelections,
  ConsumptionStatsBreakdown,
  ConsumptionStatsDaily,
  ConsumptionStatsFilterOption,
  ConsumptionStatsFilterOptions,
  ConsumptionStatsResponse,
  ConsumptionStatsResponsePayload,
  ConsumptionStatsSummary,
} from './types'

const DAY_MS = 24 * 60 * 60 * 1000
export const CONSUMPTION_STATS_MAX_CHUNK_DAYS = 30

export const emptySummary = (): ConsumptionStatsSummary => ({
  totalSpend: 0,
  chargedSpend: 0,
  coveredSpend: 0,
  totalRequests: 0,
  zeroChargeRequests: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  activeUsers: 0,
  consumingUsers: 0,
  avgSpendPerRequest: 0,
  avgTokensPerRequest: 0,
})

export const emptyFilterOptions = (): ConsumptionStatsFilterOptions => ({
  users: [],
  models: [],
  channels: [],
  relayTokens: [],
})

export const defaultSelections = (): ConsumptionFilterSelections => ({
  userIds: [],
  models: [],
  channels: [],
  relayTokenIds: [],
})

export const normalizeFilterOptions = (
  filterOptions?: Partial<ConsumptionStatsFilterOptions> | null,
): ConsumptionStatsFilterOptions => ({
  users: Array.isArray(filterOptions?.users) ? filterOptions.users : [],
  models: Array.isArray(filterOptions?.models) ? filterOptions.models : [],
  channels: Array.isArray(filterOptions?.channels) ? filterOptions.channels : [],
  relayTokens: Array.isArray(filterOptions?.relayTokens) ? filterOptions.relayTokens : [],
})

export const defaultStats = (): ConsumptionStatsResponse => ({
  range: {
    startDate: new Date().toISOString(),
    endDate: new Date().toISOString(),
    days: 1,
  },
  filterOptions: emptyFilterOptions(),
  summary: emptySummary(),
  daily: [],
  byUser: [],
  byChannel: [],
  byModel: [],
  userDailyDistribution: [],
  channelDailyDistribution: [],
  modelDailyDistribution: [],
  generatedAt: new Date().toISOString(),
})

export const normalizeStatsResponse = (
  data?: ConsumptionStatsResponsePayload | null,
): ConsumptionStatsResponse => {
  const fallback = defaultStats()

  return {
    ...fallback,
    ...data,
    range: {
      ...fallback.range,
      ...(data?.range ?? {}),
    },
    filterOptions: normalizeFilterOptions(data?.filterOptions),
    summary: {
      ...fallback.summary,
      ...(data?.summary ?? {}),
    },
    daily: Array.isArray(data?.daily) ? data.daily : [],
    byUser: Array.isArray(data?.byUser) ? data.byUser : [],
    byChannel: Array.isArray(data?.byChannel) ? data.byChannel : [],
    byModel: Array.isArray(data?.byModel) ? data.byModel : [],
    userDailyDistribution: Array.isArray(data?.userDailyDistribution)
      ? data.userDailyDistribution
      : [],
    channelDailyDistribution: Array.isArray(data?.channelDailyDistribution)
      ? data.channelDailyDistribution
      : [],
    modelDailyDistribution: Array.isArray(data?.modelDailyDistribution)
      ? data.modelDailyDistribution
      : [],
    generatedAt: data?.generatedAt ?? fallback.generatedAt,
  }
}

export const buildDefaultRange = (): [Date, Date] => {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  start.setHours(0, 0, 0, 0)
  return [start, end]
}

export const formatCurrency = (value: number): string =>
  `${value.toFixed(4)} ${i18ns.t('balance.yuan')}`
export const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)
export const formatPercent = (value: number): string => `${value.toFixed(2)}%`
export const formatDate = (value: string): string => new Date(value).toLocaleDateString()

const round4 = (value: number): number => Math.round(value * 10000) / 10000
const round2 = (value: number): number => Math.round(value * 100) / 100

export const startOfDay = (date: Date): Date => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

export const endOfDay = (date: Date): Date => {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

export const createChunkedRanges = (range: [Date, Date]): Array<[Date, Date]> => {
  const resolvedStart = startOfDay(range[0])
  const resolvedEnd = endOfDay(range[1])
  const ranges: Array<[Date, Date]> = []

  let currentStart = new Date(resolvedStart)

  while (currentStart.getTime() <= resolvedEnd.getTime()) {
    const chunkEnd = new Date(
      Math.min(
        endOfDay(
          new Date(currentStart.getTime() + (CONSUMPTION_STATS_MAX_CHUNK_DAYS - 1) * DAY_MS),
        ).getTime(),
        resolvedEnd.getTime(),
      ),
    )

    ranges.push([new Date(currentStart), chunkEnd])
    currentStart = startOfDay(new Date(chunkEnd.getTime() + DAY_MS))
  }

  return ranges
}

const mergeFilterOptions = (
  target: ConsumptionStatsFilterOption[],
  source: ConsumptionStatsFilterOption[],
): ConsumptionStatsFilterOption[] => {
  const map = new Map(target.map((item) => [item.key, item]))

  for (const item of source) {
    if (!map.has(item.key)) {
      map.set(item.key, item)
    }
  }

  return [...map.values()].sort((left, right) => {
    const labelDiff = left.label.localeCompare(right.label)
    return labelDiff !== 0 ? labelDiff : left.key.localeCompare(right.key)
  })
}

const mergeSummary = (
  target: ConsumptionStatsSummary,
  source: ConsumptionStatsSummary,
): ConsumptionStatsSummary => ({
  ...target,
  totalSpend: round4(target.totalSpend + source.totalSpend),
  chargedSpend: round4(target.chargedSpend + source.chargedSpend),
  coveredSpend: round4(target.coveredSpend + source.coveredSpend),
  totalRequests: target.totalRequests + source.totalRequests,
  zeroChargeRequests: target.zeroChargeRequests + source.zeroChargeRequests,
  totalTokens: target.totalTokens + source.totalTokens,
  inputTokens: target.inputTokens + source.inputTokens,
  outputTokens: target.outputTokens + source.outputTokens,
  cacheCreationTokens: target.cacheCreationTokens + source.cacheCreationTokens,
  cacheReadTokens: target.cacheReadTokens + source.cacheReadTokens,
  activeUsers: target.activeUsers + source.activeUsers,
  consumingUsers: target.consumingUsers + source.consumingUsers,
  avgSpendPerRequest: 0,
  avgTokensPerRequest: 0,
})

const finalizeSummary = (
  summary: ConsumptionStatsSummary,
  overrides?: Partial<Pick<ConsumptionStatsSummary, 'activeUsers' | 'consumingUsers'>>,
): ConsumptionStatsSummary => {
  const totalRequests = summary.totalRequests
  return {
    ...summary,
    activeUsers: overrides?.activeUsers ?? summary.activeUsers,
    consumingUsers: overrides?.consumingUsers ?? summary.consumingUsers,
    avgSpendPerRequest: totalRequests > 0 ? round4(summary.totalSpend / totalRequests) : 0,
    avgTokensPerRequest: totalRequests > 0 ? round2(summary.totalTokens / totalRequests) : 0,
  }
}

const mergeBreakdownList = (
  target: ConsumptionStatsBreakdown[],
  source: ConsumptionStatsBreakdown[],
): ConsumptionStatsBreakdown[] => {
  const map = new Map(target.map((item) => [item.key, { ...item }]))

  for (const item of source) {
    const existing = map.get(item.key)
    if (!existing) {
      map.set(item.key, { ...item, share: 0, avgSpendPerRequest: 0, avgTokensPerRequest: 0 })
      continue
    }

    map.set(item.key, {
      ...existing,
      label: existing.label || item.label,
      ...mergeSummary(existing, item),
      share: 0,
    })
  }

  return [...map.values()]
}

const mergeDailyList = (
  target: ConsumptionStatsDaily[],
  source: ConsumptionStatsDaily[],
): ConsumptionStatsDaily[] => {
  const map = new Map(target.map((item) => [item.date, { ...item }]))

  for (const item of source) {
    const existing = map.get(item.date)
    if (!existing) {
      map.set(item.date, { ...item, avgSpendPerRequest: 0, avgTokensPerRequest: 0 })
      continue
    }

    map.set(item.date, {
      date: item.date,
      ...mergeSummary(existing, item),
    })
  }

  return [...map.values()]
}

const mergeDailyBreakdownList = (
  target: Array<ConsumptionStatsDaily & { key: string; label: string }>,
  source: Array<ConsumptionStatsDaily & { key: string; label: string }>,
): Array<ConsumptionStatsDaily & { key: string; label: string }> => {
  const map = new Map(target.map((item) => [`${item.date}::${item.key}`, { ...item }]))

  for (const item of source) {
    const compositeKey = `${item.date}::${item.key}`
    const existing = map.get(compositeKey)
    if (!existing) {
      map.set(compositeKey, { ...item, avgSpendPerRequest: 0, avgTokensPerRequest: 0 })
      continue
    }

    map.set(compositeKey, {
      date: item.date,
      key: item.key,
      label: existing.label || item.label,
      ...mergeSummary(existing, item),
    })
  }

  return [...map.values()]
}

const sortBreakdownList = <T extends { totalSpend: number; totalRequests: number; label: string }>(
  items: T[],
): T[] => {
  return items.sort((left, right) => {
    if (right.totalSpend !== left.totalSpend) return right.totalSpend - left.totalSpend
    if (right.totalRequests !== left.totalRequests) return right.totalRequests - left.totalRequests
    return left.label.localeCompare(right.label)
  })
}

const sortDailyList = (items: ConsumptionStatsDaily[]): ConsumptionStatsDaily[] => {
  return items.sort((left, right) => left.date.localeCompare(right.date))
}

const sortDailyBreakdownList = (
  items: Array<ConsumptionStatsDaily & { key: string; label: string }>,
): Array<ConsumptionStatsDaily & { key: string; label: string }> => {
  return items.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date)
    if (right.totalSpend !== left.totalSpend) return right.totalSpend - left.totalSpend
    return left.label.localeCompare(right.label)
  })
}

const finalizeBreakdownList = (
  items: ConsumptionStatsBreakdown[],
  totalSpend: number,
): ConsumptionStatsBreakdown[] => {
  return sortBreakdownList(
    items.map((item) => {
      const finalized = finalizeSummary(item)
      const consumingUsers = finalized.totalSpend > 0 ? 1 : 0
      return {
        key: item.key,
        label: item.label,
        ...finalized,
        activeUsers: finalized.totalRequests > 0 ? 1 : 0,
        consumingUsers,
        share: totalSpend > 0 ? round2((finalized.totalSpend / totalSpend) * 100) : 0,
      }
    }),
  )
}

const finalizeDailyStats = (
  daily: ConsumptionStatsDaily[],
  userDailyDistribution: Array<ConsumptionStatsDaily & { key: string; label: string }>,
): ConsumptionStatsDaily[] => {
  const activeUsersByDate = new Map<string, Set<string>>()
  const consumingUsersByDate = new Map<string, Set<string>>()

  for (const item of userDailyDistribution) {
    const activeUsers = activeUsersByDate.get(item.date) ?? new Set<string>()
    activeUsers.add(item.key)
    activeUsersByDate.set(item.date, activeUsers)

    if (item.totalSpend > 0) {
      const consumingUsers = consumingUsersByDate.get(item.date) ?? new Set<string>()
      consumingUsers.add(item.key)
      consumingUsersByDate.set(item.date, consumingUsers)
    }
  }

  return sortDailyList(
    daily.map((item) => ({
      date: item.date,
      ...finalizeSummary(item, {
        activeUsers: activeUsersByDate.get(item.date)?.size ?? item.activeUsers,
        consumingUsers: consumingUsersByDate.get(item.date)?.size ?? item.consumingUsers,
      }),
    })),
  )
}

export const mergeChunkedStats = (
  chunks: ConsumptionStatsResponse[],
  requestedRange: [Date, Date],
): ConsumptionStatsResponse => {
  const merged = defaultStats()

  for (const chunk of chunks) {
    merged.filterOptions.users = mergeFilterOptions(merged.filterOptions.users, chunk.filterOptions.users)
    merged.filterOptions.models = mergeFilterOptions(merged.filterOptions.models, chunk.filterOptions.models)
    merged.filterOptions.channels = mergeFilterOptions(merged.filterOptions.channels, chunk.filterOptions.channels)
    merged.filterOptions.relayTokens = mergeFilterOptions(
      merged.filterOptions.relayTokens,
      chunk.filterOptions.relayTokens,
    )
    merged.summary = mergeSummary(merged.summary, chunk.summary)
    merged.daily = mergeDailyList(merged.daily, chunk.daily)
    merged.byUser = mergeBreakdownList(merged.byUser, chunk.byUser)
    merged.byChannel = mergeBreakdownList(merged.byChannel, chunk.byChannel)
    merged.byModel = mergeBreakdownList(merged.byModel, chunk.byModel)
    merged.userDailyDistribution = mergeDailyBreakdownList(
      merged.userDailyDistribution,
      chunk.userDailyDistribution,
    )
    merged.channelDailyDistribution = mergeDailyBreakdownList(
      merged.channelDailyDistribution,
      chunk.channelDailyDistribution,
    )
    merged.modelDailyDistribution = mergeDailyBreakdownList(
      merged.modelDailyDistribution,
      chunk.modelDailyDistribution,
    )
    merged.generatedAt = chunk.generatedAt > merged.generatedAt ? chunk.generatedAt : merged.generatedAt
  }

  merged.byUser = finalizeBreakdownList(merged.byUser, merged.summary.totalSpend)
  merged.byChannel = finalizeBreakdownList(merged.byChannel, merged.summary.totalSpend)
  merged.byModel = finalizeBreakdownList(merged.byModel, merged.summary.totalSpend)
  merged.userDailyDistribution = sortDailyBreakdownList(
    merged.userDailyDistribution.map((item) => ({
      date: item.date,
      key: item.key,
      label: item.label,
      ...finalizeSummary(item),
    })),
  )
  merged.channelDailyDistribution = sortDailyBreakdownList(
    merged.channelDailyDistribution.map((item) => ({
      date: item.date,
      key: item.key,
      label: item.label,
      ...finalizeSummary(item),
    })),
  )
  merged.modelDailyDistribution = sortDailyBreakdownList(
    merged.modelDailyDistribution.map((item) => ({
      date: item.date,
      key: item.key,
      label: item.label,
      ...finalizeSummary(item),
    })),
  )
  merged.daily = finalizeDailyStats(merged.daily, merged.userDailyDistribution)
  merged.summary = finalizeSummary(merged.summary, {
    activeUsers: merged.byUser.length,
    consumingUsers: merged.byUser.filter((item) => item.totalSpend > 0).length,
  })

  const resolvedStart = startOfDay(requestedRange[0])
  const resolvedEnd = endOfDay(requestedRange[1])
  merged.range = {
    startDate: resolvedStart.toISOString(),
    endDate: resolvedEnd.toISOString(),
    days: Math.max(1, Math.floor((resolvedEnd.getTime() - resolvedStart.getTime()) / DAY_MS) + 1),
  }

  return merged
}
