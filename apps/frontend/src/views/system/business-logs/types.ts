import type {
  BusinessLogControllerGetBusinessLogsData,
  BusinessLogDto,
  BusinessLogFilterOptionsResponse,
} from '@/client/types.gen'

export type { BusinessLogDto, BusinessLogFilterOptionsResponse }

export interface BusinessLogStatsSummary {
  totalLogs: number
  successLogs: number
  failedLogs: number
  uniqueActors: number
  systemTriggeredLogs: number
  uniqueTargets: number
  uniqueIPs: number
}

export interface BusinessLogStatsBreakdown {
  key: string
  label: string
  count: number
  share: number
}

export interface BusinessLogStatsDaily {
  date: string
  totalLogs: number
  successLogs: number
  failedLogs: number
}

export interface BusinessLogStatsResponse {
  range: {
    startDate: string
    endDate: string
    days: number
  }
  summary: BusinessLogStatsSummary
  daily: BusinessLogStatsDaily[]
  byOperationType: BusinessLogStatsBreakdown[]
  byOperationCategory: BusinessLogStatsBreakdown[]
  bySuccess: BusinessLogStatsBreakdown[]
  operationTypeDailyDistribution: Array<{ date: string; key: string; label: string; count: number }>
  categoryDailyDistribution: Array<{ date: string; key: string; label: string; count: number }>
  generatedAt: string
}

export type BusinessLogFilters = Omit<
  NonNullable<BusinessLogControllerGetBusinessLogsData['query']>,
  'page' | 'pageSize' | 'actorUserId' | 'targetUserId'
>

export type BusinessLogDateRange = [Date, Date] | null
export type CategoryTagType = 'success' | 'primary' | 'warning' | 'danger' | 'info'

export interface BusinessLogSummaryCard {
  key: string
  label: string
  value: string
  hint: string
}
