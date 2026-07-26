export type RelayTokenQuotaUnit = "amount" | "request" | "token";

export interface RelayTokenQuotaWindowInputDto {
  /** 窗口额度 */
  quotaLimit: number;
  /** 窗口额度单位 */
  quotaUnit: RelayTokenQuotaUnit;
  /** 滑动窗口时长（小时，可带小数；0 表示零窗口） */
  quotaWindowHours: number;
}

export interface RelayTokenQuotaWindowDto extends RelayTokenQuotaWindowInputDto {
  id: string;
  usedQuota: number;
  remainingQuota: number;
  quotaUsagePercent?: number;
  isQuotaExceeded: boolean;
}

export interface DuplicateRelayTokenRequest {
  /** 新令牌名称，不传则自动生成 */
  name?: string | null;
  /** 目标用户 ID，不传则为当前用户 */
  targetUserId?: string;
}

export interface RelayTokenImportItemDto extends CreateRelayTokenDto {
  /** 导入后要使用的固定令牌值，不传或冲突时自动生成 */
  token?: string;
  /** 导入后是否启用，默认启用 */
  enabled?: boolean;
}

export interface RelayTokenExportItemDto extends RelayTokenImportItemDto {
  id: string;
  token: string;
  enabled: boolean;
  createTime: Date;
  updateTime: Date;
}

export interface RelayTokenExportResponse {
  tokens: RelayTokenExportItemDto[];
}

export interface ExportRelayTokensRequest {
  ids?: string[];
  includeDisabled?: boolean;
  targetUserId?: string;
}

export interface ImportRelayTokensRequest {
  tokens: RelayTokenImportItemDto[];
  targetUserId?: string;
}

export interface ImportRelayTokensResponse {
  code: number;
  message: string;
  created: number;
  total: number;
  data: RelayTokenDto[];
}

export interface BatchSetRelayTokenStatusRequest {
  ids: string[];
  enabled: boolean;
  targetUserId?: string;
}

export interface BatchDeleteRelayTokensRequest {
  ids: string[];
  targetUserId?: string;
}

export interface BatchDuplicateRelayTokensRequest {
  ids: string[];
  targetUserId?: string;
}

export interface BatchRelayTokensResultDto {
  total: number;
  affected: number;
}

export interface CreateRelayTokenDto {
  routingMode?: "ordered" | "automatic-pool";
  automaticProxyPoolChannelId?: string;
  /** 目标用户 ID，不传则为当前用户 */
  targetUserId?: string;
  /**
   * Token 名称
   */
  name?: string | null;
  /**
   * 自定义令牌值（需 relay:token:custom_key 权限），不传则自动生成
   */
  token?: string;
  expiresAt?: string | null;
  /**
   * 渠道 ID
   */
  channelId?: string;
  /**
   * 有序渠道配置
   */
  channelConfigs?: RelayTokenChannelConfigInputDto[];
  /**
   * 自动切换配置
   */
  failoverConfig?: RelayTokenFailoverConfigDto;
  /**
   * 额度限制（曲），不填则无限制
   */
  quotaLimit?: number | null;
  /**
   * 滑动窗口额度规则
   */
  quotaWindows?: RelayTokenQuotaWindowInputDto[];
  /**
   * 允许的模型列表，逗号分隔
   */
  allowedModels?: string | null;
  /**
   * IP 白名单，支持换行、逗号或分号分隔
   */
  ipWhitelist?: string | null;
  /** 模型映射：请求模型 → 扣费模型 */
  modelMapping?: Record<string, string>;
}

export interface UpdateRelayTokenDto {
  routingMode?: "ordered" | "automatic-pool";
  automaticProxyPoolChannelId?: string | null;
  targetUserId?: string;
  /** Token 名称 */
  name?: string | null;
  /** 自定义令牌值（需 relay:token:custom_key 权限），不传则不修改 */
  token?: string;
  expiresAt?: string | null;
  /** 默认渠道 ID（兼容旧字段） */
  channelId?: string;
  /** 有序渠道配置 */
  channelConfigs?: RelayTokenChannelConfigInputDto[];
  /** 自动切换配置 */
  failoverConfig?: RelayTokenFailoverConfigDto;
  /** 额度限制（曲） */
  quotaLimit?: number | null;
  /** 滑动窗口额度规则 */
  quotaWindows?: RelayTokenQuotaWindowInputDto[];
  /** 允许的模型列表 */
  allowedModels?: string | null;
  /** IP 白名单 */
  ipWhitelist?: string | null;
  /** 模型映射：请求模型 → 扣费模型，传 null 清除 */
  modelMapping?: Record<string, string> | null;
}

export interface UpdateRelayTokenChannelDto {
  targetUserId?: string;
  /** 渠道 ID */
  channelId: string;
}

export interface RelayTokenChannelConfigInputDto {
  /** 渠道 ID */
  channelId: string;
  /** 优先级，数字越小越靠前 */
  priority: number;
}

export interface RelayTokenFailoverConfigDto {
  /** 是否启用自动切换 */
  enabled: boolean;
  /**
   * 最大渠道切换次数
   * @minimum 0
   * @maximum 100
   * @default 0
   */
  maxRetries: number;
  /** 触发切换的 HTTP 状态码/匹配规则，如 401、4xx、/^5(02|03)$/ */
  retryStatusCodes: string[];
  /**
   * 单渠道重试次数（0 = 不重试直接切换，1 = 重试1次）
   * @minimum 0
   * @maximum 100
   * @default 0
   */
  failoverThreshold: number;
  /**
   * 切换后保持当前渠道优先的时长（分钟），0 表示关闭
   * @minimum 0
   * @maximum 525600
   * @default 0
   */
  failbackCooldownMinutes: number;
}

export interface RelayTokenChannelConfigDto {
  channelId: string;
  channelName?: string;
  priority: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  lastUsedAt?: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
}

export interface RelayChannelSwitchLogDto {
  id: string;
  relayTokenId: string;
  fromDisplayChannelId?: string;
  fromDisplayChannelName?: string;
  toDisplayChannelId?: string;
  toDisplayChannelName?: string;
  triggerStatusCode?: number;
  triggerError?: string;
  attemptNumber: number;
  requestPath: string;
  method: string;
  modelName?: string;
  createTime: Date;
}

export interface RelayTokenDto {
  id: string;
  userId: string;
  username?: string;
  ownerName?: string;
  name?: string;
  token: string;
  balance: number;
  totalTokens: number;
  requestCount: number;
  usedQuota: number;
  channelId?: string;
  channelName?: string;
  routingMode?: "ordered" | "automatic-pool";
  automaticProxyPoolChannelId?: string;
  expiresAt?: Date;
  lastUsedAt?: Date;
  createTime: Date;
  status: number; // see MANAGED_STATUS
  quotaLimit?: number; // 额度限制（曲）
  quotaWindows: RelayTokenQuotaWindowDto[];
  allowedModels?: string; // 允许的模型列表
  ipWhitelist?: string;
  modelMapping?: Record<string, string>;
  channelConfigs: RelayTokenChannelConfigDto[];
  /** True when legacy ordered configuration still references an automatic pool. */
  hasInvalidOrderedChannels?: boolean;
  failoverConfig?: RelayTokenFailoverConfigDto;
}

export interface RelayTokenPageDto {
  items: RelayTokenDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RelayUsageDto {
  id: string;
  relayTokenId: string;
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  path: string;
  method: string;
  statusCode: number;
  ipAddress: string;
  createTime: Date;
}

export interface RelayUsageStatsDto {
  totalTokens: number;
  requestCount: number;
  avgTokensPerRequest: number;
  usages: RelayUsageDto[];
}

export interface RelayTokenUsageSummaryDto {
  relayTokenId: string;
  tokenName?: string;
  quotaLimit?: number;
  usedQuota: number;
  remainingQuota?: number;
  quotaUsagePercent?: number;
  isQuotaExceeded: boolean;
  rangeMode?: "lifetime" | "window" | "custom" | "daily-reset";
  rangeLabel?: string;
  rangeStartAt?: Date;
  rangeEndAt?: Date;
  requestCount: number;
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  chargedAmount: number;
  coveredAmount: number;
  totalSpend: number;
  lastUsedAt?: Date;
}

export interface RelayTokenCurrentQuotaDto {
  scopedSummary: RelayTokenUsageSummaryDto;
  balance: number;
  status: number;
  expiresAt?: Date;
  quotaWindows: RelayTokenQuotaWindowDto[];
  allowedModels?: string;
  ipWhitelist?: string;
  allTimeSummary: RelayTokenUsageSummaryDto;
}

export interface RelayTokenUsageDetailItemDto extends RelayUsageDto {
  chargedAmount: number;
  coveredAmount: number;
  totalSpend: number;
}

export interface RelayTokenUsageDetailDto extends RelayTokenUsageSummaryDto {
  total: number;
  limit: number;
  offset: number;
  usages: RelayTokenUsageDetailItemDto[];
}

export interface RelayTokenUsageSummaryBatchDto {
  summaries: RelayTokenUsageSummaryDto[];
}

export interface RelayTokenCurrentQuotaQueryDto {
  startDate?: string;
  endDate?: string;
  windowHours?: number;
  resetAt?: string;
  timezoneOffsetMinutes?: number;
}

export interface RelayAvailableModelsMapDto {
  /** 去重后的模型名称列表 */
  modelNames: string[];
  /** 仅包含可唯一映射的 modelId -> modelName */
  modelIdToModelNameMap: Record<string, string>;
  /** 所有 modelId -> modelNames[] 的映射（包括一对多） */
  modelIdToModelNamesMap: Record<string, string[]>;
  /** 去重后的模型ID列表 */
  modelIds: string[];
}

export interface RelayTokenSwitchLogsDto {
  logs: RelayChannelSwitchLogDto[];
}

export interface RelayTokenAvailableModelsDto {
  /** OpenAI 格式可用模型列表 */
  openai: string[];
  /** Anthropic 格式可用模型列表 */
  anthropic: string[];
  /** Gemini 格式可用模型列表 */
  gemini: string[];
}
