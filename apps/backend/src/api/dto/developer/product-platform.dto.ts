import type { DeveloperProductCode } from "@appserver/shared";

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

export interface DeveloperProductEntitlementDto {
  id: string;
  accountOwnerId: string;
  productCode: DeveloperProductCode;
  enabled: boolean;
  dailyFreeQuota?: number;
  overageEnabled: boolean;
  instanceLimit: number;
  startsAt?: string;
  expiresAt?: string;
  ownerPolicyId?: string;
  createTime: string;
  updateTime: string;
}

export interface UpsertDeveloperProductEntitlementDto {
  accountOwnerId: string;
  enabled?: boolean;
  dailyFreeQuota?: number | null;
  overageEnabled?: boolean;
  instanceLimit?: number;
  startsAt?: string | null;
  expiresAt?: string | null;
}

export interface DeveloperProductInstanceDto {
  id: string;
  productCode: DeveloperProductCode;
  entitlementId: string;
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
}

export interface DeveloperProductUsageDto {
  entitlementId: string;
  productCode: DeveloperProductCode;
  requestCount: number;
  dailyFreeQuota: number;
  remainingFree: number;
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
