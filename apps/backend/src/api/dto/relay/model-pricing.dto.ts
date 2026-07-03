export interface ModelPricingDto {
  id?: string;
  model: string;
  pricingType?: "token-based" | "per-request";
  inputPrice: number;
  outputPrice: number;
  fixedPrice?: number;
  provider?: string;
  cacheCreationMultiplier?: number;
  cacheReadMultiplier?: number;
  supportedFormats?: string;
}

export interface ModelPricingListResponse {
  models: ModelPricingDto[];
}

export interface CreateModelPricingRequest {
  /**
   * 模型名称
   */
  model: string;
  pricingType?: "token-based" | "per-request";
  /**
   * 输入价格（曲/百万token）
   */
  inputPrice: number;
  /**
   * 输出价格（曲/百万token）
   */
  outputPrice: number;
  /**
   * 固定价格（曲/次）
   */
  fixedPrice?: number;
  /** 供应商 */
  provider?: string;
  /** 缓存创建倍率 */
  cacheCreationMultiplier?: number;
  /** 缓存读取倍率 */
  cacheReadMultiplier?: number;
  /** 支持格式 */
  supportedFormats?: string;
}

export interface UpdateModelPricingRequest {
  /** 模型名称 */
  model?: string;
  pricingType?: "token-based" | "per-request";
  /** 输入价格 */
  inputPrice?: number;
  /** 输出价格 */
  outputPrice?: number;
  /** 固定价格 */
  fixedPrice?: number;
  /** 供应商 */
  provider?: string;
  /** 缓存创建倍率 */
  cacheCreationMultiplier?: number;
  /** 缓存读取倍率 */
  cacheReadMultiplier?: number;
  /** 支持格式 */
  supportedFormats?: string;
}

export interface CreateModelPricingResponse {
  code: number;
  message: string;
  data: ModelPricingDto;
}

export interface UpdateModelPricingResponse {
  code: number;
  message: string;
  data: ModelPricingDto;
}

export interface DeleteModelPricingResponse {
  code: number;
  message: string;
}
