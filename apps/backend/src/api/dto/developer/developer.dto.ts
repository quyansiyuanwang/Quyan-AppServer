export type DeveloperApiKeyScope =
  | "kv:read"
  | "kv:write"
  | "verification:send"
  | "verification:verify"
  | "ip:lookup"
  | "push:send";

export interface CreateDeveloperProjectDto {
  name: string;
  slug: string;
  description?: string;
}

export interface CreateDeveloperApiKeyDto {
  name: string;
  scopes: DeveloperApiKeyScope[];
  expiresAt?: string;
}

export interface DeveloperProjectDto {
  id: string;
  name: string;
  slug: string;
  description?: string;
  dailyFreeQuota: number;
  overageEnabled: boolean;
  statusPagePublished: boolean;
  createTime: string;
  updateTime: string;
}

export interface DeveloperQuotaSummaryDto {
  dailyFreeQuota: number;
  overageEnabled: boolean;
  usages: Array<{ service: string; requestCount: number; dailyFreeQuota: number; remainingFree: number }>;
}

export interface UpdateDeveloperStatusPageDto {
  published: boolean;
}

export interface UpsertDeveloperQuotaOverrideDto {
  subjectType: "user" | "project";
  subjectId: string;
  service?: "verification" | "ip" | "push";
  dailyFreeQuota: number;
  expiresAt?: string | null;
}

export interface DeveloperQuotaOverrideDto {
  id: string;
  subjectType: "user" | "project";
  subjectId: string;
  service?: "verification" | "ip" | "push";
  dailyFreeQuota: number;
  expiresAt?: string;
  createTime: string;
  updateTime: string;
}

export interface DeveloperApiKeyDto {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: DeveloperApiKeyScope[];
  expiresAt?: string;
  lastUsedAt?: string;
  requestCount: number;
  key?: string;
}

export interface SetKvValueDto {
  value: unknown;
  ttlSeconds?: number;
}

export interface DeveloperKvValueDto {
  key: string;
  value: unknown;
  version: number;
  expiresAt?: string;
  updateTime: string;
}

export interface CreateShortLinkDto {
  targetUrl: string;
  code?: string;
  expiresAt?: string;
}

export interface UpdateShortLinkDto {
  targetUrl?: string;
  enabled?: boolean;
  expiresAt?: string | null;
}

export interface DeveloperShortLinkDto {
  id: string;
  code: string;
  targetUrl: string;
  enabled: boolean;
  expiresAt?: string;
  clickCount: number;
  publicUrl: string;
}

export interface DeveloperShortLinkStatsDto {
  linkId: string;
  code: string;
  totalClicks: number;
  uniqueVisitors: number;
  periodStart: string;
  periodEnd: string;
  clicksByDay: Array<{ date: string; count: number }>;
  clicksByHour: Array<{ hour: string; count: number }>;
  sources: Array<{ sourceHost?: string; count: number }>;
  countries: Array<{ country?: string; count: number }>;
  ipAddresses: Array<{ ipAddress?: string; count: number }>;
  recentClicks: Array<{
    clickedAt: string;
    ipAddress?: string;
    sourceHost?: string;
    country?: string;
    userAgent?: string;
  }>;
  page: number;
  pageSize: number;
  totalRecords: number;
}

export interface UpsertDeveloperSecretDto {
  alias: string;
  value: string;
}

export interface DeveloperSecretDto {
  id: string;
  alias: string;
  keyVersion: number;
  lastUsedAt?: string;
  createTime: string;
  updateTime: string;
}

export interface CreateDeveloperStatusMonitorDto {
  name: string;
  targetUrl: string;
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON request payload. Only supported by POST, PUT, PATCH, and DELETE monitors. */
  requestBody?: string;
  /** How the raw response body is matched when responseBodyMatch is configured. */
  responseBodyMatchMode?: "contains" | "equals";
  /** Expected raw response body text. The monitor is down when it does not match. */
  responseBodyMatch?: string;
  intervalSec?: number;
  alertDelayMinutes?: number;
  successStatusCodes?: number[];
}

export interface UpdateDeveloperStatusMonitorDto {
  name?: string;
  targetUrl?: string;
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Set to null to clear the JSON request payload. */
  requestBody?: string | null;
  /** Set to null to disable response body matching. */
  responseBodyMatchMode?: "contains" | "equals" | null;
  /** Set to null to clear the expected response body text. */
  responseBodyMatch?: string | null;
  intervalSec?: number;
  alertDelayMinutes?: number;
  successStatusCodes?: number[];
  enabled?: boolean;
}

export interface DeveloperStatusMonitorDto {
  id: string;
  name: string;
  targetUrl: string;
  method: string;
  requestBody?: string;
  responseBodyMatchMode?: "contains" | "equals";
  responseBodyMatch?: string;
  intervalSec: number;
  alertDelayMinutes: number;
  successStatusCodes?: number[];
  enabled: boolean;
  lastCheckedAt?: string;
  lastStatus?: string;
  downSinceAt?: string;
  downAlertedAt?: string;
}

export interface SendDeveloperVerificationDto {
  channel: "email" | "sms";
  recipient: string;
  purpose: string;
}

export interface VerifyDeveloperCodeDto extends SendDeveloperVerificationDto {
  code: string;
}

export interface CreateDeveloperPushChannelDto {
  name: string;
  type: "webhook" | "dingtalk" | "feishu" | "wechat_work";
  endpoint: string;
  secretReference?: DeveloperPushSecretReferenceDto;
}

/** A write-only credential stored by a selected Secret Management instance. */
export interface DeveloperPushSecretReferenceDto {
  secretInstanceId: string;
  alias: string;
}

export interface DeveloperPushChannelDto {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  secretReference?: DeveloperPushSecretReferenceDto;
  /** Alias retained for concise table display; values are always stored in Secret Management. */
  secretAlias?: string;
  enabled: boolean;
  createTime: string;
  updateTime: string;
}

export interface UpdateDeveloperPushChannelDto {
  name?: string;
  endpoint?: string;
  secretReference?: DeveloperPushSecretReferenceDto | null;
  enabled?: boolean;
}

export interface SendDeveloperPushDto {
  channelIds: string[];
  title: string;
  content: string;
  idempotencyKey?: string;
}

export interface DeveloperPushDeliveryDto {
  id: string;
  channelId: string;
  success: boolean;
  error?: string;
  status: string;
  attemptCount: number;
  nextRetryAt?: string;
  createTime: string;
  updateTime: string;
}
