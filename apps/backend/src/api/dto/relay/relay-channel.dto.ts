export interface TimePeriodMultiplierRule {
  name: string;
  enabled: boolean;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  multiplier: number;
}

export interface RelayChannelDto {
  id: string;
  name: string;
  enabled: boolean;
  openaiUpstreamUrl?: string;
  openaiUpstreamApiKey?: string;
  anthropicUpstreamUrl?: string;
  anthropicUpstreamApiKey?: string;
  geminiUpstreamUrl?: string;
  geminiUpstreamApiKey?: string;
  multiplier: number;
  allowedFormats: string;
  allowedModels?: string;
  addUserIdentifier?: boolean;
  inputTokensIncludeCacheRead?: boolean;
  modelMapping?: Record<string, string>;
  timePeriodMultipliers?: TimePeriodMultiplierRule[];
  createTime: Date;
  updateTime: Date;
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
