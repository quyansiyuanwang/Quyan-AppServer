// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosHeaders, CanceledError, HttpStatusCode } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import StorageKey from '@/constant/storagekey'
import { twoFactorOverlayService } from '@/service/twoFactorOverlayService'
import { clearAccessToken, clearLegacyAuthStorage, MyAxios, setAccessToken } from '@/stores/request'
import { getBackendLocale, setLocale } from '@/locales'
import { checkApiResult } from '@/utils/service-utils'
import { configureRequestErrorNotifier, showRequestErrorNotice } from '@/utils/requestErrorNotice'

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
    twoFactorOverlayService.close()
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
    twoFactorOverlayService.close()
    clearAccessToken()
    localStorage.clear()
    sessionStorage.clear()
    ;(MyAxios as any).refreshTokenPromise = null
  })

  it.each(['local', 'silent'] as const)(
    'honors %s presentation through HTTP failures',
    async (presentation) => {
      const client = new MyAxios('https://backend.example.test', 1000)
      const instance: any = client.getAxios()
      const rejected = instance.interceptors.response.handlers[0].rejected
      const error = Object.assign(new Error('Request failed with status code 503'), {
        config: { url: '/v1/probe', headers: new AxiosHeaders(), errorPresentation: presentation },
        response: {
          status: 503,
          data: { code: 500, message: `localized ${presentation} failure` },
        },
      })
      await expect(rejected(error)).rejects.toBe(error)
      expect(notifyMock).not.toHaveBeenCalled()
      showRequestErrorNotice(error)
      expect(notifyMock).toHaveBeenCalledTimes(presentation === 'local' ? 1 : 0)
    },
  )

  it('sends the current locale on every request-layer transport', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const locales: Array<string | null | undefined> = []
    const localeOf = (headers: unknown) =>
      new AxiosHeaders(headers as never).get('X-Locale') as string | null | undefined

    axiosInstance.defaults.adapter = async (config: any) => {
      locales.push(localeOf(config.headers))
      return {
        data: { code: 0, message: 'ok' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      locales.push(localeOf(init.headers))
      return { ok: true, status: 200, json: async () => ({ code: 0, message: 'ok' }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const endpoint = { method: 'GET', url: '/v1/probe' } as any
    try {
      // Interceptor path (generated client), direct fetch path and the
      // lifecycle keepalive path must agree on the request language.
      await client.get(endpoint)
      await client.get(endpoint, undefined, { directRequest: true, skipProgressBar: true })
      await client.postKeepalive('/v1/probe', { ping: true })

      expect(locales).toEqual([getBackendLocale(), getBackendLocale(), getBackendLocale()])

      locales.length = 0
      await setLocale('en')
      await client.get(endpoint)
      expect(locales).toEqual(['en'])
    } finally {
      vi.unstubAllGlobals()
      await setLocale('zh-CN')
    }
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

  it('opens an overlay before business success handlers run', async () => {
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

    const handledResponse = fulfilledHandler({
      data: responseData,
      config: { url: '/v1/redemption-codes', method: 'post', headers: new AxiosHeaders() },
    })

    expect(sessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)).toContain(
      'challenge-token',
    )
    expect(twoFactorOverlayService.state.context).toMatchObject({
      challengeToken: 'challenge-token',
      purpose: 'stepup',
      method: 'code',
    })
    expect(routerPush).not.toHaveBeenCalled()

    // The original promise stays pending and is settled by the retry result,
    // so callers never render the 2FA challenge as an ordinary error.
    let requestSettled = false
    void handledResponse.finally(() => {
      requestSettled = true
    })
    await Promise.resolve()
    expect(requestSettled).toBe(false)

    axiosInstance.request = vi.fn().mockResolvedValue({ code: 0, retried: true })
    await client.retryPendingTwoFactorRequests()
    await expect(handledResponse).resolves.toEqual({ code: 0, retried: true })
  })

  it('holds concurrent step-up requests behind one challenge and retries each once', async () => {
    const client = new MyAxios('https://backend.example.test', 1000)
    const axiosInstance: any = client.getAxios()
    const fulfilled = axiosInstance.interceptors.response.handlers[0]?.fulfilled
    const challenge = {
      code: 1018,
      data: { challengeToken: 'shared-challenge', purpose: 'stepup', method: 'code' },
    }
    const first = fulfilled({
      data: challenge,
      config: { url: '/v1/first', method: 'post', headers: new AxiosHeaders() },
    })
    const second = fulfilled({
      data: { ...challenge, data: { ...challenge.data, challengeToken: 'other-challenge' } },
      config: { url: '/v1/second', method: 'post', headers: new AxiosHeaders() },
    })

    await Promise.resolve()
    expect(twoFactorOverlayService.state.context?.challengeToken).toBe('shared-challenge')
    expect(routerPush).not.toHaveBeenCalled()

    axiosInstance.request = vi.fn((request: { url: string }) =>
      Promise.resolve({ url: request.url }),
    )
    await client.retryPendingTwoFactorRequests()
    await expect(first).resolves.toEqual({ url: '/v1/first' })
    await expect(second).resolves.toEqual({ url: '/v1/second' })
    expect(axiosInstance.request).toHaveBeenCalledTimes(2)
  })

  it('opens an overlay for nested Axios error responses and preserves challenge details', async () => {
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

    const handledError = errorHandler(errorResponse)
    expect(sessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)).toContain(
      'error-challenge',
    )
    expect(twoFactorOverlayService.state.context).toMatchObject({
      challengeToken: 'error-challenge',
      purpose: 'login',
      method: 'passkey',
    })
    expect(routerPush).not.toHaveBeenCalled()

    // Login challenges are control flow, not a queued retry: the verification
    // endpoint establishes the session and the login page consumes this error.
    await expect(handledError).rejects.toMatchObject({
      name: 'TwoFactorRedirectError',
      code: 1018,
    })
  })

  it('preserves the central-login flow id when opening login verification', async () => {
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

    await expect(errorHandler(errorResponse)).rejects.toMatchObject({
      name: 'TwoFactorRedirectError',
      code: 1018,
    })

    expect(twoFactorOverlayService.state.context).toMatchObject({
      challengeToken: 'flow-challenge',
      purpose: 'login',
      method: 'code',
      flowId: 'flow-123',
    })
    expect(routerPush).not.toHaveBeenCalled()
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
  it('opens the overlay when a service checks a non-Axios 2FA result', async () => {
    const result = {
      code: '1018',
      message: '当前操作需要二次验证',
      data: { challengeToken: 'service-challenge', purpose: 'stepup', method: 'email' },
    }

    expect(checkApiResult(result)).toBe(result)
    await vi.waitFor(() =>
      expect(twoFactorOverlayService.state.context).toMatchObject({
        challengeToken: 'service-challenge',
        purpose: 'stepup',
        method: 'email',
      }),
    )
    expect(routerPush).not.toHaveBeenCalled()
  })
})
