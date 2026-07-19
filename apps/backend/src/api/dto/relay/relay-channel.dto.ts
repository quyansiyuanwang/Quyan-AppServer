export interface TimePeriodMultiplierRule {
  name: string;
  enabled: boolean;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  multiplier: number;
}

export type RelayChannelType = "standalone" | "pooled" | "automatic-proxy-pool";

export type RelayChannelRoutingStrategy =
  | "priority"
  | "random"
  | "weighted-random"
  | "round-robin"
  | "health-priority"
  | "latency-priority";

export type RelayChannelVisibilityMode = "public" | "private" | "whitelist" | "hidden";

export type RelayChannelAllowedModelsMode = "all" | "manual" | "auto";

export interface RelayChannelMemberDto {
  id?: string;
  memberChannelId: string;
  priority: number;
  weight?: number;
  enabled?: boolean;
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
  channelType: RelayChannelType;
  routingStrategy: RelayChannelRoutingStrategy;
  routingConfig?: RelayChannelRoutingConfigDto;
  visibilityMode: RelayChannelVisibilityMode;
  visibilityConfig?: RelayChannelVisibilityConfigDto;
  poolMembers?: RelayChannelMemberDto[];
  openaiUpstreamUrl?: string;
  hasOpenaiUpstreamApiKey: boolean;
  anthropicUpstreamUrl?: string;
  hasAnthropicUpstreamApiKey: boolean;
  geminiUpstreamUrl?: string;
  hasGeminiUpstreamApiKey: boolean;
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
  createTime: Date;
  updateTime: Date;
}

/**
 * Pool-transparent channel capability exposed to business-facing clients.
 * It intentionally excludes routing topology, raw configuration, upstream credentials, and visibility rules.
 */
export interface RelayChannelOptionDto {
  id: string;
  name: string;
  enabled: boolean;
  channelType: RelayChannelType;
  multiplier: number;
  allowedFormats: string;
  modelCapabilities: RelayChannelModelCapabilityDto[];
}

export interface RelayChannelModelCapabilityDto {
  catalogModelName: string;
  requestModelId: string;
  supportedRequestFormats: Array<"openai" | "anthropic" | "gemini">;
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
  /**
   * 价格倍率
   */
  multiplier?: number;
  /** 允许的格式 */
  allowedFormats?: string;
  /** 允许的模型 */
  allowedModels?: string | null;
  addUserIdentifier?: boolean;
  inputTokensIncludeCacheRead?: boolean;
  /** 模型映射：请求模型 → 扣费模型 */
  modelMapping?: Record<string, string> | null;
  /** 时段倍率规则 */
  timePeriodMultipliers?: TimePeriodMultiplierRule[] | null;
}

export interface UpdateRelayChannelRequest {
  /** 渠道名称 */
  name?: string;
  /** OpenAI 上游 URL */
  openaiUpstreamUrl?: string;
  /** OpenAI 上游 API Key */
  openaiUpstreamApiKey?: string;
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
  /** 价格倍率 */
  multiplier?: number;
  /** 允许的格式 */
  allowedFormats?: string;
  /** 允许的模型 */
  allowedModels?: string | null;
  addUserIdentifier?: boolean;
  inputTokensIncludeCacheRead?: boolean;
  /** 模型映射：请求模型 → 扣费模型，传 null 清除 */
  modelMapping?: Record<string, string> | null;
  /** 时段倍率规则 */
  timePeriodMultipliers?: TimePeriodMultiplierRule[] | null;
}
