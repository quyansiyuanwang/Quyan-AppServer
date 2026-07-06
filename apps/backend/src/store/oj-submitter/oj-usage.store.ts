import type { OJUsageRecord } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";

export interface OJChargeAndRecordUsageParams {
  userId: string;
  keyId: string;
  model: string;
  question: string;
  answer: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
  ipAddress: string;
  responseTime: number;
  inputRate: number;
  outputRate: number;
  multiplier: Decimal;
  cacheCreationMultiplier: Decimal;
  cacheReadMultiplier: Decimal;
}

export interface OJUsageStatsResult {
  total: number;
  records: Pick<
    OJUsageRecord,
    "id" | "model" | "question" | "answer" | "inputTokens" | "outputTokens" | "totalTokens" | "cost" | "createTime"
  >[];
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

export interface OJUsageStore {
  chargeAndRecordUsage(params: OJChargeAndRecordUsageParams): Promise<boolean>;
  queryUsageStats(
    userId: string,
    page: number,
    pageSize: number,
    startTime?: Date,
    endTime?: Date,
  ): Promise<OJUsageStatsResult>;
}
