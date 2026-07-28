export interface BalanceAccountResponse {
  id: string;
  userId: string;
  balance: number;
  createTime: Date;
  updateTime: Date;
}

export interface RechargeRequest {
  /** 目标用户 ID */
  userId: string;
  /**
   * 充值金额（曲），可为负数（扣款）
   */
  amount: number;
  /** 备注信息 */
  description?: string;
  /** 是否计入充值/花销统计，默认 false */
  countAsStatistics?: boolean;
}

export type BalanceTransactionCategory =
  | "redemption"
  | "chat_usage"
  | "api_usage"
  | "monthly_pass_coverage"
  | "recharge";

export interface BalanceTransactionResponse {
  id: string;
  userId: string;
  type: string;
  category: BalanceTransactionCategory;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description?: string;
  model?: string;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  inputRate?: number;
  outputRate?: number;
  multiplier?: number;
  cacheCreationMultiplier?: number;
  cacheReadMultiplier?: number;
  /** 服务端生成的逻辑请求 ID，可提供给支持人员用于排障。 */
  requestId?: string;
  displayChannelName?: string;
  channelMultiplier?: number;
  globalMultiplier?: number;
  timeMultiplier?: number;
  /** Complete input-context token count used to select a context tier. */
  contextTokens?: number;
  contextMultiplier?: number;
  contextRuleName?: string;
  tokenName?: string;
  totalOutputTime?: number;
  timeToFirstByte?: number;
  isStreaming?: boolean;
  pricingType?: "token-based" | "per-request";
  fixedPrice?: number;
  createTime: Date;
}

export interface TransactionListResponse {
  total: number;
  records: BalanceTransactionResponse[];
  page: number;
  pageSize: number;
}
