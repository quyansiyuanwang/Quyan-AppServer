// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosHeaders, HttpStatusCode } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import StorageKey from '@/constant/storagekey'
import { clearAccessToken, clearLegacyAuthStorage, MyAxios, setAccessToken } from '@/stores/request'

const refreshMock = vi.fn()

vi.mock('@/service/sessionCoordinator', () => ({
  SessionExpiredError: class SessionExpiredError extends Error {},
  sessionCoordinator: { refresh: refreshMock },
}))

describe('MyAxios session transport', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    clearAccessToken()
    refreshMock.mockReset()
    ;(MyAxios as any).refreshTokenPromise = null
  })

  afterEach(() => {
    clearAccessToken()
    localStorage.clear()
    ;(MyAxios as any).refreshTokenPromise = null
  })

  it('keeps the access token in memory and removes legacy persistent credentials', () => {
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, 'legacy-access')
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, 'legacy-refresh')
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION, '123')
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN_EXPIRATION, '456')

    setAccessToken('memory-access')
    clearLegacyAuthStorage()

    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBeNull()
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)).toBeNull()
    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION)).toBeNull()
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN_EXPIRATION)).toBeNull()
  })

  it('shares one coordinator refresh operation across concurrent requests', async () => {
    let resolveRefresh: ((token: string) => void) | undefined
    refreshMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRefresh = resolve
      }),
    )

    const first = (MyAxios as any).getRefreshPromise() as Promise<string>
    const second = (MyAxios as any).getRefreshPromise() as Promise<string>
    expect(first).toBe(second)
    await vi.dynamicImportSettled()
    expect(refreshMock).toHaveBeenCalledTimes(1)

    resolveRefresh?.('cookie-access-token')
    await expect(first).resolves.toBe('cookie-access-token')
    expect((MyAxios as any).refreshTokenPromise).toBeNull()
  })

  it('retries one unauthorized API request after the coordinator refreshes the cookie session', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected
    axiosInstance.request = vi.fn().mockResolvedValue({ code: 0, retried: true })
    refreshMock.mockResolvedValue('fresh-access-token')

    const result = await errorHandler({
      response: { status: HttpStatusCode.Unauthorized, data: {} },
      config: { url: '/v1/protected', headers: new AxiosHeaders() },
    })

    expect(result).toEqual({ code: 0, retried: true })
    expect(axiosInstance.request).toHaveBeenCalledWith(
      expect.objectContaining({
        _retry: true,
        headers: expect.anything(),
      }),
    )
  })
})
