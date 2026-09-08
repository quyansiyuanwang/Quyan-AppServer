export type CarpoolOrderState = "open" | "submitted" | "accepted" | "fulfilled" | "failed" | "cancelled" | "expired";
export interface CreateCarpoolPackageTemplateRequest {
  name: string;
  description?: string;
  salePrice: number;
  upstreamCost: number;
  maxMembers: number;
  monthlyPassTemplateId: string;
}
export interface CarpoolPackageTemplateDto {
  id: string;
  name: string;
  description?: string;
  salePrice: number;
  upstreamCost: number;
  maxMembers: number;
  monthlyPassTemplateId: string;
  publishStatus: string;
  snapshotQuota: number;
  snapshotValidityDays: number;
}
export interface CreateCarpoolOrderRequest {
  packageTemplateId: string;
  inviteValidityHours?: number;
}
export interface CreateCarpoolInviteRequest {
  validityHours?: number;
}
export interface AcceptCarpoolInviteRequest {
  token: string;
}
export interface AllocateCarpoolRatiosRequest {
  members: Array<{ memberId: string; paymentRatio: number; quotaRatio: number }>;
}
export interface FulfillCarpoolOrderRequest {
  relayChannelId: string;
}
export interface CarpoolMemberDto {
  id: string;
  userId: string;
  username: string;
  role: string;
  state: string;
  paymentRatio: number;
  quotaRatio: number;
  payableAmount: number;
  finalQuota: number;
  reservedAmount: number;
  relayTokenId?: string;
  userMonthlyPassId?: string;
}
export interface CarpoolOrderDto {
  id: string;
  state: CarpoolOrderState;
  packageName: string;
  salePrice: number;
  totalQuota: number;
  validityDays: number;
  maxMembers: number;
  relayChannelId?: string;
  members: CarpoolMemberDto[];
  paymentRatioTotal: number;
  quotaRatioTotal: number;
  allConfirmed: boolean;
}
