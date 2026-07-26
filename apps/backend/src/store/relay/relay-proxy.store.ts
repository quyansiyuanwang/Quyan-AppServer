import type { BalanceAccount } from "@prisma/client";

export type RelayBalanceChargeMode = "strict" | "allow-negative" | "skip-when-non-positive";

export interface RelayUsageRecordInput {
  relayTokenId: string;
  requestId: string;
  executionChannelId?: string | null;
  displayChannelId?: string | null;
  displayChannelName?: string | null;
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  path: string;
  method: string;
  statusCode: number;
  ipAddress: string;
  totalOutputTime?: number;
  timeToFirstByte?: number | null;
  isStreaming: boolean;
}

export interface RelayZeroChargeUsageInput extends RelayUsageRecordInput {
  userId: string;
  modelName: string;
  inputRate: number;
  outputRate: number;
  multiplier: number;
  cacheCreationMultiplier: number;
  cacheReadMultiplier: number;
  channelMultiplier: number;
  globalMultiplier: number;
  timeMultiplier?: number;
  description?: string;
  pricingType?: "token-based" | "per-request";
  fixedPrice?: number;
  /** 原始请求模型（模型映射后此字段记录用户请求的原始模型名） */
  originalModel?: string;
}

export interface RelayFinalizeChargeInput extends RelayUsageRecordInput {
  userId: string;
  cost: number;
  modelName: string;
  modelId?: string;
  /** Physical leaf channel used for upstream execution and monthly-pass matching. */
  channelId: string;
  monthlyPassCoverageAt?: Date;
  inputRate: number;
  outputRate: number;
  multiplier: number;
  cacheCreationMultiplier: number;
  cacheReadMultiplier: number;
  channelMultiplier: number;
  globalMultiplier: number;
  timeMultiplier?: number;
  balanceChargeMode?: RelayBalanceChargeMode;
  pricingType?: "token-based" | "per-request";
  fixedPrice?: number;
  /** 原始请求模型（模型映射后此字段记录用户请求的原始模型名） */
  originalModel?: string;
}

export interface RelayProxyStore {
  findBalanceAccountByUserId(userId: string): Promise<BalanceAccount | null>;
  recordUsageWithoutCharge(data: RelayUsageRecordInput): Promise<void>;
  recordUsageWithZeroChargeTransaction(data: RelayZeroChargeUsageInput): Promise<void>;
  finalizeChargedUsage(data: RelayFinalizeChargeInput): Promise<{ applied: boolean }>;
}
