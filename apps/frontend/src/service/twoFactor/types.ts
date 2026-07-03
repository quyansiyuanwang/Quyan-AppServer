import type { PolicyConsentRequiredData } from '@/client/types.gen'
import type { TwoFactorTrustedDevice } from '@/types/trusted-device'

export interface TrustedDevicePageSizeLimits {
  pageSizeMin: number
  pageSizeMax: number
  pageSizeDefault: number
}

export interface TwoFactorStatus {
  enabled: boolean
  passkeyRequired: boolean
  hasRecoveryCodes: boolean
  trustedDeviceCapabilities: TrustedDevicePageSizeLimits
}

export interface TwoFactorSetupResponse {
  setupToken: string
  qrCodeDataUrl: string
  otpauthUrl: string
  secret: string
  expiresIn: number
}

export interface ConfirmTwoFactorSetupResponse {
  enabled: boolean
  passkeyRequired: boolean
  recoveryCodes: string[]
}

export interface VerifyTwoFactorLoginResponse {
  access_token: string
  refresh_token: string
  user: Record<string, string | number | boolean | null | undefined>
  oneTimeToken?: string
}

export type VerifyTwoFactorLoginResult = VerifyTwoFactorLoginResponse | PolicyConsentRequiredData

export interface SendTwoFactorEmailCodeResponse {
  message: string
  maskedEmail?: string
}

export interface DisableTwoFactorOptions {
  code?: string
  recoveryCode?: string
}

export interface ListTrustedDevicesOptions {
  page?: number
  pageSize?: number
  signal?: AbortSignal
}

export interface TwoFactorTrustedDevicesPage {
  devices: TwoFactorTrustedDevice[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export type ApiScalar = string | number | boolean | null
export type ApiValue = ApiScalar | ApiObject | ApiValue[]
export type ApiObject = { [key: string]: ApiValue }

export interface TwoFactorTrustedDeviceApiPayload {
  deviceId: string
  ipAddress?: string | null
  userAgent?: string | null
  fingerprint?: string | null
  trustedAt?: string | null
  lastUsedAt?: string | null
  expiresInSeconds?: number | null
}

export const TRUSTED_DEVICE_ID_PATTERN = /^[a-fA-F0-9]{64}$/
export const DEFAULT_TRUSTED_DEVICE_PAGE = 1
export const FALLBACK_TRUSTED_DEVICE_PAGE_SIZE_LIMITS: TrustedDevicePageSizeLimits = {
  pageSizeMin: 1,
  pageSizeMax: 50,
  pageSizeDefault: 10,
}
