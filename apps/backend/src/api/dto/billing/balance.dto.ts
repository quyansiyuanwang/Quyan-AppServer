import type { BalanceOverdraftCategory } from "@quyan/shared";

export interface BalanceAccountResponse {
  id: string;
  userId: string;
  balance: number;
  createTime: Date;
  updateTime: Date;
}

export interface BalanceOverdraftSummary {
  /** 当前生效的超额消费上限，单位：曲。 */
  overdraftLimit: number;
  /** 当前负余额已占用的额度；可能超过上限。 */
  usedOverdraft: number;
  /** 扣除已用额度后可继续使用的额度，不小于零。 */
  remainingOverdraft: number;
  categories: BalanceOverdraftCategory[];
  calculationError: boolean;
  /** 未初始化的账户仍可使用默认规则；被停用的已有账户不可消费。 */
  accountActive: boolean;
}

export interface MyBalanceAccountResponse extends BalanceAccountResponse {
  /** 当前登录账户的超额消费信息；兼容旧版客户端。 */
  overdraft?: BalanceOverdraftSummary;
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
  | "account_adjustment"
  | "alipay_recharge"
  | "alipay_refund_hold"
  | "alipay_refund_reversal"
  | "redemption"
  | "gift_code_create"
  | "gift_code_redeem"
  | "gift_code_cancel"
  | "peer_transfer_out"
  | "peer_transfer_in"
  | "chat_usage"
  | "api_usage"
  | "monthly_pass_coverage"
  | "channel_commission"
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
  /** Cache read tokens divided by this request's input context tokens. */
  cacheHitRate?: number | null;
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
