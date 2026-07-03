export interface CreateRedemptionCodeDto {
  /**
   * 充值金额（曲）
   */
  amount: number;
  /**
   * 生成数量
   */
  count?: number;
  expiresAt?: Date;
}

export interface RedemptionCodeDto {
  id: string;
  code: string;
  amount: number;
  usedBy?: string | null;
  usedByUsername?: string | null;
  usedAt?: Date | null;
  createdBy: string;
  createdByUsername?: string | null;
  expiresAt?: Date | null;
  createTime: Date;
}

export interface RedeemCodeDto {
  /**
   * 兑换码
   */
  code: string;
}
