export interface ConsumptionStatsFilterOption {
  key: string
  label: string
}

export interface ConsumptionStatsFilterOptions {
  users: ConsumptionStatsFilterOption[]
  models: ConsumptionStatsFilterOption[]
  channels: ConsumptionStatsFilterOption[]
  relayTokens: ConsumptionStatsFilterOption[]
}

export interface ConsumptionStatsSummary {
  totalSpend: number
  chargedSpend: number
  coveredSpend: number
  totalRequests: number
  zeroChargeRequests: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  activeUsers: number
  consumingUsers: number
  avgSpendPerRequest: number
  avgTokensPerRequest: number
}

export interface ConsumptionStatsBreakdown extends ConsumptionStatsSummary {
  key: string
  label: string
  share: number
}

export interface ConsumptionStatsDaily extends ConsumptionStatsSummary {
  date: string
}

export interface ConsumptionStatsResponse {
  range: {
    startDate: string
    endDate: string
    days: number
  }
  filterOptions: ConsumptionStatsFilterOptions
  summary: ConsumptionStatsSummary
  daily: ConsumptionStatsDaily[]
  byUser: ConsumptionStatsBreakdown[]
  byChannel: ConsumptionStatsBreakdown[]
  byModel: ConsumptionStatsBreakdown[]
  userDailyDistribution: Array<ConsumptionStatsDaily & { key: string; label: string }>
  channelDailyDistribution: Array<ConsumptionStatsDaily & { key: string; label: string }>
  modelDailyDistribution: Array<ConsumptionStatsDaily & { key: string; label: string }>
  generatedAt: string
}

export type ConsumptionStatsResponsePayload = Partial<
  Omit<ConsumptionStatsResponse, 'filterOptions'>
> & {
  filterOptions?: Partial<ConsumptionStatsFilterOptions> | null
}

export interface ConsumptionFilterSelections {
  userIds: string[]
  models: string[]
  channels: string[]
  relayTokenIds: string[]
}

export type FilterSelectionKey = keyof ConsumptionFilterSelections
