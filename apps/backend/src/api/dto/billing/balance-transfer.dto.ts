export interface BalanceTransferConfigDto {
  giftCodeEnabled: boolean;
  directTransferEnabled: boolean;
  giftCodeFeePercent: number;
  directTransferFeePercent: number;
  giftCodeCancelFeeRefundPercent: number;
}

export interface CreateBalanceGiftCodeDto {
  /** 收款人最终到账金额 */
  amount: number;
  /** 可选兑换截止时间 */
  expiresAt?: Date;
}

export interface BalanceGiftCodeDto {
  id: string;
  code: string;
  amount: number;
  feeAmount: number;
  feePercent: number;
  cancelFeeRefundPercent: number;
  totalDebit: number;
  refundedAmount?: number | null;
  state: "active" | "redeemed" | "cancelled";
  redeemedByUsername?: string | null;
  redeemedAt?: Date | null;
  cancelledAt?: Date | null;
  expiresAt?: Date | null;
  createTime: Date;
}

export interface BalanceGiftCodeListResponse {
  total: number;
  records: BalanceGiftCodeDto[];
  page: number;
  pageSize: number;
}

export interface CancelBalanceGiftCodeResponse {
  refundedAmount: number;
  balance: number;
}

export interface CreateBalanceTransferDto {
  /** 收款人唯一用户名 */
  recipientUsername: string;
  /** 收款人最终到账金额 */
  amount: number;
  description?: string;
}

export interface BalanceTransferResponse {
  id: string;
  recipientUsername: string;
  amount: number;
  feeAmount: number;
  feePercent: number;
  totalDebit: number;
  balance: number;
  createTime: Date;
}
