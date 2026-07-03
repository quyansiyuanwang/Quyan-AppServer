// OJSubmitter AI问答接口 DTO定义

export interface AskQuestionRequest {
  /**
   * 问题内容
   */
  question: string;
  /**
   * 使用的模型
   */
  model?: string;
  /**
   * 最大 token 数
   */
  maxTokens?: number;
}

export interface AskQuestionResponse {
  answer: string;
  tokensUsed: number;
  cost: number;
}

export interface CreateOJAPIKeyRequest {
  /**
   * API Key 名称
   */
  name?: string;
  expiresAt?: Date;
  /**
   * 关联的渠道 ID
   */
  channelId?: string;
}

export interface UpdateOJAPIKeyRequest {
  name?: string;
  expiresAt?: Date | null;
  channelId?: string | null;
}

export interface OJAPIKeyDto {
  id: string;
  name?: string;
  key: string;
  requestCount: number;
  totalTokens: number;
  expiresAt?: Date;
  lastUsedAt?: Date;
  createTime: Date;
  channelId?: string;
  channelName?: string;
}

export interface OJUsageRecordDto {
  id: string;
  model: string;
  question: string;
  answer: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  createTime: Date;
}

export interface OJUsageStatsDto {
  totalTokens: number;
  totalCost: number;
  requestCount: number;
  avgTokensPerRequest: number;
  avgCostPerRequest: number;
  usages: OJUsageRecordDto[];
}

export interface OJModelPricingDto {
  id: string;
  model: string;
  inputPrice: number;
  outputPrice: number;
  multiplier: number;
  cacheCreationMultiplier: number;
  cacheReadMultiplier: number;
  provider?: string;
  createTime: Date;
  updateTime: Date;
}

export interface CreateOJModelPricingRequest {
  /** 模型名称 */
  model: string;
  /** 输入价格 */
  inputPrice: number;
  /** 输出价格 */
  outputPrice: number;
  /** 全局倍率 */
  multiplier?: number;
  /** 缓存创建倍率 */
  cacheCreationMultiplier?: number;
  /** 缓存读取倍率 */
  cacheReadMultiplier?: number;
  /** 供应商 */
  provider?: string;
}

export interface UpdateOJModelPricingRequest {
  /** 输入价格 */
  inputPrice?: number;
  /** 输出价格 */
  outputPrice?: number;
  /** 全局倍率 */
  multiplier?: number;
  /** 缓存创建倍率 */
  cacheCreationMultiplier?: number;
  /** 缓存读取倍率 */
  cacheReadMultiplier?: number;
  /** 供应商 */
  provider?: string;
}
