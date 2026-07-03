export interface RemoteTerminalInstallTokenDto {
  token: string;
  expiresAt: string;
}

export type RemoteTerminalPlatform = "windows" | "linux" | "macos";
export type RemoteTerminalSessionMode = "shell";
export type RemoteTerminalShellType = "system-default" | "cmd" | "powershell" | "pwsh" | "bash" | "zsh" | "sh";
export type RemoteTerminalSessionStatus = "pending" | "connected" | "closed";

export interface RemoteTerminalDeviceDto {
  deviceId: string;
  hostname: string;
  platform: RemoteTerminalPlatform;
  arch: string;
  availableShells: RemoteTerminalShellType[];
  lastSeenAt: string;
  registeredAt: string;
  online: boolean;
}

export interface RemoteTerminalDeviceListDto {
  items: RemoteTerminalDeviceDto[];
}

export interface RemoteTerminalDeviceProbeResultDto {
  deviceId: string;
  online: boolean;
  lastSeenAt: string;
}

export interface RemoteTerminalDeviceProbeResponseDto {
  items: RemoteTerminalDeviceProbeResultDto[];
}

export interface RemoteTerminalSessionSummaryDto {
  sessionId: string;
  deviceId: string;
  mode: RemoteTerminalSessionMode;
  shellType: RemoteTerminalShellType;
  status: RemoteTerminalSessionStatus;
  createdAt: string;
}

export interface RemoteTerminalSessionListDto {
  items: RemoteTerminalSessionSummaryDto[];
}

export interface CreateRemoteTerminalSessionRequest {
  deviceId: string;
  mode: RemoteTerminalSessionMode;
  shellType: RemoteTerminalShellType;
  workingDirectory?: string;
}

export interface RemoteTerminalSessionDto {
  sessionId: string;
  deviceId: string;
  mode: RemoteTerminalSessionMode;
  shellType: RemoteTerminalShellType;
  browserToken: string;
  websocketUrl: string;
  createdAt: string;
}

export interface RemoteTerminalUsageSummaryDto {
  activeSessionCount: number;
  totalTerminalLimit: number;
  remainingTerminalCount: number;
  activeDeviceCount: number;
  totalDeviceLimit: number;
  remainingDeviceCount: number;
  terminalQuotaReached: boolean;
  deviceQuotaReached: boolean;
}

export interface RemoteTerminalDirectoryEntryDto {
  name: string;
  path: string;
}

export interface RemoteTerminalDirectoryBrowseDto {
  currentPath: string;
  parentPath?: string;
  items: RemoteTerminalDirectoryEntryDto[];
}

export type RemoteTerminalShortcutModifier = "ctrl" | "alt" | "shift" | "meta";
export type RemoteTerminalShortcutKind = "sequence" | "key";

export interface RemoteTerminalShortcutDto {
  id: string;
  label: string;
  kind: RemoteTerminalShortcutKind;
  sequence: string[];
  key?: string;
  modifiers?: RemoteTerminalShortcutModifier[];
  preset?: boolean;
}

export interface RemoteTerminalQuickCommandDto {
  id: string;
  label: string;
  command: string;
}

export interface RemoteTerminalAgentPreferencesDto {
  deviceId: string;
  defaultWorkingDirectory?: string;
  shortcuts: RemoteTerminalShortcutDto[];
  quickCommands: RemoteTerminalQuickCommandDto[];
}

export interface UpdateRemoteTerminalAgentPreferencesRequest {
  deviceId: string;
  defaultWorkingDirectory?: string | null;
  shortcuts: RemoteTerminalShortcutDto[];
  quickCommands: RemoteTerminalQuickCommandDto[];
}

export type RemoteTerminalProductTemplatePublishStatus = "draft" | "published";

export interface RemoteTerminalNumberFilterOptionDto {
  value: number;
  label: string;
}

export interface RemoteTerminalStringFilterOptionDto {
  value: string;
  label: string;
}

export interface RemoteTerminalProductTemplateFilterOptionDto {
  id: string;
  name: string;
  publishStatus: string;
  status: number;
}

export interface RemoteTerminalFilterOptionsDto {
  templateStatusOptions: RemoteTerminalNumberFilterOptionDto[];
  assignmentStatusOptions: RemoteTerminalNumberFilterOptionDto[];
  deviceStatusOptions: RemoteTerminalNumberFilterOptionDto[];
  publishStatusOptions: RemoteTerminalStringFilterOptionDto[];
  templates: RemoteTerminalProductTemplateFilterOptionDto[];
}

export type RemoteTerminalBillingUnit = "day" | "week" | "month";

export interface RemoteTerminalProductTemplateDto {
  id: string;
  name: string;
  description?: string;
  publishStatus: RemoteTerminalProductTemplatePublishStatus;
  publishedAt?: Date;
  billingUnit: RemoteTerminalBillingUnit;
  minimumPurchaseUnits: number;
  maximumPurchaseUnits?: number;
  devicePrice?: number;
  terminalPrice?: number;
  deviceDailyPrice?: number;
  terminalDailyPrice?: number;
  currency: string;
  purchaseLimitPerUser?: number;
  purchaseLimitWindowDays?: number;
  minimumDeviceCount?: number;
  minimumTerminalCount?: number;
  maxDeviceCount?: number;
  maxTerminalCount?: number;
  status: number;
  createTime: Date;
  updateTime: Date;
}

export interface CreateRemoteTerminalProductTemplateRequest {
  name: string;
  description?: string;
  billingUnit?: RemoteTerminalBillingUnit;
  minimumPurchaseUnits?: number;
  maximumPurchaseUnits?: number | null;
  devicePrice?: number | null;
  terminalPrice?: number | null;
  currency?: string;
  purchaseLimitPerUser?: number | null;
  purchaseLimitWindowDays?: number | null;
  minimumDeviceCount?: number | null;
  minimumTerminalCount?: number | null;
  maxDeviceCount?: number | null;
  maxTerminalCount?: number | null;
}

export interface UpdateRemoteTerminalProductTemplateRequest {
  name?: string;
  description?: string | null;
  billingUnit?: RemoteTerminalBillingUnit;
  minimumPurchaseUnits?: number;
  maximumPurchaseUnits?: number | null;
  devicePrice?: number | null;
  terminalPrice?: number | null;
  currency?: string;
  purchaseLimitPerUser?: number | null;
  purchaseLimitWindowDays?: number | null;
  minimumDeviceCount?: number | null;
  minimumTerminalCount?: number | null;
  maxDeviceCount?: number | null;
  maxTerminalCount?: number | null;
  status?: number;
}

export interface ClaimRemoteTerminalProductTemplateRequest {
  templateId: string;
  name?: string;
  purchaseUnits: number;
  deviceCount: number;
  terminalCount: number;
  targetEntitlementId?: string;
}

export interface RemoteTerminalProductTemplateListResponse {
  total: number;
  records: RemoteTerminalProductTemplateDto[];
  page: number;
  pageSize: number;
}

export interface RemoteTerminalRegistrationTokenDto {
  id: string;
  entitlementId: string;
  token?: string;
  maskedToken: string;
  label?: string;
  expiresAt?: Date;
  lastUsedAt?: Date;
  status: number;
  createTime: Date;
  updateTime: Date;
}

export interface RemoteTerminalUserEntitlementDto {
  id: string;
  userId: string;
  username?: string;
  templateId?: string;
  templateName?: string;
  name: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  billingUnit: RemoteTerminalBillingUnit;
  purchaseUnits: number;
  durationDays: number;
  deviceLimit: number;
  terminalLimit: number;
  purchasedDeviceCount: number;
  purchasedTerminalCount: number;
  devicePrice?: number;
  terminalPrice?: number;
  deviceDailyPrice?: number;
  terminalDailyPrice?: number;
  purchaseAmount?: number;
  currency: string;
  assignedBy?: string;
  assignedByUsername?: string;
  note?: string;
  status: number;
  createTime: Date;
  updateTime: Date;
  isActive: boolean;
  isExpired: boolean;
  registeredDeviceCount: number;
  registrationToken?: RemoteTerminalRegistrationTokenDto;
  maxDeviceCount?: number;
  maxTerminalCount?: number;
}

export interface AssignRemoteTerminalEntitlementRequest {
  userId: string;
  templateId?: string;
  name?: string;
  description?: string;
  startAt: string;
  endAt: string;
  deviceLimit?: number;
  terminalLimit?: number;
  note?: string;
}

export interface UpdateRemoteTerminalEntitlementRequest {
  name?: string;
  description?: string | null;
  startAt?: string;
  endAt?: string;
  deviceLimit?: number;
  terminalLimit?: number;
  maxDeviceCount?: number | null;
  maxTerminalCount?: number | null;
  note?: string | null;
  status?: number;
}

export interface RotateRemoteTerminalRegistrationTokenRequest {
  label?: string | null;
  expiresAt?: string | null;
}

export interface RemoteTerminalUserEntitlementListResponse {
  total: number;
  records: RemoteTerminalUserEntitlementDto[];
  page: number;
  pageSize: number;
}

export interface RemoteTerminalBoundDeviceDto {
  id: string;
  entitlementId: string;
  entitlementName?: string;
  userId: string;
  username?: string;
  registrationTokenId?: string;
  deviceId: string;
  fingerprint: string;
  hostname: string;
  platform: RemoteTerminalPlatform;
  arch: string;
  availableShells: RemoteTerminalShellType[];
  online: boolean;
  registeredAt: Date;
  lastSeenAt: Date;
  lastOnlineAt?: Date;
  status: number;
  createTime: Date;
  updateTime: Date;
}

export interface RemoteTerminalBoundDeviceListResponse {
  total: number;
  records: RemoteTerminalBoundDeviceDto[];
  page: number;
  pageSize: number;
}

export interface RemoteTerminalUnbindReminderDto {
  maxCount: number;
  windowHours: number;
  rebindCooldownMinutes: number;
  revokedCount: number;
  remainingCount: number;
  windowStartAt: Date;
}
