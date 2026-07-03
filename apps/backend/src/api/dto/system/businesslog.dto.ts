import type { OperationCategory, OperationType } from "@/constant/operation-type";

/**
 * 业务日志 DTO
 */
export interface BusinessLogDTO {
  id: string;
  operationType: string;
  operationCategory: string;
  actorUserId: string | null;
  actorUsername: string | null;
  targetUserId: string | null;
  targetUsername: string | null;
  targetResourceId: string | null;
  targetResourceType: string | null;
  description: string;
  changes: any;
  metadata: any;
  success: boolean;
  errorMessage: string | null;
  requestId: string | null;
  ipAddress: string;
  userAgent: string | null;
  createTime: Date;
  updateTime: Date;
}

/**
 * 业务日志列表响应
 */
export interface BusinessLogListResponse {
  logs: BusinessLogDTO[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 业务日志筛选项响应
 */
export interface BusinessLogFilterOptionsResponse {
  operationTypes: OperationType[];
  operationCategories: OperationCategory[];
}

export interface BusinessLogStatsSummaryDTO {
  totalLogs: number;
  successLogs: number;
  failedLogs: number;
  uniqueActors: number;
  systemTriggeredLogs: number;
  uniqueTargets: number;
  uniqueIPs: number;
}

export interface BusinessLogStatsBreakdownDTO {
  key: string;
  label: string;
  count: number;
  share: number;
}

export interface BusinessLogStatsDailyDTO {
  date: string;
  totalLogs: number;
  successLogs: number;
  failedLogs: number;
}

export interface BusinessLogStatsDailyBreakdownDTO {
  date: string;
  key: string;
  label: string;
  count: number;
}

export interface BusinessLogStatsResponse {
  range: {
    startDate: string;
    endDate: string;
    days: number;
  };
  summary: BusinessLogStatsSummaryDTO;
  daily: BusinessLogStatsDailyDTO[];
  byOperationType: BusinessLogStatsBreakdownDTO[];
  byOperationCategory: BusinessLogStatsBreakdownDTO[];
  bySuccess: BusinessLogStatsBreakdownDTO[];
  operationTypeDailyDistribution: BusinessLogStatsDailyBreakdownDTO[];
  categoryDailyDistribution: BusinessLogStatsDailyBreakdownDTO[];
  generatedAt: string;
}
