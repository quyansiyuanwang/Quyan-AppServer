export interface TwoFactorTrustedDeviceCapabilities {
  pageSizeMin: number;
  pageSizeMax: number;
  pageSizeDefault: number;
}

export interface TwoFactorStatusResponse {
  enabled: boolean;
  passkeyRequired: boolean;
  hasRecoveryCodes: boolean;
  trustedDeviceCapabilities: TwoFactorTrustedDeviceCapabilities;
}

export interface TwoFactorSetupResponse {
  setupToken: string;
  qrCodeDataUrl: string;
  otpauthUrl: string;
  secret: string;
  expiresIn: number;
}

export interface ConfirmTwoFactorSetupDto {
  setupToken: string;
  code: string;
}

export interface ConfirmTwoFactorSetupResponse {
  enabled: boolean;
  passkeyRequired: boolean;
  recoveryCodes: string[];
}

export interface DisableTwoFactorDto {
  code?: string;
  recoveryCode?: string;
}

export interface DisableTwoFactorResponse {
  enabled: boolean;
  passkeyRequired: boolean;
}

export interface RegenerateTwoFactorRecoveryCodesDto {
  code?: string;
  recoveryCode?: string;
}

export interface RegenerateTwoFactorRecoveryCodesResponse {
  recoveryCodes: string[];
}

export interface UpdateTwoFactorPasskeyPolicyDto {
  passkeyRequired: boolean;
}

export interface UpdateTwoFactorPasskeyPolicyResponse {
  enabled: boolean;
  passkeyRequired: boolean;
}

export interface TwoFactorTrustClearResponse {
  message: string;
}

export interface TwoFactorTrustedDevice {
  deviceId: string;
  ipAddress: string | null;
  userAgent: string | null;
  fingerprint: string | null;
  trustedAt: string | null;
  lastUsedAt: string | null;
  expiresInSeconds: number | null;
}

export interface TwoFactorTrustedDevicesQueryDto {
  page?: number;
  pageSize?: number;
}

export interface TwoFactorTrustedDevicesResponse {
  devices: TwoFactorTrustedDevice[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface DeleteTwoFactorTrustedDeviceResponse {
  removed: boolean;
  message: string;
}
