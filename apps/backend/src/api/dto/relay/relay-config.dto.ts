export interface ModelPricingItemDto {
  /** 模型名称（配置项名称） */
  model: string;
  /** 请求模型 ID（为空时默认等于 model） */
  modelId?: string;
  pricingType?: "token-based" | "per-request";
  /** 输入价格 */
  inputPrice: number;
  /** 输出价格 */
  outputPrice: number;
  /** 固定价格 */
  fixedPrice?: number;
  /** 缓存创建倍率 */
  cacheCreationMultiplier: number;
  /** 缓存读取倍率 */
  cacheReadMultiplier: number;
  /** 支持格式 */
  supportedFormats?: string;
}

export interface RelayConfigDto {
  id?: string;
  globalMultiplier: number;
  maxConcurrency: number;
  queueTimeout: number;
  /** 上游流式请求超时（毫秒） */
  upstreamStreamTimeout: number;
  enableQueue: boolean;
  /** Whether API documentation publishes pooled routes anonymously or hides them. */
  apiCatalogPoolVisibility: "hidden" | "anonymous-range";
  modelRates: ModelPricingItemDto[];
  uptimeStatusUrl?: string;
  monitorNameMapping?: Record<string, string> | null; // 监控项名称映射 { "2": "中国主线路", "3": "国际线路" }
  showOnlyConfigured?: boolean; // 是否仅展示已配置的监控项
  uptimeTransformRules?: any; // 保留用于向后兼容
  uptimeStaticData?: any;
}

export interface UpdateRelayConfigRequest {
  /** 全局倍率 */
  globalMultiplier?: number;
  /** 最大并发 */
  maxConcurrency?: number;
  /** 队列超时 */
  queueTimeout?: number;
  /** 上游流式请求超时（毫秒） */
  upstreamStreamTimeout?: number;
  enableQueue?: boolean;
  apiCatalogPoolVisibility?: "hidden" | "anonymous-range";
  modelRates?: ModelPricingItemDto[];
  /** Uptime 状态 URL */
  uptimeStatusUrl?: string;
  monitorNameMapping?: Record<string, string> | null;
  showOnlyConfigured?: boolean;
  uptimeTransformRules?: any;
  uptimeStaticData?: any;
}

export interface HeartbeatItem {
  status: number;
  time: string;
  msg: string;
  ping: number | null;
}

export interface UptimeMonitor {
  id?: string;
  name: string;
  uptime: number;
  status: number;
  group?: string;
  heartbeats?: HeartbeatItem[];
}

export interface UptimeCategory {
  categoryName: string;
  monitors: UptimeMonitor[];
}

export interface UpstreamApiResponse {
  heartbeatList: Record<string, HeartbeatItem[]>;
  uptimeList: Record<string, number>;
}

export interface UptimeResponse {
  data: UptimeCategory[];
  message: string;
  success: boolean;
}

export interface RelayConcurrencyStatusItemDto {
  key: string;
  userId: string;
  scope: "default" | "image";
  source: "local" | "redis";
  activeCount: number;
  ttlSeconds: number | null;
  queueLength: number;
}

export interface RelayConcurrencyStatusLimitsDto {
  maxConcurrency: number;
  effectiveImageMaxConcurrency: number;
  imageMaxConcurrencyCap: number;
  enableQueue: boolean;
  queueTimeoutMs: number;
  effectiveImageQueueTimeoutMs: number;
  imageQueueTimeoutMs: number;
  upstreamStreamTimeoutMs: number;
  nonStreamUpstreamTimeoutMs: number;
}

export interface RelayConcurrencyStatusTotalsDto {
  activeCount: number;
  defaultScopeActiveCount: number;
  imageScopeActiveCount: number;
  queuedCount: number;
  userCount: number;
}

export interface RelayConcurrencyStatusResponse {
  redisAvailable: boolean;
  userId?: string;
  limits: RelayConcurrencyStatusLimitsDto;
  totals: RelayConcurrencyStatusTotalsDto;
  items: RelayConcurrencyStatusItemDto[];
}
