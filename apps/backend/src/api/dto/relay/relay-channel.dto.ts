import type { RelayConfiguredRequestFormat, RelayUpstreamFormat } from "@appserver/shared";

export interface TimePeriodMultiplierRule {
  name: string;
  enabled: boolean;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  multiplier: number;
}

/** A whole-request multiplier selected from the request's input context length. */
export interface ContextLengthMultiplierRule {
  name: string;
  enabled: boolean;
  /** Inclusive input-context threshold in tokens. */
  minTokens: number;
  multiplier: number;
}

export type RelayChannelType = "standalone" | "pooled-member" | "pooled" | "automatic-proxy-pool";
export type RelayChannelTopologyMode = "legacy" | "strict-two-tier";

export type RelayChannelRoutingStrategy =
  | "priority"
  | "random"
  | "weighted-random"
  | "round-robin"
  | "health-priority"
  | "latency-priority";

export type RelayChannelVisibilityMode = "public" | "private" | "whitelist" | "hidden";

export type RelayChannelAllowedModelsMode = "all" | "manual" | "auto";
export type RelayAutomaticPoolRankingMode = "price-first" | "stability-first";
/** Controls whether a standalone channel contributes health samples to automatic proxy pools. */
export type RelayChannelHealthTrackingMode = "automatic" | "manual" | "disabled";
export type RelayChannelSubmissionStatus = "pending" | "approved" | "rejected" | "offboarded";
export type RelayChannelChangeRequestStatus = "pending" | "approved" | "rejected";
export type RelayChannelProviderSettlementMode = "realtime" | "interval" | "daily" | "manual";

export interface RelayChannelProviderDto {
  id: string;
  userId: string;
  username?: string;
  commissionPercent: number;
  settlementMode: RelayChannelProviderSettlementMode;
  settlementIntervalDays?: number;
  settlementTime?: string;
  nextSettlementAt?: Date;
}

export interface RelayChannelProviderConfigRequest {
  /** Provider username. The server resolves it to an internal user ID before persistence. */
  username: string;
  commissionPercent: number;
  settlementMode: RelayChannelProviderSettlementMode;
  settlementIntervalDays?: number;
  settlementTime?: string;
}

export interface RelayChannelMemberDto {
  id?: string;
  memberChannelId: string;
  priority: number;
  weight?: number;
  enabled?: boolean;
  /** Display-only member metadata returned with channel details. */
  memberChannelName?: string;
  memberChannelType?: RelayChannelType;
  memberChannelEnabled?: boolean;
}

/** Lightweight channel projection used by the management list. */
export interface RelayChannelManagementListItemDto {
  id: string;
  name: string;
  submittedByUserId?: string;
  submittedByUsername?: string;
  enabled: boolean;
  providerServiceEnabled: boolean;
  serviceEnabled: boolean;
  channelType: RelayChannelType;
  routingStrategy: RelayChannelRoutingStrategy;
  visibilityMode: RelayChannelVisibilityMode;
  poolMemberCount: number;
  /** Present for a physical pooled member in the management list. */
  pooledParentId?: string;
  /** Present with pooledParentId for a physical pooled member. */
  pooledParentName?: string;
  multiplier: number;
  submissionStatus: RelayChannelSubmissionStatus;
  providerCount: number;
  providerCommissionPercent: number;
  updateTime: Date;
}

export interface RelayChannelTopologyAuditIssueDto {
  code: string;
  channelId?: string;
  channelName?: string;
  message: string;
}

/** Read-only prerequisite report for enabling strict two-tier topology. */
export interface RelayChannelTopologyAuditDto {
  mode: RelayChannelTopologyMode;
  canEnableStrict: boolean;
  issues: RelayChannelTopologyAuditIssueDto[];
}

export interface RelayChannelRoutingConfigDto {
  maxRetries?: number;
  failoverThreshold?: number;
  retryStatusCodes?: Array<number | string>;
  failbackCooldownMinutes?: number;
  healthScoreThreshold?: number | null;
  latencyThresholdMs?: number | null;
  circuitBreakerThreshold?: number | null;
  allowedModelsMode?: RelayChannelAllowedModelsMode;
  stickyByModel?: boolean;
  stickyByFormat?: boolean;
  /** Dynamic ordering mode for automatic proxy pools. */
  rankingMode?: RelayAutomaticPoolRankingMode;
  /** Automatic proxy pools: use member price and health telemetry to reorder attempts. */
  dynamicMemberRankingEnabled?: boolean;
  /** Standalone channels: collect live Redis samples, use administrator values, or keep priority unchanged. */
  healthTrackingMode?: RelayChannelHealthTrackingMode;
  /** Administrator-maintained availability for manual health tracking, from 0 to 1. */
  manualAvailability?: number | null;
  /** Administrator-maintained latency in milliseconds for manual health tracking. */
  manualLatencyMs?: number | null;
}

export interface RelayChannelVisibilityConfigDto {
  userIds?: string[];
  groupIds?: string[];
  roleIds?: string[];
}

export interface RelayChannelDto {
  id: string;
  name: string;
  enabled: boolean;
  providerServiceEnabled: boolean;
  serviceEnabled: boolean;
  channelType: RelayChannelType;
  routingStrategy: RelayChannelRoutingStrategy;
  routingConfig?: RelayChannelRoutingConfigDto;
  visibilityMode: RelayChannelVisibilityMode;
  visibilityConfig?: RelayChannelVisibilityConfigDto;
  poolMembers?: RelayChannelMemberDto[];
  /** The sole logical pooled parent for a physical pooled member. */
  pooledParentId?: string;
  pooledParentName?: string;
  pooledPriority?: number;
  pooledWeight?: number;
  pooledMemberEnabled?: boolean;
  openaiUpstreamUrl?: string;
  hasOpenaiUpstreamApiKey: boolean;
  anthropicUpstreamUrl?: string;
  hasAnthropicUpstreamApiKey: boolean;
  geminiUpstreamUrl?: string;
  hasGeminiUpstreamApiKey: boolean;
  useProxy?: boolean;
  multiplier: number;
  allowedFormats: string;
  /** Final models available through this channel after active pool resolution and inherited restrictions. */
  allowedModels: string[];
  /** Raw JSON model whitelist persisted for channel management configuration. */
  configuredAllowedModels?: string;
  addUserIdentifier?: boolean;
  inputTokensIncludeCacheRead?: boolean;
  modelMapping?: Record<string, string>;
  timePeriodMultipliers?: TimePeriodMultiplierRule[];
  contextLengthMultipliers?: ContextLengthMultiplierRule[];
  submissionStatus: RelayChannelSubmissionStatus;
  submittedByUserId?: string;
  submittedByUsername?: string;
  reviewedAt?: Date;
  reviewReason?: string;
  providers: RelayChannelProviderDto[];
  createTime: Date;
  updateTime: Date;
}

/** Business-facing channel capability. Pool topology is returned only to authorized callers. */
export interface RelayChannelOptionDto {
  id: string;
  name: string;
  enabled: boolean;
  /** Omitted unless the caller is allowed to view relay pool topology. */
  channelType?: RelayChannelType;
  multiplier: number;
  /** Configured whole-request context tiers for a standalone channel. */
  contextLengthMultipliers?: ContextLengthMultiplierRule[];
  allowedFormats: string;
  modelCapabilities: RelayChannelModelCapabilityDto[];
  /** Present for pooled and automatic proxy pool channels when pool metadata access is granted. */
  poolPricing?: RelayPoolPricingOptionDto;
  /** Present for automatic proxy pools when pool metadata access is granted. Excludes upstream credentials and URLs. */
  automaticProxyPool?: RelayAutomaticProxyPoolOptionDto;
}

export interface RelayChannelModelCapabilityDto {
  catalogModelName: string;
  requestModelId: string;
  supportedRequestFormats: RelayConfiguredRequestFormat[];
}

/** Model-specific multiplier range for a logical channel with variable upstream pricing. */
export interface RelayCatalogModelPriceRangeDto {
  catalogModelName: string;
  requestModelId: string;
  minMultiplier: number;
  maxMultiplier: number;
}

/**
 * Consumer-facing API documentation channel projection.
 *
 * A variable-priced logical channel intentionally has no pool type, member, or routing data.
 * It is presented exactly like any other public channel, with only a model-level price range.
 */
export interface RelayCatalogOptionDto {
  id: string;
  name: string;
  enabled: boolean;
  allowedFormats: string;
  modelCapabilities: RelayChannelModelCapabilityDto[];
  pricingMode: "fixed" | "range";
  multiplier?: number;
  contextLengthMultipliers?: ContextLengthMultiplierRule[];
  modelPriceRanges?: RelayCatalogModelPriceRangeDto[];
  pricingEffectiveAt: Date;
  priceMayVary: boolean;
}

/**
 * Safe, user-selectable routing catalog. Unlike channel-management options it
 * intentionally excludes every physical pooled-member node and its topology.
 */
export interface RelayRoutingCatalogOptionDto {
  id: string;
  name: string;
  enabled: boolean;
  channelType: "standalone" | "pooled" | "automatic-proxy-pool";
  multiplier: number;
  contextLengthMultipliers?: ContextLengthMultiplierRule[];
  allowedFormats: string;
  modelCapabilities: RelayChannelModelCapabilityDto[];
  /** Only populated for automatic pools; members are logical pooled channels. */
  automaticProxyPool?: RelayAutomaticProxyPoolOptionDto;
}

export interface RelayPoolPricingOptionDto {
  /** Flattened final channels after nested pools and inherited restrictions are resolved. */
  members: RelayPoolPricingMemberOptionDto[];
}

export interface RelayPoolPricingMemberOptionDto {
  id: string;
  name: string;
  enabled: boolean;
  multiplier: number;
  timePeriodMultiplier: number;
  effectiveMultiplier: number;
  contextLengthMultipliers?: ContextLengthMultiplierRule[];
  /** Current model/format eligibility after pool constraints are resolved. */
  modelCapabilities: RelayChannelModelCapabilityDto[];
}

export interface RelayAutomaticProxyPoolOptionDto {
  routingStrategy: RelayChannelRoutingStrategy;
  routingConfig?: RelayAutomaticProxyPoolRoutingConfigDto;
  members: RelayAutomaticProxyPoolMemberOptionDto[];
}

export interface RelayAutomaticProxyPoolRoutingConfigDto {
  maxRetries?: number;
  failoverThreshold?: number;
  retryStatusCodes?: Array<number | string>;
  failbackCooldownMinutes?: number;
  healthScoreThreshold?: number | null;
  latencyThresholdMs?: number | null;
  circuitBreakerThreshold?: number | null;
  stickyByModel?: boolean;
  stickyByFormat?: boolean;
  rankingMode?: RelayAutomaticPoolRankingMode;
}

export interface RelayChannelHealthDto {
  channelId: string;
  windowStartAt: Date;
  windowEndAt: Date;
  sampleCount: number;
  successCount: number;
  failureCount: number;
  availability: number;
  averageLatencyMs: number;
  status2xxCount: number;
  status3xxCount: number;
  status4xxCount: number;
  status5xxCount: number;
  statusOtherCount: number;
  lastSeenAt?: Date;
  lastSuccessAt?: Date;
  trackingMode: RelayChannelHealthTrackingMode;
  /** Whether the displayed availability is live Redis data, an administrator value, or disabled. */
  source: "redis" | "manual" | "disabled";
  manualAvailability?: number;
  manualLatencyMs?: number;
}

export interface RelayAutomaticPoolHealthMemberDto extends RelayChannelHealthDto {
  name: string;
  enabled: boolean;
  priority: number;
  weight: number;
  effectivePrice: number;
  score: number;
  rank: number;
  /** Whether this member is eligible for the current pool base route. */
  eligible: boolean;
  /** Why the member is excluded, when it is not eligible. */
  exclusionReasons: string[];
}

export interface RelayAutomaticPoolHealthDto {
  channelId: string;
  name: string;
  rankingMode: RelayAutomaticPoolRankingMode;
  dynamicMemberRankingEnabled: boolean;
  windowStartAt: Date;
  windowEndAt: Date;
  members: RelayAutomaticPoolHealthMemberDto[];
}

export interface RelayChannelHealthOverviewItemDto extends RelayChannelHealthDto {
  name: string;
  enabled: boolean;
  channelType: RelayChannelType;
}

export interface RelayChannelHealthOverviewDto {
  windowMinutes: number;
  channels: RelayChannelHealthOverviewItemDto[];
}

export interface UpdateRelayChannelHealthConfigRequest {
  healthTrackingMode: RelayChannelHealthTrackingMode;
  manualAvailability?: number | null;
  manualLatencyMs?: number | null;
}

/** Applies one health-tracking configuration to multiple standalone channels. */
export interface BatchUpdateRelayChannelHealthConfigRequest extends UpdateRelayChannelHealthConfigRequest {
  ids: string[];
}

export interface RelayAutomaticProxyPoolMemberOptionDto {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  weight?: number;
  multiplier: number;
  timePeriodMultiplier: number;
  effectiveMultiplier: number;
  contextLengthMultipliers?: ContextLengthMultiplierRule[];
  allowedFormats: string;
  /** Current model/format eligibility after pool constraints are resolved. */
  modelCapabilities: RelayChannelModelCapabilityDto[];
}

export interface RelayChannelExportItemDto extends CreateRelayChannelRequest {
  id: string;
  enabled: boolean;
  createTime: Date;
  updateTime: Date;
}

export interface RelayChannelExportResponse {
  channels: RelayChannelExportItemDto[];
}

export interface ExportRelayChannelsRequest {
  ids?: string[];
  includeDisabled?: boolean;
}

export interface DuplicateRelayChannelRequest {
  /** 新渠道名称，不传则自动生成 */
  name?: string;
}

export interface RelayChannelImportItemDto extends CreateRelayChannelRequest {
  /** Export source channel ID, used only to remap pooled members during import. */
  id?: string;
  /** 导入后是否启用，默认启用 */
  enabled?: boolean;
}

export interface ImportRelayChannelsRequest {
  channels: RelayChannelImportItemDto[];
}

export interface ImportRelayChannelsResponse {
  code: number;
  message: string;
  created: number;
  total: number;
  data: RelayChannelDto[];
}

export interface BatchSetRelayChannelStatusRequest {
  ids: string[];
  enabled: boolean;
}

export interface BatchDeleteRelayChannelsRequest {
  ids: string[];
}

export interface BatchDuplicateRelayChannelsRequest {
  ids: string[];
}

/** Fields that can be safely applied to multiple channels. Sensitive upstream settings and pool topology are excluded. */
export interface BatchUpdateRelayChannelPatch {
  multiplier?: number;
  allowedFormats?: string | null;
  allowedModels?: string | null;
  addUserIdentifier?: boolean;
  inputTokensIncludeCacheRead?: boolean;
  modelMapping?: Record<string, string> | null;
  visibilityMode?: RelayChannelVisibilityMode;
  visibilityConfig?: RelayChannelVisibilityConfigDto | null;
  routingStrategy?: RelayChannelRoutingStrategy;
  routingConfig?: RelayChannelRoutingConfigDto | null;
  timePeriodMultipliers?: TimePeriodMultiplierRule[] | null;
  contextLengthMultipliers?: ContextLengthMultiplierRule[] | null;
}

/** Maps a request model to another local pricing record without changing its upstream model ID. */
export interface RelayChannelModelPricingMigrationRequest {
  sourceModelId: string;
  targetPricingModel: string;
}

export interface BatchUpdateRelayChannelsRequest {
  ids: string[];
  patch: BatchUpdateRelayChannelPatch;
  modelPricingMigration?: RelayChannelModelPricingMigrationRequest;
}

export interface BatchUpdateRelayChannelRejectedDto {
  id: string;
  reason: string;
}

export interface BatchUpdateRelayChannelsResponse {
  updated: RelayChannelDto[];
  rejected: BatchUpdateRelayChannelRejectedDto[];
}

export interface BatchRelayChannelsResultDto {
  total: number;
  affected: number;
}

export interface CreateRelayChannelRequest {
  /**
   * 渠道名称
   */
  name: string;
  /** OpenAI 上游 URL */
  openaiUpstreamUrl?: string;
  /** OpenAI 上游 API Key */
  openaiUpstreamApiKey?: string;
  /** Whether requests through this channel use the configured upstream proxy. */
  useProxy?: boolean;
  /** Anthropic 上游 URL */
  anthropicUpstreamUrl?: string;
  /** Anthropic 上游 API Key */
  anthropicUpstreamApiKey?: string;
  /** Gemini 上游 URL */
  geminiUpstreamUrl?: string;
  /** Gemini 上游 API Key */
  geminiUpstreamApiKey?: string;
  /** 渠道类型 */
  channelType?: RelayChannelType;
  /** 混池路由策略 */
  routingStrategy?: RelayChannelRoutingStrategy;
  /** 路由策略配置 */
  routingConfig?: RelayChannelRoutingConfigDto | null;
  /** 可见性模式 */
  visibilityMode?: RelayChannelVisibilityMode;
  /** 可见性白名单 */
  visibilityConfig?: RelayChannelVisibilityConfigDto | null;
  /** 混池成员 */
  poolMembers?: RelayChannelMemberDto[] | null;
  /** Required for pooled-member channels in strict two-tier topology mode. */
  pooledParentId?: string | null;
  pooledPriority?: number;
  pooledWeight?: number;
  pooledMemberEnabled?: boolean;
  /**
   * 价格倍率
   */
  multiplier?: number;
  /** 允许的格式 */
  allowedFormats?: string | null;
  /** 允许的模型 */
  allowedModels?: string | null;
  addUserIdentifier?: boolean;
  inputTokensIncludeCacheRead?: boolean;
  /** 模型映射：请求模型 → 扣费模型 */
  modelMapping?: Record<string, string> | null;
  /** 时段倍率规则 */
  timePeriodMultipliers?: TimePeriodMultiplierRule[] | null;
  /** Input-context threshold multiplier rules. */
  contextLengthMultipliers?: ContextLengthMultiplierRule[] | null;
  /** Admin-configured providers for revenue sharing. */
  providers?: RelayChannelProviderConfigRequest[];
}

export interface UpdateRelayChannelRequest {
  /** 渠道名称 */
  name?: string;
  /** OpenAI 上游 URL */
  openaiUpstreamUrl?: string;
  /** OpenAI 上游 API Key */
  openaiUpstreamApiKey?: string;
  useProxy?: boolean;
  /** Anthropic 上游 URL */
  anthropicUpstreamUrl?: string;
  /** Anthropic 上游 API Key */
  anthropicUpstreamApiKey?: string;
  /** Gemini 上游 URL */
  geminiUpstreamUrl?: string;
  /** Gemini 上游 API Key */
  geminiUpstreamApiKey?: string;
  /** 渠道类型 */
  channelType?: RelayChannelType;
  /** 混池路由策略 */
  routingStrategy?: RelayChannelRoutingStrategy;
  /** 路由策略配置，传 null 清除 */
  routingConfig?: RelayChannelRoutingConfigDto | null;
  /** 可见性模式 */
  visibilityMode?: RelayChannelVisibilityMode;
  /** 可见性白名单，传 null 清除 */
  visibilityConfig?: RelayChannelVisibilityConfigDto | null;
  /** 混池成员，传 [] 或 null 清空 */
  poolMembers?: RelayChannelMemberDto[] | null;
  /** The sole logical pooled parent for a physical pooled member. */
  pooledParentId?: string | null;
  pooledPriority?: number;
  pooledWeight?: number;
  pooledMemberEnabled?: boolean;
  /** 价格倍率 */
  multiplier?: number;
  /** 允许的格式 */
  allowedFormats?: string | null;
  /** 允许的模型 */
  allowedModels?: string | null;
  addUserIdentifier?: boolean;
  inputTokensIncludeCacheRead?: boolean;
  /** 模型映射：请求模型 → 扣费模型，传 null 清除 */
  modelMapping?: Record<string, string> | null;
  /** 时段倍率规则 */
  timePeriodMultipliers?: TimePeriodMultiplierRule[] | null;
  /** Input-context threshold multiplier rules. */
  contextLengthMultipliers?: ContextLengthMultiplierRule[] | null;
  /** Admin-configured providers for revenue sharing. */
  providers?: RelayChannelProviderConfigRequest[];
}

/** User-facing submission. Only standalone channels are accepted. */
export interface SubmitRelayChannelRequest {
  name: string;
  openaiUpstreamUrl?: string;
  openaiUpstreamApiKey?: string;
  anthropicUpstreamUrl?: string;
  anthropicUpstreamApiKey?: string;
  geminiUpstreamUrl?: string;
  geminiUpstreamApiKey?: string;
  multiplier?: number;
  allowedFormats?: string | null;
  allowedModels?: string | null;
  inputTokensIncludeCacheRead?: boolean;
  modelMapping?: Record<string, string> | null;
  timePeriodMultipliers?: TimePeriodMultiplierRule[] | null;
  contextLengthMultipliers?: ContextLengthMultiplierRule[] | null;
  providers?: RelayChannelProviderConfigRequest[];
}

export interface ReviewRelayChannelSubmissionRequest {
  action: "approve" | "reject" | "offboard";
  reason?: string;
}

/** Operator-only revenue configuration, kept separate from review state changes. */
export interface UpdateRelayChannelProviderConfigRequest {
  multiplier?: number;
  providers?: RelayChannelProviderConfigRequest[];
}

export interface UpdateRelayChannelServiceStatusRequest {
  enabled: boolean;
}

/** Full standalone configuration proposed by the original channel submitter. */
export interface CreateRelayChannelChangeRequest {
  name: string;
  openaiUpstreamUrl?: string;
  openaiUpstreamApiKey?: string;
  anthropicUpstreamUrl?: string;
  anthropicUpstreamApiKey?: string;
  geminiUpstreamUrl?: string;
  geminiUpstreamApiKey?: string;
  multiplier?: number;
  allowedFormats?: string | null;
  allowedModels?: string | null;
  inputTokensIncludeCacheRead?: boolean;
  modelMapping?: Record<string, string> | null;
  timePeriodMultipliers?: TimePeriodMultiplierRule[] | null;
  contextLengthMultipliers?: ContextLengthMultiplierRule[] | null;
  providers?: RelayChannelProviderConfigRequest[];
}

export interface ReviewRelayChannelChangeRequest {
  action: "approve" | "reject";
  reason?: string;
}

export interface RelayChannelChangeRequestDto {
  id: string;
  relayChannelId: string;
  channelName: string;
  submittedByUserId: string;
  submittedByUsername?: string;
  reviewStatus: RelayChannelChangeRequestStatus;
  reviewedAt?: Date;
  reviewReason?: string;
  config: Omit<
    CreateRelayChannelChangeRequest,
    "openaiUpstreamApiKey" | "anthropicUpstreamApiKey" | "geminiUpstreamApiKey"
  > & {
    hasOpenaiUpstreamApiKey: boolean;
    hasAnthropicUpstreamApiKey: boolean;
    hasGeminiUpstreamApiKey: boolean;
  };
  createTime: Date;
  updateTime: Date;
}

export interface RelayChannelUpstreamModelsRequest {
  format: RelayUpstreamFormat;
  channelId?: string;
  upstreamUrl?: string;
  apiKey?: string;
}

export interface RelayChannelUpstreamModelDto {
  id: string;
  matched: boolean;
  pricingModel?: string;
  pricingModelId?: string;
}

export interface RelayChannelUpstreamModelsResponse {
  format: RelayUpstreamFormat;
  models: RelayChannelUpstreamModelDto[];
}

export interface RelayChannelProviderEarningDto {
  id: string;
  channelId: string;
  channelName: string;
  grossAmount: number;
  commissionPercent: number;
  commissionAmount: number;
  settled: boolean;
  createTime: Date;
  settledAt?: Date;
}

export interface RelayChannelProviderEarningsResponse {
  pendingAmount: number;
  settledAmount: number;
  total: number;
  page: number;
  pageSize: number;
  records: RelayChannelProviderEarningDto[];
}

export interface ClaimRelayChannelProviderEarningsResponse {
  settledAmount: number;
  settlementId?: string;
}
