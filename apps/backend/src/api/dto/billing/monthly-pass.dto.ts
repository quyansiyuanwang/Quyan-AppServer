export type MonthlyPassQuotaUnit = "amount" | "request" | "token";
export type MonthlyPassTemplatePublishStatus = "draft" | "published";
export type MonthlyPassAssignmentMode = "create_new" | "extend_existing";

export interface MonthlyPassQuotaWindowInputDto {
  quotaLimit: number;
  quotaUnit: MonthlyPassQuotaUnit;
  quotaWindowHours: number;
}

export interface MonthlyPassQuotaWindowDto extends MonthlyPassQuotaWindowInputDto {
  id: string;
  usedQuota?: number;
  remainingQuota?: number;
  quotaUsagePercent?: number;
  isQuotaExceeded?: boolean;
}

export interface MonthlyPassTemplateDto {
  id: string;
  name: string;
  description?: string;
  publishStatus: MonthlyPassTemplatePublishStatus;
  publishedAt?: Date;
  allowBalanceRedemption: boolean;
  purchaseLimitPerUser?: number;
  purchaseLimitWindowDays?: number;
  originalPrice?: number;
  discountPercent?: number;
  discountedPrice?: number;
  rechargeRatio?: number;
  defaultQuota: number;
  dailyQuota?: number;
  quotaUnit: MonthlyPassQuotaUnit;
  quotaWindowHours?: number;
  quotaWindows: MonthlyPassQuotaWindowDto[];
  allowedModels?: string[];
  allowedChannels?: string[];
  status: number;
  createTime: Date;
  updateTime: Date;
}

export interface CreateMonthlyPassTemplateRequest {
  name: string;
  description?: string;
  allowBalanceRedemption?: boolean;
  purchaseLimitPerUser?: number | null;
  purchaseLimitWindowDays?: number | null;
  originalPrice?: number;
  discountPercent?: number;
  defaultQuota?: number;
  dailyQuota?: number;
  quotaUnit?: MonthlyPassQuotaUnit;
  quotaWindowHours?: number;
  quotaWindows?: MonthlyPassQuotaWindowInputDto[];
  allowedModels?: string[];
  allowedChannels?: string[];
}

export interface UpdateMonthlyPassTemplateRequest {
  name?: string;
  description?: string;
  allowBalanceRedemption?: boolean;
  purchaseLimitPerUser?: number | null;
  purchaseLimitWindowDays?: number | null;
  originalPrice?: number;
  discountPercent?: number;
  defaultQuota?: number;
  dailyQuota?: number | null;
  quotaUnit?: MonthlyPassQuotaUnit;
  quotaWindowHours?: number | null;
  quotaWindows?: MonthlyPassQuotaWindowInputDto[];
  allowedModels?: string[] | null;
  allowedChannels?: string[] | null;
  status?: number;
}

export interface MonthlyPassTemplateListResponse {
  total: number;
  records: MonthlyPassTemplateDto[];
  page: number;
  pageSize: number;
}

export interface MonthlyPassNumberFilterOptionDto {
  value: number;
  label: string;
}

export interface MonthlyPassStringFilterOptionDto {
  value: string;
  label: string;
}

export interface MonthlyPassTemplateFilterOptionDto {
  id: string;
  name: string;
  publishStatus: MonthlyPassTemplatePublishStatus;
  status: number;
}

export interface MonthlyPassGroupFilterOptionDto {
  id: string;
  username: string;
  name: string;
}

export interface MonthlyPassFilterOptionsDto {
  templateStatusOptions: MonthlyPassNumberFilterOptionDto[];
  assignmentStatusOptions: MonthlyPassNumberFilterOptionDto[];
  publishStatusOptions: MonthlyPassStringFilterOptionDto[];
  assignmentModeOptions: MonthlyPassStringFilterOptionDto[];
  quotaUnitOptions: MonthlyPassStringFilterOptionDto[];
  templates: MonthlyPassTemplateFilterOptionDto[];
  models: string[];
  channels: MonthlyPassStringFilterOptionDto[];
  groups: MonthlyPassGroupFilterOptionDto[];
}

export interface UserMonthlyPassDto {
  id: string;
  userId: string;
  username?: string;
  templateId: string;
  templateName: string;
  templateDescription?: string;
  allowedModels?: string[];
  allowedChannels?: string[];
  startAt: Date;
  endAt: Date;
  totalQuota: number;
  dailyQuota?: number;
  quotaUnit: MonthlyPassQuotaUnit;
  quotaWindowHours?: number;
  quotaWindows: MonthlyPassQuotaWindowDto[];
  usedQuota: number;
  remainingQuota: number;
  assignedBy?: string;
  note?: string;
  status: number;
  createTime: Date;
  updateTime: Date;
}

export interface AssignUserMonthlyPassRequest {
  userId: string;
  templateId: string;
  startAt: string;
  endAt: string;
  totalQuota?: number;
  dailyQuota?: number;
  quotaUnit?: MonthlyPassQuotaUnit;
  quotaWindowHours?: number;
  quotaWindows?: MonthlyPassQuotaWindowInputDto[];
  note?: string;
}

export interface ClaimMonthlyPassTemplateRequest {
  templateId: string;
}

export interface ClaimMonthlyPassResultDto {
  purchaseAmount: number;
  userPass: UserMonthlyPassDto;
}

export interface UpdateUserMonthlyPassRequest {
  startAt?: string;
  endAt?: string;
  totalQuota?: number;
  dailyQuota?: number | null;
  quotaUnit?: MonthlyPassQuotaUnit;
  quotaWindowHours?: number | null;
  quotaWindows?: MonthlyPassQuotaWindowInputDto[];
  note?: string;
  status?: number;
}

export interface MonthlyPassBatchTargetFilterDto {
  keyword?: string;
  groupId?: string;
  includeAllVisible?: boolean;
}

export interface AssignBatchUserMonthlyPassRequest {
  userIds?: string[];
  targetFilter?: MonthlyPassBatchTargetFilterDto;
  templateId: string;
  startAt: string;
  endAt: string;
  totalQuota?: number;
  dailyQuota?: number;
  quotaUnit?: MonthlyPassQuotaUnit;
  quotaWindowHours?: number;
  quotaWindows?: MonthlyPassQuotaWindowInputDto[];
  note?: string;
  assignmentMode?: MonthlyPassAssignmentMode;
}

export interface BatchAssignUserMonthlyPassItemDto {
  userId: string;
  username?: string;
  userPassId?: string;
  result: "created" | "extended" | "failed";
  message?: string;
}

export interface BatchAssignUserMonthlyPassResponse {
  totalTargets: number;
  successCount: number;
  createdCount: number;
  extendedCount: number;
  failedCount: number;
  records: BatchAssignUserMonthlyPassItemDto[];
}

export interface UserMonthlyPassListResponse {
  total: number;
  records: UserMonthlyPassDto[];
  page: number;
  pageSize: number;
}

export interface MonthlyPassUsageDto {
  id: string;
  userMonthlyPassId: string;
  userId: string;
  templateId: string;
  templateName: string;
  relayUsageId?: string;
  model?: string;
  channelId?: string;
  channelName?: string;
  coveredAmount: number;
  coveredRequests?: number;
  coveredTokens?: number;
  totalRequestCost: number;
  remainingRequestCost: number;
  description?: string;
  createTime: Date;
}

export interface MonthlyPassUsageListResponse {
  total: number;
  records: MonthlyPassUsageDto[];
  page: number;
  pageSize: number;
}
