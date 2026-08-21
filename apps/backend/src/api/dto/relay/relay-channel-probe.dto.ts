import type { RelayChannelVisibilityMode } from "@/api/dto/relay/relay-channel.dto";
import type { RelayConfiguredRequestFormat, RelayProbeFormat } from "@appserver/shared";

export type RelayChannelProbeFormat = RelayProbeFormat;
export type RelayChannelProbeEndpoint =
  | "openai-chat-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "gemini-generate-content";
export type RelayChannelProbeCacheMode = "cache-bust" | "allow-cache" | "warm-and-read";
export type RelayChannelProbeRunStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled";
export type RelayChannelProbeCalibrationStatus =
  | "pending"
  | "verified"
  | "insufficient-samples"
  | "low-signal"
  | "unstable"
  | "pricing-mismatch";

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
  /** Enables the conservative three-sample, MAD outlier, and stability checks. */
  strictCalibrationValidation: boolean;
  measurementInputTokens: number;
  balanceSettlementTolerance: number;
  balanceSettlementReads: number;
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
  /** Opt in to conservative multi-sample validation. The default keeps all comparable samples. */
  strictCalibrationValidation?: boolean;
  /** Approximate minimum input token count used to make balance deltas measurable. */
  measurementInputTokens?: number;
  /** Normalized balance delta required to consider an upstream charge observable. */
  balanceSettlementTolerance?: number;
  /** Consecutive equal balance reads required after a charge. */
  balanceSettlementReads?: number;
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
  /** Logical pooled channels provide credentials per hidden physical member. */
  memberCredentials?: Record<string, Record<string, string>>;
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
  contextMultiplier: number;
  contextTokens: number;
  contextRuleName?: string;
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
  strictCalibrationValidation: boolean;
  measurementInputTokens: number;
  balanceSettlementTolerance: number;
  balanceSettlementReads: number;
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
  calibrationStatus: RelayChannelProbeCalibrationStatus;
  pricingFingerprint?: string;
  pricingSnapshot?: Record<string, unknown>;
  balanceSnapshots?: Array<{ phase: "before" | "after"; balance: number; observedAt: string }>;
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
  status: "succeeded" | "failed" | "discarded" | "low_signal" | "balance_unstable" | "settlement_timeout";
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
  /** The unmodified usage object returned by the upstream measurement request. */
  upstreamUsage?: Record<string, unknown>;
  suggestedMultiplier?: number;
  cacheHitVerified?: boolean;
  measurementInputInjected?: boolean;
  balanceSnapshots?: Array<{ phase: "before" | "after"; balance: number; observedAt: string }>;
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
  allowedProbeFormats: RelayConfiguredRequestFormat[];
  /** Explicit model allow-list for the channel. Empty means no channel-level model allow-list. */
  allowedProbeModels: string[];
  profile?: RelayChannelProbeProfileDto;
  latestRun?: RelayChannelProbeRunDto;
}

export interface ApplyRelayChannelProbeRunsRequest {
  runIds: string[];
  /** Optional operator-confirmed values, used for rounding or a deliberate calibration adjustment. */
  overrides?: Array<{ runId: string; multiplier: number }>;
  /** Explicitly bypass the second stable probe requirement for large multiplier changes. */
  forceLargeChange?: boolean;
}

export interface ApplyRelayChannelProbeRunsResponse {
  applied: number;
  rejected: Array<{ runId: string; reason: string }>;
}
