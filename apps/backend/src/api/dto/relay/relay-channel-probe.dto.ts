import type { RelayChannelVisibilityMode } from "@/api/dto/relay/relay-channel.dto";

export type RelayChannelProbeFormat = "openai" | "anthropic" | "gemini";
export type RelayChannelProbeEndpoint =
  | "openai-chat-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "gemini-generate-content";
export type RelayChannelProbeCacheMode = "cache-bust" | "allow-cache" | "warm-and-read";
export type RelayChannelProbeRunStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled";

export interface RelayChannelProbeWorkflowStepDto {
  name: string;
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  extract?: Record<string, string>;
  balancePath?: string;
}

export interface RelayChannelProbeProfileDto {
  id: string;
  relayChannelId: string;
  enabled: boolean;
  probeFormat: RelayChannelProbeFormat;
  probeEndpoint: RelayChannelProbeEndpoint;
  probeModel: string;
  probePayload: Record<string, unknown>;
  /** Inject a unique marker into each probe request to prevent upstream cache collisions. */
  preventCache: boolean;
  cacheMode: RelayChannelProbeCacheMode;
  sampleCount: number;
  upstreamCurrency: string;
  localCurrency: string;
  upstreamBalanceDivisor: number;
  upstreamRateMultiplier: number;
  /** Channels in the same non-empty probe group are calibrated serially. */
  probeGroup?: string;
  distributionMultiplier: number;
  workflow: RelayChannelProbeWorkflowStepDto[];
  credentialNames: string[];
  createTime: Date;
  updateTime: Date;
}

export interface UpsertRelayChannelProbeProfileRequest {
  enabled: boolean;
  probeFormat: RelayChannelProbeFormat;
  probeEndpoint?: RelayChannelProbeEndpoint;
  probeModel: string;
  probePayload: Record<string, unknown>;
  preventCache?: boolean;
  cacheMode?: RelayChannelProbeCacheMode;
  sampleCount?: number;
  upstreamCurrency?: string;
  localCurrency?: string;
  /** Divides the numeric balance extracted from the upstream response before calculating deltas. */
  upstreamBalanceDivisor?: number;
  /** Converts a normalized upstream balance unit to the local cost basis before distribution markup. */
  upstreamRateMultiplier?: number;
  /** Channels in the same non-empty probe group are calibrated serially. Empty clears the group. */
  probeGroup?: string;
  distributionMultiplier?: number;
  workflow: RelayChannelProbeWorkflowStepDto[];
  credentials?: Record<string, string>;
}

export interface CreateRelayChannelProbeRunRequest {
  distributionMultiplier?: number;
  /** Continue only when cache-buster injection cannot be applied to the configured payload. */
  forceWithoutCacheBuster?: boolean;
}

export type RelayChannelProbeRunHistoryScope = "all" | "failed";

export interface ClearRelayChannelProbeRunHistoryResponse {
  deleted: number;
}

/** Queues one probe per standalone channel. Individual channels may be rejected without cancelling the batch. */
export interface CreateRelayChannelProbeRunsRequest {
  channelIds: string[];
  distributionMultiplier?: number;
  forceWithoutCacheBuster?: boolean;
}

export interface RelayChannelProbeCostBreakdownDto {
  pricingType: "token-based" | "per-request";
  fixedPrice?: number;
  inputRate: number;
  outputRate: number;
  billableInputTokens: number;
  cacheCreationMultiplier: number;
  cacheReadMultiplier: number;
  globalMultiplier: number;
  timeMultiplier: number;
  rawCost: number;
}

export interface CreateRelayChannelProbeRunsResponse {
  queued: RelayChannelProbeRunDto[];
  rejected: Array<{ channelId: string; reason: string }>;
}

/** Copies a saved probe profile, including its encrypted workflow credentials, to standalone channels. */
export interface CopyRelayChannelProbeProfileRequest {
  sourceChannelId: string;
  targetChannelIds: string[];
  /** Existing target profiles are preserved unless an operator explicitly enables replacement. */
  overwriteExisting?: boolean;
}

export interface CopyRelayChannelProbeProfileResponse {
  copied: RelayChannelProbeProfileDto[];
  rejected: Array<{ channelId: string; reason: string }>;
}

export interface RelayChannelProbeRunDto {
  id: string;
  relayChannelId: string;
  profileId?: string;
  status: RelayChannelProbeRunStatus;
  queuedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  distributionMultiplier: number;
  probeEndpoint: RelayChannelProbeEndpoint;
  cacheMode: RelayChannelProbeCacheMode;
  sampleCount: number;
  sampleSucceededCount: number;
  sampleAcceptedCount: number;
  sampleDiscardedCount: number;
  warmupRequestCount: number;
  warmupCacheCreationTokens?: number;
  warmupCacheReadTokens?: number;
  warmupUsage?: Record<string, unknown>;
  samples?: RelayChannelProbeSampleDto[];
  upstreamBalanceBefore?: number;
  upstreamBalanceAfter?: number;
  upstreamBalanceDelta?: number;
  upstreamRateMultiplier: number;
  localBalanceBefore?: number;
  localBalanceAfter?: number;
  localBalanceDelta?: number;
  baseLocalCost?: number;
  requestTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cacheBustingEnabled: boolean;
  forceWithoutCacheBuster: boolean;
  cacheBusterId?: string;
  upstreamUsage?: Record<string, unknown>;
  costBreakdown?: RelayChannelProbeCostBreakdownDto;
  suggestedMultiplier?: number;
  sourceChannelMultiplier?: number;
  appliedMultiplier?: number;
  appliedAt?: Date;
  errorMessage?: string;
  requestedByUserId: string;
  createTime: Date;
  updateTime: Date;
}

export interface RelayChannelProbeSampleDto {
  index: number;
  status: "succeeded" | "failed" | "discarded";
  accepted: boolean;
  cacheBusterId?: string;
  upstreamBalanceBefore?: number;
  upstreamBalanceAfter?: number;
  upstreamBalanceDelta?: number;
  baseLocalCost?: number;
  requestTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  suggestedMultiplier?: number;
  cacheHitVerified?: boolean;
  errorMessage?: string;
}

export interface RelayChannelProbeRunPageDto {
  items: RelayChannelProbeRunDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** A routing entry that represents this standalone channel in customer-facing price notices. */
export interface RelayChannelProbeCustomerFacingTargetDto {
  channelId: string;
  channelName: string;
}

export interface RelayChannelProbeOverviewItemDto {
  channelId: string;
  channelName: string;
  enabled: boolean;
  /** Visibility of the standalone upstream channel itself. */
  visibilityMode: RelayChannelVisibilityMode;
  /**
   * Pooled entries that resolve to this standalone channel. When present,
   * customer notices must use these names instead of the upstream account name.
   */
  customerFacingTargets: RelayChannelProbeCustomerFacingTargetDto[];
  multiplier: number;
  /** Formats that can be used for the minimal AI request on this channel. */
  allowedProbeFormats: RelayChannelProbeFormat[];
  /** Explicit model allow-list for the channel. Empty means no channel-level model allow-list. */
  allowedProbeModels: string[];
  profile?: RelayChannelProbeProfileDto;
  latestRun?: RelayChannelProbeRunDto;
}

export interface ApplyRelayChannelProbeRunsRequest {
  runIds: string[];
  /** Optional operator-confirmed values, used for rounding or a deliberate calibration adjustment. */
  overrides?: Array<{ runId: string; multiplier: number }>;
}

export interface ApplyRelayChannelProbeRunsResponse {
  applied: number;
  rejected: Array<{ runId: string; reason: string }>;
}
