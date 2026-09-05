import type { DeveloperProductCode } from "@quyan/shared";

export interface DeveloperProductConfigDto {
  productCode: DeveloperProductCode;
  enabled: boolean;
  defaultDailyQuota: number;
  overagePrice: number;
  defaultInstanceLimit: number;
  retentionDays: number;
  resourceLimits?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export type UpdateDeveloperProductConfigDto = Omit<DeveloperProductConfigDto, "productCode">;

export interface DeveloperProductAccountDto {
  id: string;
  accountOwnerId: string;
  accountOwnerUsername?: string;
  accountOwnerDisplayName?: string;
  productCode: DeveloperProductCode;
  dailyFreeQuota?: number;
  overageEnabled: boolean;
  instanceLimit: number;
  createTime: string;
  updateTime: string;
}

export interface DeveloperProductManagedAccountDto {
  userId: string;
  username: string;
  displayName?: string;
  account?: DeveloperProductAccountDto;
}

export interface DeveloperProductManagedAccountsDto {
  records: DeveloperProductManagedAccountDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateDeveloperProductAccountDto {
  dailyFreeQuota: number | null;
  overageEnabled: boolean;
  instanceLimit: number;
}

export interface DeveloperProductInstanceDto {
  id: string;
  productCode: DeveloperProductCode;
  accountProductId: string;
  name: string;
  slug: string;
  enabled: boolean;
  createTime: string;
  updateTime: string;
}

export interface CreateDeveloperProductInstanceDto {
  name: string;
  slug: string;
}

export interface UpdateDeveloperProductInstanceDto {
  enabled: boolean;
}

export interface DeveloperProductApiKeyDto {
  id: string;
  name: string;
  keyPrefix: string;
  subjectUserId: string;
  actions: string[];
  expiresAt?: string;
  lastUsedAt?: string;
  requestCount: number;
  key?: string;
}

export interface CreateDeveloperProductApiKeyDto {
  name: string;
  subjectUserId: string;
  actions: string[];
  expiresAt?: string;
}

export interface DeveloperProductSubjectDto {
  id: string;
  username: string;
  displayName?: string;
  allowedActions: string[];
}

export interface DeveloperProductUsageDto {
  entitlementId: string;
  productCode: DeveloperProductCode;
  requestCount: number;
  dailyFreeQuota: number;
  remainingFree: number;
  unlimited: boolean;
  overageEnabled: boolean;
}

export interface DeveloperProductCallLogDto {
  id: string;
  entitlementId: string;
  instanceId?: string;
  keyId?: string;
  subjectUserId?: string;
  action: string;
  success: boolean;
  errorCode?: number;
  chargeAmount: number;
  createTime: string;
}
