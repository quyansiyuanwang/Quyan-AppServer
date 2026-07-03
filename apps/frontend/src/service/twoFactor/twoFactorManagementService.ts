import { CustomCode } from '@/constant/custom-code'
import { useRequestStore } from '@/stores/request'
import { toServiceError } from '@/utils/error-utils'
import { trustedDeviceService } from './trustedDeviceService'
import { cacheObject } from '@/utils/common'
import type {
  ApiObject,
  ApiValue,
  ConfirmTwoFactorSetupResponse,
  DisableTwoFactorOptions,
  TrustedDevicePageSizeLimits,
  TwoFactorSetupResponse,
  TwoFactorStatus,
} from './types'
import { FALLBACK_TRUSTED_DEVICE_PAGE_SIZE_LIMITS } from './types'
import { createUserControllerApi } from '@/client/services/user-controller.gen'

const userApi = cacheObject(() => createUserControllerApi(useRequestStore().getAxios()))

const isApiObject = (value: ApiValue | undefined): value is ApiObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const toPositiveInt = (value: ApiValue | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

const parseTrustedDevicePageSizeLimits = (
  value: ApiValue | undefined,
): TrustedDevicePageSizeLimits => {
  if (!isApiObject(value)) return { ...FALLBACK_TRUSTED_DEVICE_PAGE_SIZE_LIMITS }

  const pageSizeMin = toPositiveInt(
    value.pageSizeMin,
    FALLBACK_TRUSTED_DEVICE_PAGE_SIZE_LIMITS.pageSizeMin,
  )
  const pageSizeMax = Math.max(
    pageSizeMin,
    toPositiveInt(value.pageSizeMax, FALLBACK_TRUSTED_DEVICE_PAGE_SIZE_LIMITS.pageSizeMax),
  )
  const pageSizeDefault = Math.min(
    pageSizeMax,
    Math.max(
      pageSizeMin,
      toPositiveInt(
        value.pageSizeDefault,
        FALLBACK_TRUSTED_DEVICE_PAGE_SIZE_LIMITS.pageSizeDefault,
      ),
    ),
  )

  return {
    pageSizeMin,
    pageSizeMax,
    pageSizeDefault,
  }
}

const parseTwoFactorStatus = (data: ApiValue | undefined): TwoFactorStatus | null => {
  if (!isApiObject(data)) return null

  return {
    enabled: data.enabled === true,
    passkeyRequired: data.passkeyRequired === true,
    hasRecoveryCodes: data.hasRecoveryCodes === true,
    trustedDeviceCapabilities: parseTrustedDevicePageSizeLimits(data.trustedDeviceCapabilities),
  }
}

export class TwoFactorManagementService {
  private static instance: TwoFactorManagementService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new TwoFactorManagementService()
    }
    return this.instance
  }

  async getStatus(): Promise<TwoFactorStatus> {
    const result = await userApi.getTwoFactorStatus({})

    if (result && result.code === CustomCode.OK && result.data) {
      const parsedStatus = parseTwoFactorStatus(result.data)
      if (parsedStatus) {
        trustedDeviceService.setPageSizeLimits(parsedStatus.trustedDeviceCapabilities)
        return parsedStatus
      }

      return {
        enabled: false,
        passkeyRequired: false,
        hasRecoveryCodes: false,
        trustedDeviceCapabilities: {
          ...trustedDeviceService.getPageSizeLimits(),
        },
      }
    }

    throw toServiceError(result)
  }

  async beginSetup(): Promise<TwoFactorSetupResponse> {
    const result = await userApi.beginTwoFactorSetup({})

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as TwoFactorSetupResponse
    }

    throw toServiceError(result)
  }

  async confirmSetup(setupToken: string, code: string): Promise<ConfirmTwoFactorSetupResponse> {
    const result = await userApi.confirmTwoFactorSetup({
      body: {
        setupToken,
        code,
      },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as ConfirmTwoFactorSetupResponse
    }

    throw toServiceError(result)
  }

  async disable(options: DisableTwoFactorOptions) {
    const result = await userApi.disableTwoFactor({
      body: {
        code: options.code,
        recoveryCode: options.recoveryCode,
      },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as { enabled: boolean; passkeyRequired: boolean }
    }

    throw toServiceError(result)
  }

  async updatePasskeyPolicy(passkeyRequired: boolean) {
    const result = await userApi.updateTwoFactorPasskeyPolicy({
      body: {
        passkeyRequired,
      },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data as { enabled: boolean; passkeyRequired: boolean }
    }

    throw toServiceError(result)
  }

  async clearTrustedWindow() {
    const result = await userApi.clearTwoFactorTrustedWindow({})

    if (result && result.code === CustomCode.OK) {
      return true
    }

    throw toServiceError(result)
  }
}

export const twoFactorManagementService = TwoFactorManagementService.getInstance()
