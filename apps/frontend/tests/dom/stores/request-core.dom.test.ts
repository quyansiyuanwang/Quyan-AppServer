// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosHeaders, HttpStatusCode } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { OPTION_KEYS } from '@/constant/request'
import { CustomCode } from '@/constant/custom-code'
import { ApiTypesMap } from '@/client/api-types-map.gen'
import { ReplayProtection } from '@/utils/replay-protection'
import * as statusAndCodesUtils from '@/utils/status-and-codes'
import { authEventBus, customCodeBus, webEventBus } from '@/stores/globalInstance'
import { clearAccessToken, MyAxios, setAccessToken, useRequestStore } from '@/stores/request'
import { setLocale } from '@/locales'

const { replaySigningServiceMock } = vi.hoisted(() => ({
  replaySigningServiceMock: {
    ensureSigningMaterial: vi.fn(),
    refreshSigningMaterial: vi.fn(),
    clearSigningMaterial: vi.fn(),
  },
}))

vi.mock('@/service/replaySigningService', () => ({
  ReplaySigningService: {
    getInstance: () => replaySigningServiceMock,
  },
}))

vi.mock('@/utils/client-fingerprint', () => ({
  getOrCreateClientFingerprint: () => 'test-client-fingerprint-0001',
}))

const createAccessToken = (expiration: number) => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(
    JSON.stringify({
      data: JSON.stringify({ data: { userId: 1 }, expiration }),
      type: 'access',
    }),
  )
  return `${header}.${payload}.signature`
}

describe('MyAxios core behaviors', () => {
  const defaultOptionsSnapshot = { ...MyAxios._defaultOptions }

  beforeEach(async () => {
    localStorage.clear()
    clearAccessToken()
    ;(MyAxios as any).refreshTokenPromise = null
    MyAxios._defaultOptions = { ...defaultOptionsSnapshot }
    replaySigningServiceMock.ensureSigningMaterial.mockResolvedValue({
      sessionId: 'session-1',
      signingKey: 'signing-key-1',
      algorithm: 'HMAC-SHA256',
      expiresIn: 600,
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    replaySigningServiceMock.refreshSigningMaterial.mockResolvedValue({
      sessionId: 'session-2',
      signingKey: 'signing-key-2',
      algorithm: 'HMAC-SHA256',
      expiresIn: 600,
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    setActivePinia(createPinia())
    await setLocale('zh-CN')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    clearAccessToken()
    ;(MyAxios as any).refreshTokenPromise = null
    MyAxios._defaultOptions = { ...defaultOptionsSnapshot }
  })

  it('builds final url by replacing and encoding path params', () => {
    const client = new MyAxios('https://api.example.com', 1000)

    expect(
      client.getFinalUrl(ApiTypesMap.PermissionControllerGetUserPermissions as any, { userId: 'u 1' }),
    ).toBe('/v1/permissions/user/u%201')
  })

  it('encodes trusted-device id path param for delete endpoint', () => {
    const client = new MyAxios('https://api.example.com', 1000)

    expect(
      client.getFinalUrl(ApiTypesMap.UserControllerDeleteTwoFactorTrustedDevice as any, {
        deviceId: 'abc/def ghi',
      }),
    ).toBe('/v1/users/me/2fa/trusted-devices/abc%2Fdef%20ghi')
  })

  it('throws when path params are missing or invalid', () => {
    const client = new MyAxios('https://api.example.com', 1000)

    expect(() =>
      client.getFinalUrl(ApiTypesMap.PermissionControllerGetUserPermissions as any, {}),
    ).toThrow('Missing path parameter: userId')

    expect(() =>
      client.getFinalUrl(ApiTypesMap.PermissionControllerGetUserPermissions as any, { userId: '' }),
    ).toThrow('Empty value for URL parameter: userId')

    expect(() =>
      client.getFinalUrl(ApiTypesMap.PermissionControllerGetUserPermissions as any, {
        userId: { id: 'u1' },
      }),
    ).toThrow('Invalid value type for URL parameter: userId')

    expect(() =>
      client.getFinalUrl(ApiTypesMap.PermissionControllerGetUserPermissions as any, {
        userId: null,
      }),
    ).toThrow('Missing value for URL parameter: userId')

    expect(() => client.getFinalUrl(undefined as any, {})).toThrow()
  })

  it('throws when endpoint contains an invalid path parameter key format', () => {
    ;(ApiTypesMap as any).__InvalidPathKeyEndpoint = {
      method: 'GET',
      url: '/test/{1id}',
    }

    const client = new MyAxios('https://api.example.com', 1000)

    expect(() =>
      client.getFinalUrl((ApiTypesMap as any).__InvalidPathKeyEndpoint, {
        '1id': 'abc',
      }),
    ).toThrow('Invalid path parameter name: 1id')

    delete (ApiTypesMap as any).__InvalidPathKeyEndpoint
  })

  it('creates a shared refresh-token promise and resolves/rejects via auth events', async () => {
    const emitSpy = vi.spyOn(authEventBus, 'emit')

    const sharedPromiseA = (MyAxios as any).getRefreshPromise() as Promise<string>
    const sharedPromiseB = (MyAxios as any).getRefreshPromise() as Promise<string>

    expect(sharedPromiseA).toBe(sharedPromiseB)
    expect(emitSpy).toHaveBeenCalledWith('REQUEST_REFRESH_TOKEN')

    authEventBus.emit('ACCESS_TOKEN_REFRESHED', 'new-access-token')
    await expect(sharedPromiseA).resolves.toBe('new-access-token')
    expect((MyAxios as any).refreshTokenPromise).toBeNull()

    const failedPromise = (MyAxios as any).getRefreshPromise() as Promise<string>
    authEventBus.emit('ACCESS_TOKEN_REFRESH_FAILED', new Error('refresh failed'))

    await expect(failedPromise).rejects.toThrow('refresh failed')
    expect((MyAxios as any).refreshTokenPromise).toBeNull()
  })

  it('generates replay-protected headers for protected endpoints', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    vi.spyOn(ReplayProtection, 'generateHeaders').mockReturnValue({
      'X-Nonce': 'nonce',
      'X-Timestamp': '1700000000',
      'X-Sign': 'sign',
      'X-Replay-Session-Id': 'session-1',
    })

    const headers = await client._generateHeaderOptions(
      {
        endpoint: ApiTypesMap.PermissionControllerSetUserPermissions as any,
        body: { permissionAdds: ['user:read'] },
        finalUrl: '/permissions/user/u1',
      },
      {
        retry: false,
        customHeaders: { 'X-Trace': 'trace-1' },
      },
    )

    expect(headers[OPTION_KEYS.SKIP_RETRY]).toBe('true')
    expect(headers['X-Locale']).toBe('zh-CN')
    expect(headers['X-Trace']).toBe('trace-1')
    expect(headers['X-Nonce']).toBe('nonce')
    expect(headers['X-Timestamp']).toBe('1700000000')
    expect(headers['X-Sign']).toBe('sign')
    expect(headers['X-Replay-Session-Id']).toBe('session-1')
    expect(headers['X-Client-Fingerprint']).toBe('test-client-fingerprint-0001')
  })

  it('omits X-Locale for frontend-only emoji locale', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    await setLocale('emoji')

    const headers = await client._generateHeaderOptions(
      {
        endpoint: undefined,
        body: null,
        finalUrl: '/any',
      },
      undefined,
    )

    expect(headers).not.toHaveProperty('X-Locale')
  })

  it('treats ip blacklist unblock endpoint as replay-protected', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const generateHeadersSpy = vi.spyOn(ReplayProtection, 'generateHeaders').mockReturnValue({
      'X-Nonce': 'nonce-blacklist',
      'X-Timestamp': '1700000001',
      'X-Sign': 'sign-blacklist',
      'X-Replay-Session-Id': 'session-blacklist',
    })

    const headers = await client._generateHeaderOptions(
      {
        endpoint: ApiTypesMap.IpBlacklistControllerDeleteIpBlacklist as any,
        body: null,
        finalUrl: '/ip-blacklist/127.0.0.1',
      },
      undefined,
    )

    expect(generateHeadersSpy).toHaveBeenCalledOnce()
    expect(headers['X-Replay-Session-Id']).toBe('session-blacklist')
  })

  it('treats ip whitelist removal endpoint as replay-protected', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const generateHeadersSpy = vi.spyOn(ReplayProtection, 'generateHeaders').mockReturnValue({
      'X-Nonce': 'nonce-whitelist',
      'X-Timestamp': '1700000002',
      'X-Sign': 'sign-whitelist',
      'X-Replay-Session-Id': 'session-whitelist',
    })

    const headers = await client._generateHeaderOptions(
      {
        endpoint: ApiTypesMap.IpWhitelistControllerRemoveWhiteIp as any,
        body: null,
        finalUrl: '/ip-whitelist/remove/127.0.0.1',
      },
      undefined,
    )

    expect(generateHeadersSpy).toHaveBeenCalledOnce()
    expect(headers['X-Replay-Session-Id']).toBe('session-whitelist')
  })

  it('keeps skip-retry header false when retry option is explicitly true', async () => {
    const client = new MyAxios('https://api.example.com', 1000)

    const headers = await client._generateHeaderOptions(
      {
        endpoint: undefined,
        body: null,
        finalUrl: '/any',
      },
      {
        retry: true,
      },
    )

    expect(headers[OPTION_KEYS.SKIP_RETRY]).toBe('false')
  })

  it('supports direct get request with cache busting', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    await setLocale('en')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ code: 0, data: ['ok'] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await client.get(ApiTypesMap.PermissionControllerGetAllPermissions as any, undefined, {
      directRequest: true,
      directCacheBust: true,
      directCredentials: 'include',
    })

    expect(result).toEqual({ code: 0, data: ['ok'] })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [requestUrl, init] = firstCall!
    expect(String(requestUrl)).toContain('https://api.example.com/v1/permissions/all')
    expect(String(requestUrl)).toContain('t=')
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' })
    expect((init as RequestInit).headers).toMatchObject({
      'X-Locale': 'en',
    })
  })

  it('omits X-Locale for direct requests when locale is emoji', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    await setLocale('emoji')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ code: 0, data: ['ok'] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await client.get(ApiTypesMap.PermissionControllerGetAllPermissions as any, undefined, {
      directRequest: true,
    })

    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, init] = firstCall!
    expect((init as RequestInit).headers).not.toHaveProperty('X-Locale')
  })

  it('uses wrapper and axios instance for typed post requests', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const instance = client.getAxios() as unknown as {
      post: ReturnType<typeof vi.fn>
    }

    const postMock = vi.fn().mockResolvedValue({ code: 0 })
    instance.post = postMock

    const requestWrapper = <T>(promise: Promise<T>): Promise<T> => promise

    await client.post(
      ApiTypesMap.PermissionControllerAddUserPermissions as any,
      {
        path: { userId: 'u1' },
        body: { permissions: ['user:read'] },
      },
      {
        requestWrapper,
        retry: false,
      },
    )

    expect(postMock).toHaveBeenCalledWith(
      '/v1/permissions/user/u1/add',
      { permissions: ['user:read'] },
      expect.objectContaining({
        headers: expect.objectContaining({
          [OPTION_KEYS.SKIP_RETRY]: 'true',
        }),
        signal: undefined,
      }),
    )
  })

  it('uses wrapper and axios instance for typed patch requests', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const instance = client.getAxios() as unknown as {
      patch: ReturnType<typeof vi.fn>
    }

    const patchMock = vi.fn().mockResolvedValue({ code: 0 })
    instance.patch = patchMock

    const requestWrapper = <T>(promise: Promise<T>): Promise<T> => promise

    await client.patch(
      ApiTypesMap.UserControllerChangePassword as any,
      {
        path: { userId: 'u1' },
        body: { newPassword: 'new-password' },
      } as any,
      {
        requestWrapper,
      },
    )

    expect(patchMock).toHaveBeenCalledWith(
      '/v1/users/u1/password',
      { newPassword: 'new-password' },
      expect.objectContaining({
        headers: expect.objectContaining({
          [OPTION_KEYS.SKIP_RETRY]: 'false',
        }),
        signal: undefined,
      }),
    )
  })

  it('uses wrapper and axios instance for typed get/delete/put requests', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const instance = client.getAxios() as unknown as {
      get: ReturnType<typeof vi.fn>
      delete: ReturnType<typeof vi.fn>
      put: ReturnType<typeof vi.fn>
    }

    const getMock = vi.fn().mockResolvedValue({ code: 0 })
    const deleteMock = vi.fn().mockResolvedValue({ code: 0 })
    const putMock = vi.fn().mockResolvedValue({ code: 0 })
    instance.get = getMock
    instance.delete = deleteMock
    instance.put = putMock

    const requestWrapper = <T>(promise: Promise<T>): Promise<T> => promise

    await client.get(
      ApiTypesMap.RelayControllerGetUsage as any,
      {
        path: { id: 'tk-1' },
        params: { startDate: '2026-01-01', endDate: '2026-01-31' },
      } as any,
      {
        requestWrapper,
      },
    )

    await client.delete(
      ApiTypesMap.RelayControllerDeleteToken as any,
      {
        path: { id: 'tk-1' },
        params: { force: true },
      } as any,
      {
        requestWrapper,
      },
    )

    await client.put(
      ApiTypesMap.RelayControllerUpdateTokenChannel as any,
      {
        path: { id: 'tk-1' },
        body: { channelId: 'ch-1' },
      } as any,
      {
        requestWrapper,
        retry: false,
      },
    )

    expect(getMock).toHaveBeenCalledWith(
      '/v1/relay/tokens/tk-1/usage',
      expect.objectContaining({
        params: { startDate: '2026-01-01', endDate: '2026-01-31' },
        headers: expect.objectContaining({ [OPTION_KEYS.SKIP_RETRY]: 'false' }),
      }),
    )
    expect(deleteMock).toHaveBeenCalledWith(
      '/v1/relay/tokens/tk-1',
      expect.objectContaining({
        params: { force: true },
        headers: expect.objectContaining({ [OPTION_KEYS.SKIP_RETRY]: 'false' }),
      }),
    )
    expect(putMock).toHaveBeenCalledWith(
      '/v1/relay/tokens/tk-1/channel',
      { channelId: 'ch-1' },
      expect.objectContaining({
        headers: expect.objectContaining({ [OPTION_KEYS.SKIP_RETRY]: 'true' }),
      }),
    )
  })

  it('throws for malformed typed request options when required fields are missing', async () => {
    const client = new MyAxios('https://api.example.com', 1000)

    await expect(
      client.post(ApiTypesMap.PermissionControllerAddUserPermissions as any, {} as any),
    ).rejects.toThrow('Missing path parameter: userId')

    await expect(
      client.delete(ApiTypesMap.RelayControllerDeleteToken as any, {} as any),
    ).rejects.toThrow('Missing path parameter: id')

    await expect(
      client.put(ApiTypesMap.RelayControllerUpdateToken as any, {} as any),
    ).rejects.toThrow('Missing path parameter: id')

    await expect(
      client.patch(ApiTypesMap.UserControllerChangePassword as any, {} as any),
    ).rejects.toThrow('Missing path parameter: userId')
  })

  it('serializes params with repeated keys for arrays and skips nullish values', () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const serializer = (client.getAxios() as any).defaults.paramsSerializer.serialize as (
      params: Record<string, unknown>,
    ) => string

    const queryString = serializer({
      tag: ['a', 'b'],
      page: 1,
      empty: null,
      skip: undefined,
    })

    expect(queryString).toContain('tag=a')
    expect(queryString).toContain('tag=b')
    expect(queryString).toContain('page=1')
    expect(queryString).not.toContain('empty=')
    expect(queryString).not.toContain('skip=')
  })

  it('builds absolute direct request URLs without changing host', () => {
    const client = new MyAxios('https://api.example.com', 1000)

    const absoluteUrl = (client as any).buildRequestUrl(
      'https://static.example.org/path',
      { q: '1' },
      false,
    )

    expect(absoluteUrl).toContain('https://static.example.org/path')
    expect(absoluteUrl).toContain('q=1')
  })

  it('covers static options merge', () => {
    MyAxios.setDefaultOptions({ retry: false, customHeaders: { 'X-Global': '1' } })

    const merged = MyAxios.getMergedOptions({ directRequest: true })
    expect(merged.retry).toBe(false)
    expect(merged.customHeaders['X-Global']).toBe('1')
    expect(merged.directRequest).toBe(true)
  })

  it('throws on failed direct request response', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      client.get(ApiTypesMap.PermissionControllerGetAllPermissions as any, undefined, {
        directRequest: true,
      }),
    ).rejects.toThrow('Request failed: 503')
  })

  it('builds direct request URL with query params and ignores nullish values', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ code: 0, data: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await client.get(
      ApiTypesMap.RelayControllerGetUsage as any,
      {
        path: { id: 'tk-1' },
        params: { startDate: '2026-01-01', endDate: undefined, skip: null },
      } as any,
      {
        directRequest: true,
      },
    )

    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [requestUrl] = firstCall!
    const urlString = String(requestUrl)
    expect(urlString).toContain('/relay/tokens/tk-1/usage')
    expect(urlString).toContain('startDate=2026-01-01')
    expect(urlString).not.toContain('endDate=')
    expect(urlString).not.toContain('skip=')
  })

  it('handles request interceptor for skip/excluded and refresh fallback', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const axiosInstance: any = client.getAxios()
    const requestHandler = axiosInstance.interceptors.request.handlers[0]?.fulfilled

    expect(requestHandler).toBeDefined()

    setAccessToken('token-1')

    const skipConfig = {
      url: '/users',
      headers: new AxiosHeaders({ [OPTION_KEYS.SKIP_RETRY]: 'true' }),
    }
    await requestHandler(skipConfig)
    expect(skipConfig.headers.get('Authorization')).toBe('Bearer token-1')

    const excludedConfig = {
      url: '/auth/login',
      headers: new AxiosHeaders(),
    }
    await requestHandler(excludedConfig)
    expect(excludedConfig.headers.get('Authorization')).toBe('Bearer token-1')
    ;(MyAxios as any).refreshTokenPromise = Promise.reject(new Error('refresh failed'))
    const fallbackConfig = {
      url: '/permissions/all',
      headers: new AxiosHeaders(),
    }
    await requestHandler(fallbackConfig)
    expect(fallbackConfig.headers.get('Authorization')).toBe('Bearer token-1')
  })

  it('handles request interceptor refresh-success path and request-error rejection hook', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const axiosInstance: any = client.getAxios()
    const requestHandler = axiosInstance.interceptors.request.handlers[0]?.fulfilled
    const requestErrorHandler = axiosInstance.interceptors.request.handlers[0]?.rejected

    setAccessToken('stale-token')
    ;(MyAxios as any).refreshTokenPromise = Promise.resolve('refreshed-token')

    const refreshConfig = {
      url: '/permissions/all',
      headers: new AxiosHeaders(),
    }

    await requestHandler(refreshConfig)
    expect(refreshConfig.headers.get('Authorization')).toBe('Bearer refreshed-token')

    clearAccessToken()
    const noTokenConfig = {
      url: '/permissions/all',
      headers: new AxiosHeaders(),
    }
    await requestHandler(noTokenConfig)
    expect(noTokenConfig.headers.get('Authorization')).toBeUndefined()
    ;(MyAxios as any).refreshTokenPromise = null
    setAccessToken('token-no-url')
    const noUrlConfig = {
      headers: new AxiosHeaders(),
    }
    await requestHandler(noUrlConfig)
    expect(noUrlConfig.headers.get('Authorization')).toBe('Bearer token-no-url')

    setAccessToken(createAccessToken(1))
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    ;(MyAxios as any).refreshTokenPromise = null

    const expiredConfig = {
      url: '/permissions/all',
      headers: new AxiosHeaders(),
    }
    const refreshPromise = requestHandler(expiredConfig)
    authEventBus.emit('ACCESS_TOKEN_REFRESHED', 'fresh-from-event')
    await refreshPromise
    expect(expiredConfig.headers.get('Authorization')).toBe('Bearer fresh-from-event')

    const interceptorError = new Error('request-interceptor-error')
    await expect(requestErrorHandler(interceptorError)).rejects.toBe(interceptorError)
  })

  it('handles response interceptors for success, business error, retry and fallback', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const axiosInstance: any = client.getAxios()
    const responseHandler = axiosInstance.interceptors.response.handlers[0]?.fulfilled
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected

    expect(responseHandler).toBeDefined()
    expect(errorHandler).toBeDefined()

    const customEmitSpy = vi.spyOn(customCodeBus, 'emit')
    const webEmitSpy = vi.spyOn(webEventBus, 'emit')

    const okResult = await responseHandler({
      status: HttpStatusCode.Ok,
      data: { code: CustomCode.OK, payload: 1 },
    })
    expect(okResult).toEqual({ code: CustomCode.OK, payload: 1 })
    expect(customEmitSpy).toHaveBeenCalledWith('OK', { code: CustomCode.OK, payload: 1 })
    expect(webEmitSpy).toHaveBeenCalledWith('Ok', expect.any(Object))

    await expect(
      responseHandler({
        status: HttpStatusCode.Ok,
        data: { code: CustomCode.INTERNAL_SERVER_ERROR, message: 'boom' },
      }),
    ).rejects.toThrow('boom')

    await expect(
      responseHandler({
        status: HttpStatusCode.Ok,
        data: { code: CustomCode.INTERNAL_SERVER_ERROR },
      }),
    ).rejects.toThrow('Request failed')

    axiosInstance.request = vi.fn().mockResolvedValue({ retried: true })
    ;(MyAxios as any).refreshTokenPromise = Promise.resolve('new-token')

    const unauthorizedError: any = {
      response: { status: HttpStatusCode.Unauthorized, data: {} },
      config: { url: '/permissions/all', headers: {} },
    }

    const retryResult = await errorHandler(unauthorizedError)
    expect(retryResult).toEqual({ retried: true })
    expect(unauthorizedError.config._retry).toBe(true)
    expect(unauthorizedError.config.headers.Authorization).toBe('Bearer new-token')

    const genericError: any = {
      status: HttpStatusCode.Forbidden,
      response: {
        status: HttpStatusCode.Forbidden,
        data: { code: CustomCode.PERMISSION_DENIED, message: 'forbidden' },
      },
      config: { url: '/users', headers: {} },
    }

    const genericResult = await errorHandler(genericError)
    expect(genericResult).toEqual({ code: CustomCode.PERMISSION_DENIED, message: 'forbidden' })
    expect(customEmitSpy).toHaveBeenCalledWith('PERMISSION_DENIED', {
      code: CustomCode.PERMISSION_DENIED,
      message: 'forbidden',
    })
    expect(webEmitSpy).toHaveBeenCalledWith('Forbidden', genericError)

    const noStatusError: any = {
      response: {
        status: HttpStatusCode.BadRequest,
        data: { message: 'bad request' },
      },
      config: { url: '/users', headers: {} },
    }

    const noStatusResult = await errorHandler(noStatusError)
    expect(noStatusResult).toEqual({ message: 'bad request' })
  })

  it('retries once after refreshing an expired replay signing session', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected
    const customEmitSpy = vi.spyOn(customCodeBus, 'emit')

    vi.spyOn(ReplayProtection, 'generateHeaders').mockReturnValue({
      'X-Nonce': 'nonce-retry',
      'X-Timestamp': '1700000001',
      'X-Sign': 'sign-retry',
      'X-Replay-Session-Id': 'session-2',
    })

    axiosInstance.request = vi.fn().mockResolvedValue({ code: CustomCode.OK, recovered: true })

    const replayFailureError: any = {
      response: {
        status: HttpStatusCode.Unauthorized,
        data: {
          code: CustomCode.REPLAY_PROTECTION_FAILED,
          message: '签名会话已过期，请重试',
        },
      },
      config: {
        url: '/auth/verify',
        data: { access_token: 'token-1' },
        headers: {
          'X-Replay-Session-Id': 'session-1',
          'X-Nonce': 'nonce-old',
          'X-Timestamp': '1700000000',
          'X-Sign': 'sign-old',
        },
      },
    }

    const result = await errorHandler(replayFailureError)

    expect(result).toEqual({ code: CustomCode.OK, recovered: true })
    expect(replaySigningServiceMock.clearSigningMaterial).toHaveBeenCalledTimes(1)
    expect(replaySigningServiceMock.refreshSigningMaterial).toHaveBeenCalledTimes(1)
    expect(axiosInstance.request).toHaveBeenCalledWith(
      expect.objectContaining({
        _replaySigningRetry: true,
        headers: expect.objectContaining({
          'X-Client-Fingerprint': 'test-client-fingerprint-0001',
          'X-Replay-Session-Id': 'session-2',
          'X-Nonce': 'nonce-retry',
          'X-Timestamp': '1700000001',
          'X-Sign': 'sign-retry',
        }),
      }),
    )
    expect(customEmitSpy).not.toHaveBeenCalledWith('REPLAY_PROTECTION_FAILED', expect.anything())
  })

  it('skips custom/status event emits when response code and status text are unknown', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const axiosInstance: any = client.getAxios()
    const responseHandler = axiosInstance.interceptors.response.handlers[0]?.fulfilled

    const customEmitSpy = vi.spyOn(customCodeBus, 'emit')
    const webEmitSpy = vi.spyOn(webEventBus, 'emit')

    const result = await responseHandler({
      status: 999,
      data: { payload: 1 },
    })

    expect(result).toEqual({ payload: 1 })
    expect(customEmitSpy).not.toHaveBeenCalled()
    expect(webEmitSpy).not.toHaveBeenCalled()
  })

  it('does not emit Unauthorized event when status text helper returns undefined', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected

    vi.spyOn(statusAndCodesUtils, 'getHttpStatusText').mockReturnValue(undefined as any)

    const webEmitSpy = vi.spyOn(webEventBus, 'emit')
    ;(MyAxios as any).refreshTokenPromise = Promise.reject(new Error('refresh down'))

    const unauthorizedError: any = {
      status: HttpStatusCode.Unauthorized,
      response: { status: HttpStatusCode.Unauthorized, data: {} },
      config: { url: '/permissions/all', headers: {} },
    }

    await expect(errorHandler(unauthorizedError)).rejects.toThrow('refresh down')
    expect(webEmitSpy).not.toHaveBeenCalledWith('Unauthorized', unauthorizedError)
  })

  it('emits Unauthorized and rejects when token refresh fails during response retry', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected
    const webEmitSpy = vi.spyOn(webEventBus, 'emit')

    ;(MyAxios as any).refreshTokenPromise = Promise.reject(new Error('refresh crashed'))

    const unauthorizedError: any = {
      status: HttpStatusCode.Unauthorized,
      response: { status: HttpStatusCode.Unauthorized, data: {} },
      config: { url: '/permissions/all', headers: {} },
    }

    await expect(errorHandler(unauthorizedError)).rejects.toThrow('refresh crashed')
    expect(webEmitSpy).toHaveBeenCalledWith('Unauthorized', unauthorizedError)
  })

  it('handles unauthorized retry path when error config has no url', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected
    const webEmitSpy = vi.spyOn(webEventBus, 'emit')

    ;(MyAxios as any).refreshTokenPromise = Promise.reject(new Error('refresh crashed no url'))

    const unauthorizedError: any = {
      status: HttpStatusCode.Unauthorized,
      response: { status: HttpStatusCode.Unauthorized, data: {} },
      config: { headers: {} },
    }

    await expect(errorHandler(unauthorizedError)).rejects.toThrow('refresh crashed no url')
    expect(webEmitSpy).toHaveBeenCalledWith('Unauthorized', unauthorizedError)
  })

  it('initializes missing retry headers before replaying unauthorized request', async () => {
    const client = new MyAxios('https://api.example.com', 1000)
    const axiosInstance: any = client.getAxios()
    const errorHandler = axiosInstance.interceptors.response.handlers[0]?.rejected

    axiosInstance.request = vi.fn().mockResolvedValue({ retried: true })
    ;(MyAxios as any).refreshTokenPromise = Promise.resolve('token-after-refresh')

    const unauthorizedError: any = {
      response: { status: HttpStatusCode.Unauthorized, data: {} },
      config: { url: '/permissions/all' },
    }

    const retried = await errorHandler(unauthorizedError)

    expect(retried).toEqual({ retried: true })
    expect(unauthorizedError.config.headers.Authorization).toBe('Bearer token-after-refresh')
  })

  it('creates request store instance and custom axios clients', () => {
    const store = useRequestStore()

    const defaultAxios = store.getAxios()
    const customAxios = store.createAxios('https://backend.example.com')

    expect(defaultAxios).toBeDefined()
    expect(customAxios).toBeInstanceOf(MyAxios)
    expect(customAxios.getAxios()).toBeDefined()
  })
})
