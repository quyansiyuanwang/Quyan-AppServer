export interface AlipaySettingsDto {
  enabled: boolean;
  refundEnabled: boolean;
  minAmount: string;
  maxAmount: string;
  orderTimeoutMinutes: number;
  /** Full account balance URL; never taken from a payment request. */
  returnUrl: string;
}
export interface AlipayCredentialsDto {
  appId: string;
  sellerId: string;
  sandbox: boolean;
  privateKey: string;
  alipayPublicKey: string;
  keyType: "PKCS1" | "PKCS8";
  appCertContent?: string;
  alipayPublicCertContent?: string;
  alipayRootCertContent?: string;
}
export interface SetAlipayConfigDto {
  settings: AlipaySettingsDto;
  /** Omit to retain the current encrypted credentials. */
  credentials?: AlipayCredentialsDto;
}
export interface AlipayConfigDto {
  settings: AlipaySettingsDto;
  profile?: { appId: string; sellerId: string; sandbox: boolean; keyType: "PKCS1" | "PKCS8"; hasCredentials: boolean };
}
export interface PublicAlipayConfigDto {
  enabled: boolean;
  sandbox: boolean;
  minAmount: string;
  maxAmount: string;
  rechargeRatio: string;
}
export interface CreateAlipayOrderDto {
  amount: string;
  requestId: string;
}
export interface CreateAlipayRefundDto {
  amount: string;
  requestId: string;
  reason: string;
}
export interface AlipayRefundDto {
  id: string;
  outRequestNo: string;
  amount: string;
  creditAmount: string;
  state: string;
  failureCode: string | null;
  createTime: Date;
  completedAt: Date | null;
}
export interface AlipayOrderDto {
  id: string;
  userId: string;
  outTradeNo: string;
  tradeNo: string | null;
  amount: string;
  creditAmount: string;
  rechargeRatio: string;
  refundedAmount: string;
  state: string;
  sandbox: boolean;
  createTime: Date;
  expiresAt: Date;
  paidAt: Date | null;
  refunds: AlipayRefundDto[];
}
export interface AlipayOrderListDto {
  records: AlipayOrderDto[];
  total: number;
  page: number;
  pageSize: number;
}
export interface AlipayCheckoutDto {
  order: AlipayOrderDto;
  paymentUrl: string;
}
