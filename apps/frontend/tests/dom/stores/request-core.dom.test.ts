// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosHeaders, CanceledError, HttpStatusCode } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import StorageKey from '@/constant/storagekey'
import { clearAccessToken, clearLegacyAuthStorage, MyAxios, setAccessToken } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { configureRequestErrorNotifier } from '@/utils/requestErrorNotice'

const refreshMock = vi.fn()
const waitForPendingRestoreMock = vi.fn()
const routerPush = vi.fn()
const notifyMock = vi.fn()

vi.mock('@/router', () => ({ default: { push: routerPush } }))

vi.mock('@/service/sessionCoordinator', () => ({
  SessionExpiredError: class SessionExpiredError extends Error {},
  sessionCoordinator: {
    refresh: refreshMock,
    waitForPendingRestore: waitForPendingRestoreMock,
  },
}))

describe('MyAxios session transport', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    clearAccessToken()
    MyAxios.clearPendingTwoFactorRequests()
    refreshMock.mockReset()
    waitForPendingRestoreMock.mockReset()
    waitForPendingRestoreMock.mockResolvedValue(null)
    routerPush.mockReset()
    notifyMock.mockReset()
    configureRequestErrorNotifier((title, message) => notifyMock(title, message))
    ;(MyAxios as any).refreshTokenPromise = null
  })

  afterEach(() => {
    MyAxios.clearPendingTwoFactorRequests()
    clearAccessToken()
    localStorage.clear()
    sessionStorage.clear()
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

  it('waits for an in-flight protected-navigation restore before sending without a memory token', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const requestHandler = axiosInstance.interceptors.request.handlers[0]?.fulfilled
    const config = { url: '/v1/protected', method: 'get', headers: new AxiosHeaders() }
    let resolveRestore: ((token: string | null) => void) | undefined
    waitForPendingRestoreMock.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveRestore = resolve
      }),
    )

    const request = requestHandler(config)
    await vi.dynamicImportSettled()
    expect(waitForPendingRestoreMock).toHaveBeenCalledOnce()
    expect(config.headers.get('Authorization')).toBeUndefined()

    setAccessToken('cookie-access-token')
    resolveRestore?.('cookie-access-token')
    await request

    expect(config.headers.get('Authorization')).toBe('Bearer cookie-access-token')
  })

  it('retries one unauthorized API request after the coordinator refreshes the cookie session', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected
    axiosInstance.request = vi.fn().mockResolvedValue({ code: 0, retried: true })
    setAccessToken('stale-access-token')
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

  it('does not refresh again after the access token has already been cleared', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected

    await expect(
      errorHandler({
        response: { status: HttpStatusCode.Unauthorized, data: {} },
        config: { url: '/v1/protected', headers: new AxiosHeaders() },
      }),
    ).rejects.toMatchObject({ response: { status: 401 } })
    expect(refreshMock).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('does not show an error notice for canceled requests', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected
    const canceled = new CanceledError('canceled')

    await expect(errorHandler(canceled)).rejects.toThrow('canceled')
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('shows one error notice and rejects non-zero response codes', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const fulfilledHandler = axiosInstance.interceptors.response.handlers[0]?.fulfilled

    await expect(
      fulfilledHandler({
        status: 200,
        data: { code: 1003, message: 'resource missing' },
        config: { url: '/v1/items', headers: new AxiosHeaders() },
      }),
    ).rejects.toMatchObject({ code: 1003, message: 'resource missing' })

    expect(notifyMock).toHaveBeenCalledWith(expect.any(String), 'resource missing')
  })

  it('rejects transport failures while preserving HTTP status and response payload', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected
    const responseData = { code: 1005, message: 'upstream failed' }

    await expect(
      errorHandler({
        response: { status: HttpStatusCode.InternalServerError, data: responseData },
        config: { url: '/v1/items', method: 'get', headers: new AxiosHeaders() },
      }),
    ).rejects.toMatchObject({ response: { data: responseData } })

    expect(notifyMock).toHaveBeenCalledWith(expect.any(String), 'upstream failed')
  })

  it('redirects two-factor-required responses before business success handlers run', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const fulfilledHandler = axiosInstance.interceptors.response.handlers[0]?.fulfilled
    const responseData = {
      code: 1018,
      message: '当前操作需要二次验证',
      data: {
        challengeToken: 'challenge-token',
        expiresIn: 300,
        method: 'code',
        purpose: 'stepup',
      },
    }

    let completeNavigation: (() => void) | undefined
    routerPush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeNavigation = resolve
        }),
    )

    const handledResponse = fulfilledHandler({
      data: responseData,
      config: { url: '/v1/redemption-codes', method: 'post', headers: new AxiosHeaders() },
    })

    expect(sessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)).toContain(
      'challenge-token',
    )
    await vi.waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'authVerification',
          query: { purpose: 'stepup', method: 'code' },
        }),
      ),
    )

    // The original promise stays pending and is settled by the retry result,
    // so callers never render the 2FA challenge as an ordinary error.
    let requestSettled = false
    void handledResponse.finally(() => {
      requestSettled = true
    })
    completeNavigation?.()
    await Promise.resolve()
    expect(requestSettled).toBe(false)

    axiosInstance.request = vi.fn().mockResolvedValue({ code: 0, retried: true })
    await client.retryPendingTwoFactorRequests()
    await expect(handledResponse).resolves.toEqual({ code: 0, retried: true })
  })

  it('redirects nested Axios error responses and preserves the challenge details', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected
    const errorResponse = {
      response: {
        data: {
          data: {
            code: '1018',
            data: { challengeToken: 'error-challenge', purpose: 'login', method: 'passkey' },
          },
        },
      },
      config: { url: '/v1/auth/login', method: 'post', headers: new AxiosHeaders() },
    }

    let completeNavigation: (() => void) | undefined
    routerPush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeNavigation = resolve
        }),
    )

    const handledError = errorHandler(errorResponse)
    expect(sessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)).toContain(
      'error-challenge',
    )
    await vi.waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'authVerification',
          query: { purpose: 'login', method: 'passkey' },
        }),
      ),
    )

    // Login challenges are control flow, not a queued retry: the verification
    // endpoint establishes the session and the login page consumes this error.
    completeNavigation?.()
    await expect(handledError).rejects.toMatchObject({
      name: 'TwoFactorRedirectError',
      code: 1018,
    })
  })

  it('preserves the central-login flow id when navigating to login verification', async () => {
    window.history.replaceState({}, '', '/login?flowId=flow-123')
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected
    const errorResponse = {
      response: {
        data: {
          code: 1018,
          message: '当前操作需要二次验证',
          data: { challengeToken: 'flow-challenge', purpose: 'login', method: 'code' },
        },
      },
      config: { url: '/v1/auth/login', method: 'post', headers: new AxiosHeaders() },
    }

    routerPush.mockResolvedValueOnce(undefined)
    await expect(errorHandler(errorResponse)).rejects.toMatchObject({
      name: 'TwoFactorRedirectError',
      code: 1018,
    })

    expect(routerPush).toHaveBeenCalledWith({
      name: 'authVerification',
      query: {
        purpose: 'login',
        method: 'code',
        flowId: 'flow-123',
      },
    })
    expect(
      JSON.parse(sessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE) || '{}'),
    ).toMatchObject({
      challengeToken: 'flow-challenge',
      authEntry: 'login',
    })
  })

  it('does not navigate or persist a challenge when the token is missing', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const fulfilledHandler = axiosInstance.interceptors.response.handlers[0]?.fulfilled

    await expect(
      fulfilledHandler({
        data: { code: 1018, data: { purpose: 'disable2fa', method: 'email' } },
        config: { url: '/v1/disable-2fa', method: 'post', headers: new AxiosHeaders() },
      }),
    ).rejects.toMatchObject({ code: 1018 })

    expect(sessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)).toBeNull()
    expect(routerPush).not.toHaveBeenCalled()
  })
  it('opens the verification page when a service checks a non-Axios 2FA result', async () => {
    const result = {
      code: '1018',
      message: '当前操作需要二次验证',
      data: { challengeToken: 'service-challenge', purpose: 'stepup', method: 'email' },
    }

    expect(checkApiResult(result)).toBe(result)
    await vi.waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'authVerification',
          query: { purpose: 'stepup', method: 'email' },
        }),
      ),
    )
  })
})
