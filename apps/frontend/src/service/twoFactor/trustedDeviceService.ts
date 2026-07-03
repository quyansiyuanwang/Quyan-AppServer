import { CustomCode } from '@/constant/custom-code'
import { useRequestStore } from '@/stores/request'
import { toServiceError } from '@/utils/error-utils'
import type { TwoFactorTrustedDevice } from '@/types/trusted-device'
import type {
  ApiObject,
  ApiValue,
  ListTrustedDevicesOptions,
  TrustedDevicePageSizeLimits,
  TwoFactorTrustedDeviceApiPayload,
  TwoFactorTrustedDevicesPage,
} from './types'
import {
  DEFAULT_TRUSTED_DEVICE_PAGE,
  FALLBACK_TRUSTED_DEVICE_PAGE_SIZE_LIMITS,
  TRUSTED_DEVICE_ID_PATTERN,
} from './types'
import { cacheObject } from '@/utils/common'
import { createUserControllerApi } from '@/client/services/user-controller.gen'

const userApi = cacheObject(() => createUserControllerApi(useRequestStore().getAxios()))

const isApiObject = (value: ApiValue | undefined): value is ApiObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isNullableString = (value: ApiValue | undefined): value is string | null =>
  value === null || typeof value === 'string'

const isNullableNumber = (value: ApiValue | undefined): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value))

const toTrustedDevice = (payload: TwoFactorTrustedDeviceApiPayload): TwoFactorTrustedDevice => {
  return {
    deviceId: payload.deviceId.toLowerCase(),
    ipAddress: payload.ipAddress ?? null,
    userAgent: payload.userAgent ?? null,
    fingerprint: payload.fingerprint ?? null,
    trustedAt: payload.trustedAt ?? null,
    lastUsedAt: payload.lastUsedAt ?? null,
    expiresInSeconds: payload.expiresInSeconds ?? null,
  }
}

const parseTrustedDevice = (value: ApiValue | undefined): TwoFactorTrustedDevice | null => {
  if (!isApiObject(value)) return null

  const deviceId = value.deviceId
  const ipAddress = value.ipAddress
  const userAgent = value.userAgent
  const fingerprint = value.fingerprint
  const trustedAt = value.trustedAt
  const lastUsedAt = value.lastUsedAt
  const expiresInSeconds = value.expiresInSeconds

  if (typeof deviceId !== 'string' || !TRUSTED_DEVICE_ID_PATTERN.test(deviceId)) return null
  if (ipAddress !== undefined && !isNullableString(ipAddress)) return null
  if (userAgent !== undefined && !isNullableString(userAgent)) return null
  if (fingerprint !== undefined && !isNullableString(fingerprint)) return null
  if (trustedAt !== undefined && !isNullableString(trustedAt)) return null
  if (lastUsedAt !== undefined && !isNullableString(lastUsedAt)) return null
  if (expiresInSeconds !== undefined && !isNullableNumber(expiresInSeconds)) return null

  return toTrustedDevice({
    deviceId,
    ipAddress,
    userAgent,
    fingerprint,
    trustedAt,
    lastUsedAt,
    expiresInSeconds,
  })
}

const parseTrustedDevicePage = (
  data: ApiValue | undefined,
  fallbackPage: number,
  fallbackPageSize: number,
): TwoFactorTrustedDevicesPage => {
  if (!isApiObject(data)) {
    return {
      devices: [],
      total: 0,
      page: fallbackPage,
      pageSize: fallbackPageSize,
      hasMore: false,
    }
  }

  const devices = Array.isArray(data.devices)
    ? data.devices
        .map((item) => parseTrustedDevice(item))
        .filter((item): item is TwoFactorTrustedDevice => item !== null)
    : []

  const totalValue = data.total
  const pageValue = data.page
  const pageSizeValue = data.pageSize
  const hasMoreValue = data.hasMore

  const total =
    typeof totalValue === 'number' && Number.isFinite(totalValue)
      ? Math.max(0, Math.floor(totalValue))
      : devices.length
  const page =
    typeof pageValue === 'number' && Number.isFinite(pageValue)
      ? Math.max(1, Math.floor(pageValue))
      : fallbackPage
  const pageSize =
    typeof pageSizeValue === 'number' && Number.isFinite(pageSizeValue)
      ? Math.max(1, Math.floor(pageSizeValue))
      : fallbackPageSize
  const hasMore = typeof hasMoreValue === 'boolean' ? hasMoreValue : page * pageSize < total

  return {
    devices,
    total,
    page,
    pageSize,
    hasMore,
  }
}

export class TrustedDeviceService {
  private static instance: TrustedDeviceService | null = null
  private pageSizeLimits: TrustedDevicePageSizeLimits = {
    ...FALLBACK_TRUSTED_DEVICE_PAGE_SIZE_LIMITS,
  }

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new TrustedDeviceService()
    }
    return this.instance
  }

  setPageSizeLimits(limits: TrustedDevicePageSizeLimits) {
    this.pageSizeLimits = { ...limits }
  }

  getPageSizeLimits(): TrustedDevicePageSizeLimits {
    return { ...this.pageSizeLimits }
  }

  private createInvalidTrustedDeviceIdError() {
    return toServiceError({
      code: CustomCode.VALIDATION_FAILED,
      message: 'Invalid trusted device ID',
      data: {
        field: 'deviceId',
      },
    })
  }

  async listTrustedDevices(
    options: ListTrustedDevicesOptions = {},
  ): Promise<TwoFactorTrustedDevicesPage> {
    const page = Math.max(
      DEFAULT_TRUSTED_DEVICE_PAGE,
      Math.floor(options.page || DEFAULT_TRUSTED_DEVICE_PAGE),
    )
    const pageSize = Math.max(
      this.pageSizeLimits.pageSizeMin,
      Math.min(
        this.pageSizeLimits.pageSizeMax,
        Math.floor(options.pageSize || this.pageSizeLimits.pageSizeDefault),
      ),
    )
    const result = await userApi.getTwoFactorTrustedDevices(
      {
        params: { page, pageSize },
      },
      {
        signal: options.signal,
      },
    )

    if (result && result.code === CustomCode.OK) {
      return parseTrustedDevicePage(result.data, page, pageSize)
    }

    throw toServiceError(result)
  }

  async removeTrustedDevice(deviceId: string, signal?: AbortSignal): Promise<boolean> {
    const normalizedDeviceId = deviceId.trim()
    if (!TRUSTED_DEVICE_ID_PATTERN.test(normalizedDeviceId))
      throw this.createInvalidTrustedDeviceIdError()

    const safeDeviceId = normalizedDeviceId.toLowerCase()
    const result = await userApi.deleteTwoFactorTrustedDevice(
      { path: { deviceId: safeDeviceId } },
      { signal },
    )

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data.removed === true
    }

    throw toServiceError(result)
  }
}

export const trustedDeviceService = TrustedDeviceService.getInstance()
