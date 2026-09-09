import type { Prisma, RelayChannel, RelayToken } from "@prisma/client";
import type { ContextLengthMultiplierRule, RelayChannelRoutingConfigDto } from "@/api/dto/relay/relay-channel.dto";
import type { ModelPricingDto } from "@/api/dto/relay/model-pricing.dto";
import type { RelayRequestFormat } from "@/util/relay";
import type { RelayConvertibleRequestFormat } from "@quyan/shared";
import type { RelayResolvedChannelCandidate } from "../relay-pool-resolver.service";

export interface RelayRequestLike {
  method?: string;
  path?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  body?: unknown;
  ip?: string;
  connection?: { remoteAddress?: string };
  once?: (event: string, listener: (...args: any[]) => void) => unknown;
  on?: (event: string, listener: (...args: any[]) => void) => unknown;
  off?: (event: string, listener: (...args: any[]) => void) => unknown;
}

export interface RelayResponseLike {
  headersSent?: boolean;
  writableEnded?: boolean;
  writeHead(statusCode: number, headers?: Record<string, unknown>): unknown;
  write(chunk: Buffer | string): boolean;
  end(chunk?: Buffer | string): unknown;
}

export interface RelayUpstreamAgents {
  httpAgent: import("http").Agent;
  httpsAgent: import("https").Agent;
}

export interface RelayFailoverRuntimeConfig {
  enabled: boolean;
  maxRetries: number;
  retryStatusCodes: string[];
  failoverThreshold: number;
  failbackCooldownMinutes: number;
  maxAcceptedChannelMultiplier?: number | null;
  minCacheHitRate?: number | null;
  cacheHitRateMinSamples: number;
}

export interface RelayAttemptPlan {
  channels: RelayResolvedChannelCandidate[];
  failoverConfig: RelayFailoverRuntimeConfig;
  allowStickyFailover: boolean;
}

export interface RelayTokenAvailabilityInput {
  id?: string;
  allowedModels?: string | null;
  modelMapping?: Prisma.JsonValue | Record<string, string> | null;
  channel?: RelayChannel | null;
  routingMode?: string | null;
  automaticProxyPoolChannel?: RelayChannel | null;
  blockedAutomaticProxyPoolChannelIds?: Prisma.JsonValue | string[] | null;
  channelConfigs?: Array<{ channel?: RelayChannel | null; priority?: number | null }> | null;
  failoverConfig?: {
    enabled?: boolean | null;
    maxRetries?: number | null;
    retryStatusCodes?: Prisma.JsonValue | string[] | null;
    failoverThreshold?: number | null;
    failbackCooldownMinutes?: number | null;
    maxAcceptedChannelMultiplier?: number | Prisma.Decimal | null;
    minCacheHitRate?: number | Prisma.Decimal | null;
    cacheHitRateMinSamples?: number | null;
  } | null;
}

export interface SelectedRateConfig {
  pricingType: "token-based" | "per-request";
  fixedPrice?: number;
  input: number;
  output: number;
  multiplier: number;
  cacheCreationMultiplier: number;
  cacheReadMultiplier: number;
}

export interface RelayChannelExecutionContext {
  relayToken: RelayToken;
  selectedRateConfig: SelectedRateConfig;
  selectedModelName: string;
  selectedModelId: string;
  globalMultiplier: number;
  timeMultiplier: number;
  contextLengthMultipliers?: ContextLengthMultiplierRule[];
  relayGlobalMultiplier: number;
  channelMultiplier: number;
  executionChannelId: string;
  displayChannelId: string | null;
  displayChannelName: string | null;
  channelId: string;
  monthlyPassCoverageAt: Date;
  originalRequestedModel?: string;
}

export interface RelayUpstreamRequestContext {
  req: RelayRequestLike;
  res: RelayResponseLike;
  upstreamUrl: string;
  headers: Record<string, unknown>;
  convertedBody: unknown;
  requestFormat: RelayRequestFormat;
  requestAgents?: RelayUpstreamAgents;
}

export interface RelayStreamForwardParams extends RelayUpstreamRequestContext, RelayChannelExecutionContext {
  upstreamStreamTimeout: number;
  allowRetryBeforeResponse?: boolean;
  retryStatusCodes?: string[];
  inputTokensIncludeCacheRead?: boolean;
  autoInjectedStreamUsageOption?: boolean;
  responseTransform?: { sourceFormat: RelayConvertibleRequestFormat; targetFormat: RelayConvertibleRequestFormat };
  tokenNormalizerConfig?: unknown;
  tokenNormalizerRetried?: boolean;
  responseAiEnabled?: boolean;
  auditStats?: { inputTokens: number; outputTokens: number; cost: number; durationMs: number };
}

export interface RelayImageForwardParams extends RelayUpstreamRequestContext, RelayChannelExecutionContext {
  timeoutMs: number;
  maxBodyBytes: number;
  allowRetryBeforeResponse: boolean;
  retryStatusCodes: string[];
  inputTokensIncludeCacheRead: boolean;
}

export interface StreamForwardResult {
  handled: boolean;
  success: boolean;
  retryable: boolean;
  statusCode?: number;
  triggerError?: string;
  timeToFirstByte?: number;
  clientDisconnected?: boolean;
}

export interface ImageForwardResult extends StreamForwardResult {
  headers?: Record<string, unknown>;
  data?: unknown;
}

export interface RelayImageUsageParams extends RelayChannelExecutionContext {
  req: RelayRequestLike;
  convertedBody: unknown;
  responseBytes: number;
  statusCode: number;
  startTime: number;
  firstByteTime: number | null;
  inputTokensIncludeCacheRead: boolean;
  originalModel?: string;
}

export interface RelayStreamUsageFinalizeParams {
  requestId: string;
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cost: number;
  inputRate: number;
  outputRate: number;
  multiplier: number;
  cacheCreationMult: number;
  cacheReadMult: number;
  executionChannelId?: string | null;
  channelId?: string | null;
  displayChannelId?: string | null;
  displayChannelName?: string | null;
  channelMultiplier?: number;
  relayGlobalMultiplier?: number;
  timeMultiplier?: number;
  contextTokens?: number;
  contextMultiplier?: number;
  contextRuleName?: string | null;
  monthlyPassCoverageAt: Date;
  path: string;
  method?: string;
  statusCode: number;
  ipAddress?: string;
  totalOutputTime: number;
  timeToFirstByte?: number | null;
  modelName: string;
  modelId: string;
  pricingType?: "token-based" | "per-request";
  fixedPrice?: number;
  originalModel?: string;
  auditInputTokens?: number;
  auditOutputTokens?: number;
  auditTotalTokens?: number;
  auditCost?: number;
  auditDurationMs?: number;
}

export interface RelayFailedAttemptParams extends RelayChannelExecutionContext {
  req: RelayRequestLike;
  path: string;
  statusCode: number;
  startTime: number;
  firstByteTime: number | null;
  isStreaming: boolean;
}

export interface RelayChannelAttemptRecorderContext {
  relayTokenId: string;
  channelId: string;
  request: RelayRequestLike;
  channel?: RelayChannel;
  requestId: string;
  trackingConfig?: RelayChannelRoutingConfigDto | null;
}

export interface RelayConcurrencyLease {
  key: string;
  baseKey: string;
  slotKey: string;
  scope: "default" | "image";
  source: "redis";
  ownerToken: string;
  ttlMs: number;
  ttlSeconds: number;
}

export interface RelayCapacityPolicy {
  userId: string;
  scope: "default" | "image";
  maxConcurrency: number;
  queueTimeout: number;
  enableQueue: boolean;
  slotTtlSeconds: number;
}

export type RelayModelConfig = ModelPricingDto;
