export type CarpoolOrderState = "open" | "submitted" | "accepted" | "fulfilled" | "failed" | "cancelled" | "expired";
export type CarpoolAllocationMode = "equal" | "custom";

export interface CreateCarpoolPackageTemplateRequest {
  name: string;
  description?: string;
  salePrice: number;
  upstreamCost: number;
  maxMembers: number;
  formationDeadlineHours?: number;
  monthlyPassTemplateId: string;
}
export type UpdateCarpoolPackageTemplateRequest = CreateCarpoolPackageTemplateRequest;

export interface CarpoolPackageTemplateDto {
  id: string;
  name: string;
  description?: string;
  salePrice: number;
  /** Operational-only field; omitted from public package catalog responses. */
  upstreamCost?: number;
  maxMembers: number;
  formationDeadlineHours: number;
  monthlyPassTemplateId: string;
  publishStatus: string;
  snapshotQuota: number;
  snapshotQuotaUnit: string;
  snapshotQuotaWindowHours?: number;
  snapshotValidityDays: number;
  estimatedSeatPrice: number;
  /** Operational-only field; omitted from public package catalog responses. */
  estimatedSeatCost?: number;
  /** Operational-only field; omitted from public package catalog responses. */
  estimatedGrossMargin?: number;
}
export interface CarpoolPackageTemplateListResponse {
  total: number;
  records: CarpoolPackageTemplateDto[];
}

export interface CreateCarpoolOrderRequest {
  packageTemplateId: string;
}
export interface CreateCarpoolInviteRequest {
  validityHours?: number;
}
export interface AcceptCarpoolInviteRequest {
  token: string;
}
export interface AllocateCarpoolRatiosRequest {
  allocationMode?: CarpoolAllocationMode;
  /** Required only for custom allocation. Equal allocation is calculated server-side. */
  members?: Array<{ memberId: string; paymentRatio: number; quotaRatio: number }>;
}
export interface FulfillCarpoolOrderRequest {
  relayChannelId: string;
}
export interface FailCarpoolOrderRequest {
  reason: string;
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
  confirmedAt?: Date;
  leftAt?: Date;
  relayTokenId?: string;
  userMonthlyPassId?: string;
}
export interface CarpoolOrderEventDto {
  id: string;
  type: string;
  actorUserId?: string;
  createTime: Date;
  metadata?: Record<string, unknown>;
}
export interface CarpoolOrderActionsDto {
  canInvite: boolean;
  canAllocate: boolean;
  canConfirm: boolean;
  canLeave: boolean;
  canCancel: boolean;
  canSubmit: boolean;
  reason?: string;
}
export interface CarpoolDeliveryChannelDto {
  id: string;
  name: string;
  channelType: string;
}
export interface CarpoolDeliveryChannelListResponse {
  total: number;
  records: CarpoolDeliveryChannelDto[];
}
export interface CarpoolOrderDto {
  id: string;
  state: CarpoolOrderState;
  allocationMode: CarpoolAllocationMode;
  packageName: string;
  monthlyPassTemplateId?: string;
  salePrice: number;
  upstreamCost?: number;
  totalQuota: number;
  quotaUnit: string;
  quotaWindowHours?: number;
  validityDays: number;
  maxMembers: number;
  formationDeadlineAt?: Date;
  submittedAt?: Date;
  acceptedAt?: Date;
  fulfilledAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
  expiredAt?: Date;
  failureReason?: string;
  relayChannelId?: string;
  relayChannelName?: string;
  members: CarpoolMemberDto[];
  events: CarpoolOrderEventDto[];
  paymentRatioTotal: number;
  quotaRatioTotal: number;
  activeMemberCount: number;
  allConfirmed: boolean;
  viewerActions?: CarpoolOrderActionsDto;
}
export interface CarpoolOrderListResponse {
  total: number;
  records: CarpoolOrderDto[];
  /** Administrative lists include totals for each workflow state. */
  stateCounts?: Record<string, number>;
}
