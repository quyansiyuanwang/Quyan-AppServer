import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'

const { requestMock } = vi.hoisted(() => ({
  requestMock: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
}))

import { twoFactorService } from '@/service/twoFactorService'

const expectOperation = (name: string) => expect.objectContaining({ name })

describe('twoFactorService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns status when backend responds with OK', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        enabled: true,
        passkeyRequired: false,
        hasRecoveryCodes: true,
        trustedDeviceCapabilities: {
          pageSizeMin: 1,
          pageSizeMax: 50,
          pageSizeDefault: 10,
        },
      },
    })

    const result = await twoFactorService.getStatus()

    expect(result).toEqual({
      enabled: true,
      passkeyRequired: false,
      hasRecoveryCodes: true,
      trustedDeviceCapabilities: {
        pageSizeMin: 1,
        pageSizeMax: 50,
        pageSizeDefault: 10,
      },
    })
  })

  it('falls back to safe trusted-device capabilities when backend omits them', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        enabled: true,
        passkeyRequired: false,
        hasRecoveryCodes: false,
      },
    })

    const result = await twoFactorService.getStatus()

    expect(result.trustedDeviceCapabilities).toEqual({
      pageSizeMin: 1,
      pageSizeMax: 50,
      pageSizeDefault: 10,
    })
  })

  it('throws enriched service error when response is not OK', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.VALIDATION_FAILED,
      message: 'bad request',
      data: {
        field: 'code',
      },
    })

    await expect(twoFactorService.getStatus()).rejects.toMatchObject({
      message: 'bad request',
      code: CustomCode.VALIDATION_FAILED,
      data: {
        field: 'code',
      },
    })
  })

  it('submits two-factor login challenge payload', async () => {
    requestMock.post.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        access_token: 'access',
        refresh_token: 'refresh',
        user: { id: 'u1' },
      },
    })

    const result = await twoFactorService.verifyLoginChallenge({
      challengeToken: 'challenge-token',
      emailCode: '123456',
    })

    expect(requestMock.post).toHaveBeenCalledWith(
      expectOperation('AuthControllerVerifyTwoFactorLogin'),
      {
        body: {
          challengeToken: 'challenge-token',
          code: undefined,
          recoveryCode: undefined,
          emailCode: '123456',
        },
      },
      undefined,
    )
    expect(result.access_token).toBe('access')
    expect(result.refresh_token).toBe('refresh')
  })

  it('loads trusted devices list', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        devices: [
          {
            deviceId: 'a'.repeat(64),
            ipAddress: '127.0.0.1',
            userAgent: 'Mozilla/5.0',
            fingerprint: 'fp-1',
            trustedAt: '2026-04-13T08:00:00.000Z',
            lastUsedAt: '2026-04-13T09:00:00.000Z',
            expiresInSeconds: 300,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
        hasMore: false,
      },
    })

    const result = await twoFactorService.listTrustedDevices()

    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('UserControllerGetTwoFactorTrustedDevices'),
      {
        params: { page: 1, pageSize: 10 },
      },
      {
        signal: undefined,
      },
    )
    expect(result.devices).toHaveLength(1)
    expect(result.devices[0]?.ipAddress).toBe('127.0.0.1')
    expect(result.devices[0]?.lastUsedAt).toBe('2026-04-13T09:00:00.000Z')
    expect(result.total).toBe(1)
  })

  it('returns empty trusted devices list when payload has no devices', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {},
    })

    const result = await twoFactorService.listTrustedDevices()

    expect(result).toEqual({
      devices: [],
      total: 0,
      page: 1,
      pageSize: 10,
      hasMore: false,
    })
  })

  it('filters malformed trusted device entries from API payload', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        devices: [
          {
            deviceId: 'a'.repeat(64),
            ipAddress: '127.0.0.1',
            userAgent: 'Mozilla/5.0',
            fingerprint: null,
            trustedAt: null,
            lastUsedAt: null,
            expiresInSeconds: 120,
          },
          {
            deviceId: 'invalid-device-id',
            ipAddress: 123,
          },
        ],
        total: 2,
        page: 1,
        pageSize: 10,
        hasMore: false,
      },
    })

    const result = await twoFactorService.listTrustedDevices()

    expect(result.devices).toHaveLength(1)
    expect(result.devices[0]?.deviceId).toBe('a'.repeat(64))
  })

  it('clamps trusted-device list pagination options to service bounds', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        devices: [],
        total: 0,
        page: 2,
        pageSize: 50,
        hasMore: false,
      },
    })

    await twoFactorService.listTrustedDevices({ page: 2.9, pageSize: 500 })

    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('UserControllerGetTwoFactorTrustedDevices'),
      {
        params: { page: 2, pageSize: 50 },
      },
      {
        signal: undefined,
      },
    )
  })

  it('normalizes invalid pagination inputs to safe defaults', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        devices: [],
        total: 0,
        page: 1,
        pageSize: 1,
        hasMore: false,
      },
    })

    await twoFactorService.listTrustedDevices({ page: Number.NaN, pageSize: -10 })

    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('UserControllerGetTwoFactorTrustedDevices'),
      {
        params: { page: 1, pageSize: 1 },
      },
      {
        signal: undefined,
      },
    )
  })

  it('uses status capability pageSizeMax when clamping trusted-device requests', async () => {
    requestMock.get
      .mockResolvedValueOnce({
        code: CustomCode.OK,
        data: {
          enabled: true,
          passkeyRequired: false,
          hasRecoveryCodes: false,
          trustedDeviceCapabilities: {
            pageSizeMin: 1,
            pageSizeMax: 20,
            pageSizeDefault: 10,
          },
        },
      })
      .mockResolvedValueOnce({
        code: CustomCode.OK,
        data: {
          devices: [],
          total: 0,
          page: 1,
          pageSize: 20,
          hasMore: false,
        },
      })

    await twoFactorService.getStatus()
    await twoFactorService.listTrustedDevices({ pageSize: 999 })

    expect(requestMock.get).toHaveBeenNthCalledWith(
      2,
      expectOperation('UserControllerGetTwoFactorTrustedDevices'),
      {
        params: { page: 1, pageSize: 20 },
      },
      {
        signal: undefined,
      },
    )
  })

  it('passes abort signal to trusted-device list request', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        devices: [],
        total: 0,
        page: 1,
        pageSize: 10,
        hasMore: false,
      },
    })

    const controller = new AbortController()
    await twoFactorService.listTrustedDevices({ signal: controller.signal })

    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('UserControllerGetTwoFactorTrustedDevices'),
      {
        params: { page: 1, pageSize: 10 },
      },
      {
        signal: controller.signal,
      },
    )
  })

  it('throws enriched service error when trusted devices API fails', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.UNAUTHORIZED,
      message: 'unauthorized',
      data: null,
    })

    await expect(twoFactorService.listTrustedDevices()).rejects.toMatchObject({
      message: 'unauthorized',
      code: CustomCode.UNAUTHORIZED,
    })
  })

  it('propagates network failure when trusted devices request rejects', async () => {
    const networkError = new Error('Network Error')
    requestMock.get.mockRejectedValueOnce(networkError)

    await expect(twoFactorService.listTrustedDevices()).rejects.toBe(networkError)
  })

  it('deletes a trusted device by id', async () => {
    requestMock.delete.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        removed: true,
      },
    })

    const removed = await twoFactorService.removeTrustedDevice('b'.repeat(64))

    expect(requestMock.delete).toHaveBeenCalledWith(
      expectOperation('UserControllerDeleteTwoFactorTrustedDevice'),
      {
        path: { deviceId: 'b'.repeat(64) },
      },
      {
        signal: undefined,
      },
    )
    expect(removed).toBe(true)
  })

  it('normalizes uppercase trusted device id before delete request', async () => {
    requestMock.delete.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        removed: true,
      },
    })

    const uppercaseId = 'A'.repeat(64)
    await twoFactorService.removeTrustedDevice(uppercaseId)

    expect(requestMock.delete).toHaveBeenCalledWith(
      expectOperation('UserControllerDeleteTwoFactorTrustedDevice'),
      {
        path: { deviceId: uppercaseId.toLowerCase() },
      },
      {
        signal: undefined,
      },
    )
  })

  it('passes abort signal to trusted-device delete request', async () => {
    requestMock.delete.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        removed: true,
      },
    })

    const controller = new AbortController()
    await twoFactorService.removeTrustedDevice('b'.repeat(64), controller.signal)

    expect(requestMock.delete).toHaveBeenCalledWith(
      expectOperation('UserControllerDeleteTwoFactorTrustedDevice'),
      {
        path: { deviceId: 'b'.repeat(64) },
      },
      {
        signal: controller.signal,
      },
    )
  })

  it('rejects invalid trusted device id before request', async () => {
    await expect(twoFactorService.removeTrustedDevice('')).rejects.toMatchObject({
      code: CustomCode.VALIDATION_FAILED,
      data: {
        field: 'deviceId',
      },
    })
    expect(requestMock.delete).not.toHaveBeenCalled()
  })

  it('throws enriched service error when trusted device delete fails', async () => {
    requestMock.delete.mockResolvedValueOnce({
      code: CustomCode.VALIDATION_FAILED,
      message: 'bad device id',
      data: {
        field: 'deviceId',
      },
    })

    await expect(twoFactorService.removeTrustedDevice('b'.repeat(64))).rejects.toMatchObject({
      message: 'bad device id',
      code: CustomCode.VALIDATION_FAILED,
      data: {
        field: 'deviceId',
      },
    })
  })

  it('returns false when trusted device delete response misses removed flag', async () => {
    requestMock.delete.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {},
    })

    const removed = await twoFactorService.removeTrustedDevice('b'.repeat(64))
    expect(removed).toBe(false)
  })
})
