import { TypedSessionStorage } from '@/utils/typedSessionStorage'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import axios, { type Axios, type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { defineStore } from 'pinia'
import { HttpStatusCode } from 'axios'
import { webEventBus, authEventBus, customCodeBus } from '@/stores/globalInstance'
import StorageKey from '@/constant/storagekey'
import { EXCLUDED_URLS, OPTION_KEYS } from '@/constant/request'
import type { ApiEndpointDescriptor, ApiMethod } from '@/client/api-types-map.gen'
import { getCustomCodeText, getHttpStatusText } from '@/utils/status-and-codes'
import { CustomCode } from '@/constant/custom-code'
import type { PromDeResp } from '@/types/responseData'
import type { WithoutNever } from '@/types/common'
import { ReplayProtection } from '@/utils/replay-protection'
import { getOrCreateClientFingerprint } from '@/utils/client-fingerprint'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { ReplaySigningService } from '@/service/replaySigningService'
import { getBackendLocale } from '@/locales'

type AnyEndpointDescriptor = ApiEndpointDescriptor<ApiMethod, any, any, any, any, any>
type EndpointWithMethod<METHOD extends ApiMethod> = ApiEndpointDescriptor<
  METHOD,
  any,
  any,
  any,
  any,
  any
>

type RetryAxiosRequest = InternalAxiosRequestConfig & {
  _retry?: boolean
  _replaySigningRetry?: boolean
  _twoFactorRetry?: boolean
  _twoFactorRetryCount?: number
}

const NO_REFRESH_RETRY_CUSTOM_CODES = new Set<number>([
  CustomCode.REPLAY_PROTECTION_FAILED,
  CustomCode.TWO_FACTOR_REQUIRED,
  CustomCode.TWO_FACTOR_CHALLENGE_EXPIRED,
  CustomCode.TWO_FACTOR_CODE_INVALID,
  CustomCode.TWO_FACTOR_SETUP_SESSION_EXPIRED,
  CustomCode.TWO_FACTOR_NOT_ENABLED,
  CustomCode.TWO_FACTOR_ALREADY_ENABLED,
  CustomCode.POLICY_CONSENT_REQUIRED,
])

const REPLAY_SIGNING_RECOVERABLE_MESSAGE_HINT = '签名会话'

const ifElseDefault = <T, F, D>(value: any, t: T, f: F, defaultValue: D): T | F | D => {
  if (value === undefined) return defaultValue
  return value ? t : f
}

const authMemoryState = {
  accessToken: null as string | null,
  accessTokenExpiration: null as number | null,
}

const getTokenExpirationStorageKey = (isRefresh: boolean): string =>
  isRefresh ? StorageKey.Auth.REFRESH_TOKEN_EXPIRATION : StorageKey.Auth.ACCESS_TOKEN_EXPIRATION

const getStoredTokenKey = (isRefresh: boolean): string =>
  isRefresh ? StorageKey.Auth.REFRESH_TOKEN : StorageKey.Auth.ACCESS_TOKEN

const readStorageValue = (key: string): string | null => {
  try {
    return TypedLocalStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStorageValue = (key: string, value: string): void => {
  try {
    TypedLocalStorage.setItem(key, value)
  } catch {
    // ignore storage failures in restricted environments
  }
}

const removeStorageValue = (key: string): void => {
  try {
    TypedLocalStorage.removeItem(key)
  } catch {
    // ignore storage failures in restricted environments
  }
}

// Token 解析相关工具函数
interface TokenPayload<T = Record<string, unknown>> {
  data: T
  expiration: number
}

interface JWTClaims {
  data: string // JSON string of TokenPayload
  type: string
}

/**
 * 解析 JWT token 获取 payload（不验证签名，仅解码）
 */
const parseJWT = <T = Record<string, unknown>>(token: string): TokenPayload<T> | null => {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[1]) return null

    // Base64URL decode payload
    const payload = parts[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    )

    const claims: JWTClaims = JSON.parse(jsonPayload)
    const tokenPayload: TokenPayload<T> = JSON.parse(claims.data)

    return tokenPayload
  } catch {
    return null
  }
}

/**
 * 从 token 中提取过期时间并存储到 localStorage
 */
const saveTokenExpiration = (token: string, isRefresh: boolean = false): void => {
  const payload = parseJWT(token)
  if (payload?.expiration) {
    writeStorageValue(getTokenExpirationStorageKey(isRefresh), String(payload.expiration))
    if (!isRefresh) authMemoryState.accessTokenExpiration = payload.expiration
  }
}

/**
 * 检查 token 是否已过期
 */
const isTokenExpired = (options: { bufferSeconds?: number; isRefresh?: boolean } = {}): boolean => {
  const { bufferSeconds = 3, isRefresh = false } = { ...options }

  const expirationStorageKey = getTokenExpirationStorageKey(isRefresh)
  let expiration = readStorageValue(expirationStorageKey) ?? undefined

  const sourceToken = isRefresh
    ? readStorageValue(getStoredTokenKey(true))
    : authMemoryState.accessToken || readStorageValue(getStoredTokenKey(false))

  if (!expiration && sourceToken) {
    const payload = parseJWT(sourceToken)
    console.debug('[Token] Parsed payload from token:', payload)
    if (payload?.expiration) {
      expiration = payload.expiration.toString()
      writeStorageValue(expirationStorageKey, expiration)
      if (!isRefresh) authMemoryState.accessTokenExpiration = payload.expiration
    }
  }

  if (!expiration) {
    console.debug('[Token] No expiration found, assuming not expired')
    return false
  }

  const expirationTime = parseFloat(expiration)
  const currentTime = Date.now() / 1000 // 转换为秒
  const isExpired = currentTime >= expirationTime - bufferSeconds

  console.debug('[Token] Expiration check:', {
    expirationTime,
    currentTime,
    bufferSeconds,
    isExpired,
    remainingSeconds: expirationTime - currentTime,
  })

  return isExpired
}

/**
 * 清除 token 过期时间
 */
const clearTokenExpiration = (isRefresh: boolean = false): void => {
  removeStorageValue(getTokenExpirationStorageKey(isRefresh))
  if (!isRefresh) authMemoryState.accessTokenExpiration = null
}

const setAccessToken = (token?: string | null): string | null => {
  const normalizedToken = token?.trim() || null
  authMemoryState.accessToken = normalizedToken
  clearTokenExpiration()
  if (normalizedToken) saveTokenExpiration(normalizedToken)
  return normalizedToken
}

const getAccessToken = (): string | null => authMemoryState.accessToken

const clearAccessToken = (): void => {
  authMemoryState.accessToken = null
  clearTokenExpiration()
}

const getLocaleHeaders = (): Record<string, string> => {
  const locale = getBackendLocale()
  return locale ? { 'X-Locale': locale } : {}
}

export {
  parseJWT,
  saveTokenExpiration,
  isTokenExpired,
  clearTokenExpiration,
  setAccessToken,
  getAccessToken,
  clearAccessToken,
}

export interface RequestOptions {
  retry?: boolean
  requestWrapper?: <T>(promise: Promise<T>) => Promise<T>
  directRequest?: boolean
  directCacheBust?: boolean
  directCredentials?: RequestCredentials
  customHeaders?: Record<string, string>
  enableReplayProtection?: boolean
  signal?: AbortSignal
  skipProgressBar?: boolean
}

type FullRequestOptions = Required<Omit<RequestOptions, 'signal'>> & Pick<RequestOptions, 'signal'>

const PATH_PARAM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const hasOwnPathParam = (path: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(path, key)

const encodePathParam = (value: unknown, key: string): string => {
  if (value === undefined || value === null) {
    throw new Error(`Missing value for URL parameter: ${key}`)
  }

  const valueType = typeof value
  if (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
    throw new Error(`Invalid value type for URL parameter: ${key}`)
  }

  const normalized = String(value)
  if (!normalized.trim()) {
    throw new Error(`Empty value for URL parameter: ${key}`)
  }

  return encodeURIComponent(normalized)
}

class MyAxios {
  private baseURL: string
  private instance: Axios
  private static refreshTokenPromise: Promise<string> | null = null
  private static pendingTwoFactorRequests: RetryAxiosRequest[] = []
  static _defaultOptions: FullRequestOptions = {
    retry: true,
    requestWrapper: (p) => p,
    directRequest: false,
    directCacheBust: false,
    directCredentials: 'same-origin',
    customHeaders: {},
    enableReplayProtection: false,
    skipProgressBar: false,
  }

  private static getHeaderValue(headers: unknown, key: string): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined

    const candidate = headers as Record<string, unknown> & {
      get?: (name: string) => unknown
    }

    if (typeof candidate.get === 'function') {
      const value = candidate.get(key) ?? candidate.get(key.toLowerCase())
      if (typeof value === 'string') return value
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
    }

    const directValue = candidate[key] ?? candidate[key.toLowerCase()]
    return typeof directValue === 'string' ? directValue : undefined
  }

  private static setHeaderValue(headers: unknown, key: string, value: string): void {
    if (!headers || typeof headers !== 'object') return

    const candidate = headers as Record<string, unknown> & {
      set?: (name: string, value: string) => unknown
    }

    if (typeof candidate.set === 'function') {
      candidate.set(key, value)
      return
    }

    candidate[key] = value
    candidate[key.toLowerCase()] = value
  }

  private static deleteHeaderValue(headers: unknown, key: string): void {
    if (!headers || typeof headers !== 'object') return

    const candidate = headers as Record<string, unknown> & {
      delete?: (name: string) => unknown
    }

    if (typeof candidate.delete === 'function') {
      candidate.delete(key)
      candidate.delete(key.toLowerCase())
      return
    }

    delete candidate[key]
    delete candidate[key.toLowerCase()]
  }

  private static hasReplayProtectionHeaders(headers: unknown): boolean {
    return Boolean(MyAxios.getHeaderValue(headers, 'X-Replay-Session-Id'))
  }

  private static isReplaySigningSessionRecoverableFailure(responseData: any): boolean {
    if (responseData?.code !== CustomCode.REPLAY_PROTECTION_FAILED) return false

    const message = String(responseData?.message || '').trim()
    return message.includes(REPLAY_SIGNING_RECOVERABLE_MESSAGE_HINT)
  }

  private static normalizeReplayRequestBody(data: unknown): unknown {
    if (typeof data !== 'string') return data

    const trimmed = data.trim()
    if (!trimmed) return ''

    try {
      return JSON.parse(trimmed)
    } catch {
      return data
    }
  }

  // 保存待 2FA 验证的请求（加入队列）
  static savePendingTwoFactorRequest(request: RetryAxiosRequest) {
    MyAxios.pendingTwoFactorRequests.push(request)
    console.log('[2FA Queue] Request saved to queue:', {
      url: request.url,
      method: request.method,
      queueLength: MyAxios.pendingTwoFactorRequests.length,
    })
  }

  // 获取所有待 2FA 验证的请求并清空队列
  static getPendingTwoFactorRequests(): RetryAxiosRequest[] {
    const requests = [...MyAxios.pendingTwoFactorRequests]
    MyAxios.pendingTwoFactorRequests = []
    console.log('[2FA Queue] Retrieved and cleared queue:', {
      count: requests.length,
    })
    return requests
  }

  // 清除所有待 2FA 验证的请求
  static clearPendingTwoFactorRequests() {
    MyAxios.pendingTwoFactorRequests = []
  }

  // 重试所有待 2FA 验证的请求
  async retryPendingTwoFactorRequests() {
    const pendingRequests = MyAxios.getPendingTwoFactorRequests()
    if (pendingRequests.length === 0) {
      console.log('[2FA Retry] No pending requests to retry')
      return []
    }

    console.log(`[2FA Retry] Retrying ${pendingRequests.length} pending request(s)`)

    // 在重试前检查并刷新 token（如果需要）
    const accessToken = getAccessToken()
    if (accessToken && isTokenExpired({ bufferSeconds: 2 })) {
      console.log('[2FA Retry] Token expired, refreshing before retry...')
      try {
        await MyAxios.getRefreshPromise()
        console.log('[2FA Retry] Token refreshed successfully')
      } catch (error) {
        console.error('[2FA Retry] Failed to refresh token:', error)
        // 继续尝试重试，让请求拦截器处理
      }
    }

    // 并发重试所有请求
    const retryPromises = pendingRequests.map(async (request, index) => {
      // 标记为 2FA 重试，避免再次保存
      request._twoFactorRetry = true
      // 增加重试计数
      request._twoFactorRetryCount = (request._twoFactorRetryCount || 0) + 1

      // 清除旧的 Authorization header，让请求拦截器重新设置（可能需要刷新 token）
      if (request.headers) {
        delete request.headers.Authorization
        delete request.headers.authorization
      }

      // 重新生成防重放保护请求头（如果需要）
      if (MyAxios.hasReplayProtectionHeaders(request.headers)) {
        const body = request.data ? MyAxios.normalizeReplayRequestBody(request.data) : undefined
        const path = request.url || ''
        const signingMaterial = await ReplaySigningService.getInstance().ensureSigningMaterial()
        const replayHeaders = ReplayProtection.generateHeaders(body, path, signingMaterial)

        if (request.headers) {
          MyAxios.deleteHeaderValue(request.headers, 'X-Nonce')
          MyAxios.deleteHeaderValue(request.headers, 'X-Timestamp')
          MyAxios.deleteHeaderValue(request.headers, 'X-Sign')
          MyAxios.deleteHeaderValue(request.headers, 'X-Replay-Session-Id')

          Object.entries(replayHeaders).forEach(([key, value]) => {
            MyAxios.setHeaderValue(request.headers, key, value)
          })
          console.log(`[2FA Retry] Regenerated replay protection headers for request ${index + 1}`)
        }
      }

      // 添加一次性令牌（如果存在）
      const oneTimeToken = TypedSessionStorage.getItem(StorageKey.Auth.ONE_TIME_TOKEN)
      if (oneTimeToken && request.headers) {
        request.headers['X-Onetime-Token'] = oneTimeToken
        console.log(`[2FA Retry] Adding one-time token to request ${index + 1}`)
      }

      console.log(`[2FA Retry] Request ${index + 1}:`, {
        url: request.url,
        method: request.method,
        retryCount: request._twoFactorRetryCount,
        hasOneTimeToken: !!oneTimeToken,
      })

      return this.instance.request(request).catch((error) => {
        console.error(`[2FA Retry] Failed to retry request ${index + 1}:`, error)
        return null
      })
    })

    const results = await Promise.all(retryPromises)

    // 清除一次性令牌（重试完成后立即清除）
    TypedSessionStorage.removeItem(StorageKey.Auth.ONE_TIME_TOKEN)
    console.log('[2FA Retry] One-time token cleared after retry')

    console.log('[2FA Retry] All retries completed:', results)
    return results
  }

  // 获取或创建刷新 token 的 Promise（保证只创建一次）
  private static getRefreshPromise(): Promise<string> {
    if (!MyAxios.refreshTokenPromise) {
      MyAxios.refreshTokenPromise = new Promise<string>((resolve, reject) => {
        const onSuccess = (newToken: string) => {
          authEventBus.off('ACCESS_TOKEN_REFRESHED', onSuccess)
          authEventBus.off('ACCESS_TOKEN_REFRESH_FAILED', onFailed)
          resolve(newToken)
        }
        const onFailed = (error: Error) => {
          authEventBus.off('ACCESS_TOKEN_REFRESHED', onSuccess)
          authEventBus.off('ACCESS_TOKEN_REFRESH_FAILED', onFailed)
          reject(error)
        }

        authEventBus.on('ACCESS_TOKEN_REFRESHED', onSuccess, false)
        authEventBus.on('ACCESS_TOKEN_REFRESH_FAILED', onFailed, false)
        authEventBus.emit('REQUEST_REFRESH_TOKEN')
      }).finally(() => {
        MyAxios.refreshTokenPromise = null
      })
    }
    return MyAxios.refreshTokenPromise
  }

  private async retryWithFreshReplaySigningSession(
    originalRequest: RetryAxiosRequest,
  ): Promise<unknown> {
    originalRequest._replaySigningRetry = true

    if (!originalRequest.headers) originalRequest.headers = {} as any

    const replaySigningService = ReplaySigningService.getInstance()
    replaySigningService.clearSigningMaterial()

    const signingMaterial = await replaySigningService.refreshSigningMaterial()
    const finalUrl = String(originalRequest.url || '').trim()
    const requestBody = MyAxios.normalizeReplayRequestBody(originalRequest.data)
    const replayHeaders = ReplayProtection.generateHeaders(requestBody, finalUrl, signingMaterial)
    const clientFingerprint = getOrCreateClientFingerprint()

    MyAxios.deleteHeaderValue(originalRequest.headers, 'X-Nonce')
    MyAxios.deleteHeaderValue(originalRequest.headers, 'X-Timestamp')
    MyAxios.deleteHeaderValue(originalRequest.headers, 'X-Sign')
    MyAxios.deleteHeaderValue(originalRequest.headers, 'X-Replay-Session-Id')

    if (clientFingerprint) {
      MyAxios.setHeaderValue(originalRequest.headers, 'X-Client-Fingerprint', clientFingerprint)
    }

    Object.entries(replayHeaders).forEach(([key, value]) => {
      MyAxios.setHeaderValue(originalRequest.headers, key, value)
    })

    return this.instance.request(originalRequest)
  }

  constructor(baseURL: string, timeout: number) {
    const configuredBaseUrl = String(baseURL || '').trim()
    this.baseURL = /^https?:\/\//.test(configuredBaseUrl)
      ? configuredBaseUrl
      : new URL(configuredBaseUrl || '/', window.location.origin).toString()
    this.instance = axios.create({
      baseURL,
      timeout,
      withCredentials: true,
      paramsSerializer: {
        serialize: (params) => {
          const searchParams = new URLSearchParams()
          Object.entries(params).forEach(([key, value]) => {
            if (Array.isArray(value)) {
              // 数组参数使用重复键的方式：key=val1&key=val2
              value.forEach((item) => searchParams.append(key, String(item)))
            } else if (value !== undefined && value !== null) {
              searchParams.append(key, String(value))
            }
          })
          return searchParams.toString()
        },
      },
    })
    // 请求拦截
    this.instance.interceptors.request.use(
      async (config) => {
        const isSkipRetry = config.headers?.[OPTION_KEYS.SKIP_RETRY] === 'true'
        const isExcluded = EXCLUDED_URLS.includes(config.url || '')
        const accessToken = getAccessToken()

        // 只读模拟模式：在发送请求前拦截写操作（UX 层，后端也有独立拦截）
        const impersonationStore = useImpersonationStore()
        if (impersonationStore.isViewOnly) {
          const method = (config.method ?? '').toUpperCase()
          if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            return Promise.reject(new Error('只读模拟模式下不允许执行写操作'))
          }
        }

        // 跳过不需要 token 的请求
        if (isSkipRetry || isExcluded || !accessToken) {
          if (accessToken) config.headers.setAuthorization(`Bearer ${accessToken}`)
          return config
        }

        // 检查是否有待处理的 2FA 挑战
        // 如果有待处理的 2FA，不要尝试刷新 token（等待 2FA 完成后再刷新）
        const hasPending2FA = MyAxios.pendingTwoFactorRequests.length > 0
        if (hasPending2FA) {
          console.debug('[Request Interceptor] Pending 2FA requests exist, skipping token refresh')
          config.headers.setAuthorization(`Bearer ${accessToken}`)
          return config
        }

        // 检查是否需要刷新 token（正在刷新或 token 已过期）
        const needsRefresh = MyAxios.refreshTokenPromise || isTokenExpired({ bufferSeconds: 2 })

        if (needsRefresh) {
          try {
            const newToken = await MyAxios.getRefreshPromise()
            config.headers.setAuthorization(`Bearer ${newToken}`)
            return config
          } catch {}
        }

        config.headers.setAuthorization(`Bearer ${accessToken}`)
        return config
      },
      (error) => {
        // Handle request error
        return Promise.reject(error)
      },
    )
    // 响应拦截
    this.instance.interceptors.response.use(
      (response) => {
        // 检查自定义响应码
        const codeMsg = getCustomCodeText(response.data?.code)
        if (codeMsg) customCodeBus.emit(codeMsg as keyof typeof CustomCode, response.data)

        // 检查 HTTP 状态码
        const statusMsg = getHttpStatusText(response.status)
        if (statusMsg) webEventBus.emit(statusMsg as keyof typeof HttpStatusCode, response)

        // 特殊处理：2FA 要求不应该被当作错误，而是正常的业务流程
        if (response.data?.code === CustomCode.TWO_FACTOR_REQUIRED) {
          const originalRequest = response.config as RetryAxiosRequest

          console.log('[2FA Response] Received TWO_FACTOR_REQUIRED response:', {
            url: originalRequest.url,
            method: originalRequest.method,
            isRetry: originalRequest._twoFactorRetry,
            retryCount: originalRequest._twoFactorRetryCount || 0,
          })

          // 如果是重试请求且已经重试过一次，说明这是一个 alwaysRequire 的接口
          // 不再保存到队列，直接返回错误
          if (originalRequest._twoFactorRetry && (originalRequest._twoFactorRetryCount || 0) >= 1) {
            console.warn(
              '[2FA Response] Retry request still requires 2FA after verification - this is an alwaysRequire endpoint',
            )
            // 清空队列，避免无限循环
            MyAxios.clearPendingTwoFactorRequests()
            // 返回错误，让业务层处理
            return Promise.reject(new Error('此操作需要每次验证，请重新执行操作'))
          }

          // 如果不是重试请求，保存到队列
          if (!originalRequest._twoFactorRetry) {
            MyAxios.savePendingTwoFactorRequest(originalRequest)
          }

          // 返回 2FA 响应数据（让业务层处理跳转到 2FA 页面）
          return response.data
        }

        // 如果code不为0，抛出错误
        if (response.data?.code !== undefined && response.data.code !== CustomCode.OK) {
          return Promise.reject(new Error(response.data.message || 'Request failed'))
        }

        return response.data
      },
      async (error: AxiosError) => {
        const originalRequest = error.config as RetryAxiosRequest
        const responseData = error.response?.data as any

        if (
          originalRequest &&
          !originalRequest._replaySigningRetry &&
          MyAxios.hasReplayProtectionHeaders(originalRequest.headers) &&
          MyAxios.isReplaySigningSessionRecoverableFailure(responseData)
        ) {
          try {
            return await this.retryWithFreshReplaySigningSession(originalRequest)
          } catch (replayRecoveryError) {
            console.warn(
              'Failed to recover replay signing session automatically:',
              replayRecoveryError,
            )
          }
        }

        // 特殊处理：2FA 要求（可能以 401 状态码返回）
        if (responseData?.code === CustomCode.TWO_FACTOR_REQUIRED) {
          console.log('[2FA Error] Received TWO_FACTOR_REQUIRED in error handler:', {
            status: error.response?.status,
            url: originalRequest.url,
            method: originalRequest.method,
            isRetry: originalRequest._twoFactorRetry,
            retryCount: originalRequest._twoFactorRetryCount || 0,
          })

          // 如果是重试请求且已经重试过一次，说明这是一个 alwaysRequire 的接口
          if (originalRequest._twoFactorRetry && (originalRequest._twoFactorRetryCount || 0) >= 1) {
            console.warn(
              '[2FA Error] Retry request still requires 2FA after verification - this is an alwaysRequire endpoint',
            )
            MyAxios.clearPendingTwoFactorRequests()
            return Promise.reject(new Error('此操作需要每次验证，请重新执行操作'))
          }

          // 如果不是重试请求，保存到队列
          if (!originalRequest._twoFactorRetry) {
            MyAxios.savePendingTwoFactorRequest(originalRequest)
          }

          // 触发 2FA 事件
          const codeMsg = getCustomCodeText(responseData.code)
          if (codeMsg) customCodeBus.emit(codeMsg as keyof typeof CustomCode, responseData)

          // 返回 2FA 响应数据（不要抛出错误）
          return responseData
        }

        // 处理 401 未授权错误，尝试刷新 token
        const isUnauthorized = error.response?.status === HttpStatusCode.Unauthorized
        const isExcluded = EXCLUDED_URLS.includes(error.config?.url || '')
        const isRetryAttempted = originalRequest._retry === true
        const isSkipRetry = error.config?.headers?.[OPTION_KEYS.SKIP_RETRY] === 'true'
        const responseCustomCode = (error.response?.data as any)?.code
        const isTwoFactorBusinessFailure =
          typeof responseCustomCode === 'number' &&
          NO_REFRESH_RETRY_CUSTOM_CODES.has(responseCustomCode)

        if (
          isUnauthorized &&
          !isExcluded &&
          !isRetryAttempted &&
          !isSkipRetry &&
          !isTwoFactorBusinessFailure
        ) {
          originalRequest._retry = true

          try {
            // 使用统一的刷新方法（保证只刷新一次）
            const newToken = await MyAxios.getRefreshPromise()

            // 更新原始请求头
            if (!originalRequest.headers) originalRequest.headers = {} as any

            originalRequest.headers.Authorization = `Bearer ${newToken}`

            // 重试原始请求
            return this.instance.request(originalRequest)
          } catch (refreshError) {
            // 触发未授权事件，可能需要跳转到登录页
            const codeMsg = getHttpStatusText(HttpStatusCode.Unauthorized)
            if (codeMsg) webEventBus.emit(codeMsg as keyof typeof HttpStatusCode, error)

            return Promise.reject(refreshError)
          }
        }

        // 处理其他错误
        const customCode = getCustomCodeText((error.response?.data as any)?.code)
        if (customCode)
          customCodeBus.emit(customCode as keyof typeof CustomCode, error.response?.data)

        const codeMsg = getHttpStatusText(error.status || 0)
        if (codeMsg) webEventBus.emit(codeMsg as keyof typeof HttpStatusCode, error)

        const responseMessage =
          typeof responseData?.message === 'string' && responseData.message.trim()
            ? responseData.message
            : error.message || 'Request failed'

        if (responseData && typeof responseData === 'object') {
          return responseData
        }

        return Promise.reject(new Error(responseMessage))
      },
    )
  }

  async _generateHeaderOptions(
    endpointInfo: { endpoint?: AnyEndpointDescriptor; body: any; finalUrl: string },
    options?: RequestOptions,
  ): Promise<Record<string, string>> {
    const { endpoint, body, finalUrl } = endpointInfo
    const isWriteMethod = Boolean(
      endpoint && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(endpoint.method),
    )
    const needsReplayProtection = Boolean(
      options?.enableReplayProtection || endpoint?.replayProtected || isWriteMethod,
    )

    const signingMaterial = needsReplayProtection
      ? await ReplaySigningService.getInstance().ensureSigningMaterial()
      : null

    const replayProtectionHeader =
      needsReplayProtection && finalUrl && signingMaterial
        ? ReplayProtection.generateHeaders(body, finalUrl, signingMaterial)
        : {}

    const clientFingerprint = getOrCreateClientFingerprint()

    return {
      [OPTION_KEYS.SKIP_RETRY]: ifElseDefault(options?.retry, 'false', 'true', 'false'),
      ...getLocaleHeaders(),
      ...(clientFingerprint ? { 'X-Client-Fingerprint': clientFingerprint } : {}),
      ...(options?.customHeaders || {}),
      ...replayProtectionHeader,
    }
  }

  getFinalUrl(endpoint: AnyEndpointDescriptor, path?: Record<string, any>): string {
    return endpoint.url.replace(/{(\w+)}/g, (_, key) => {
      if (!PATH_PARAM_NAME_PATTERN.test(key)) {
        throw new Error(`Invalid path parameter name: ${key}`)
      }

      if (!path || typeof path !== 'object' || path === null || !hasOwnPathParam(path, key)) {
        throw new Error(`Missing path parameter: ${key}`)
      }

      const value = path[key as keyof typeof path]
      return encodePathParam(value, key)
    })
  }

  async post<
    ENDPOINT extends EndpointWithMethod<'POST'>,
    PATH = ENDPOINT['path'],
    BODY = ENDPOINT['body'],
  >(
    endpoint: ENDPOINT,
    reqOpt: WithoutNever<{ path: PATH; body: BODY }>,
    options?: RequestOptions,
  ): PromDeResp<ENDPOINT['response']> {
    const mergedOptions = MyAxios.getMergedOptions(options)
    const requestWrapper = mergedOptions.skipProgressBar
      ? (p: any) => p
      : mergedOptions.requestWrapper
    const path = 'path' in reqOpt ? reqOpt.path : undefined
    const body = 'body' in reqOpt ? reqOpt.body : undefined
    const finalUrl = this.getFinalUrl(endpoint, path as Record<string, any>)

    const headers = await this._generateHeaderOptions({ endpoint, body, finalUrl }, options)
    return await requestWrapper(
      this.instance.post(finalUrl, body, {
        headers,
        signal: options?.signal,
      }),
    )
  }

  async get<
    ENDPOINT extends EndpointWithMethod<'GET'>,
    PATH = ENDPOINT['path'],
    PARAM = ENDPOINT['query'],
  >(
    endpoint: ENDPOINT,
    reqOpt?: WithoutNever<{ path: PATH; params: PARAM }>,
    options?: RequestOptions,
  ): PromDeResp<ENDPOINT['response']> {
    const mergedOptions = MyAxios.getMergedOptions(options)
    const requestWrapper = mergedOptions.skipProgressBar
      ? (p: any) => p
      : mergedOptions.requestWrapper
    const path = reqOpt && 'path' in reqOpt ? reqOpt.path : undefined
    const params = reqOpt && 'params' in reqOpt ? reqOpt.params : undefined

    const finalUrl = this.getFinalUrl(endpoint, path as Record<string, any>)

    if (options?.directRequest) {
      const requestUrl = this.buildRequestUrl(
        finalUrl,
        params as Record<string, string | number | boolean | null | undefined> | undefined,
        options.directCacheBust,
      )
      const response = await fetch(requestUrl, {
        method: 'GET',
        cache: 'no-store',
        credentials: options.directCredentials,
        signal: options.signal,
        headers: {
          ...getLocaleHeaders(),
          ...(options?.customHeaders || {}),
        },
      })

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`)
      }

      return (await response.json()) as PromDeResp<ENDPOINT['response']>
    }

    const headers = await this._generateHeaderOptions({ endpoint, body: null, finalUrl }, options)

    return await requestWrapper(
      this.instance.get(finalUrl, {
        params: params,
        headers: headers,
        signal: options?.signal,
      }),
    )
  }

  async delete<
    ENDPOINT extends EndpointWithMethod<'DELETE'>,
    PATH = ENDPOINT['path'],
    PARAM = ENDPOINT['query'],
  >(
    endpoint: ENDPOINT,
    reqOpt: WithoutNever<{ path: PATH; params: PARAM }>,
    options?: RequestOptions,
  ): PromDeResp<ENDPOINT['response']> {
    const mergedOptions = MyAxios.getMergedOptions(options)
    const requestWrapper = mergedOptions.skipProgressBar
      ? (p: any) => p
      : mergedOptions.requestWrapper
    const path = 'path' in reqOpt ? reqOpt.path : undefined
    const params = 'params' in reqOpt ? reqOpt.params : undefined

    const finalUrl = this.getFinalUrl(endpoint, path as Record<string, any>)

    return await requestWrapper(
      this.instance.delete(finalUrl, {
        params: params,
        headers: await this._generateHeaderOptions({ endpoint, body: null, finalUrl }, options),
        signal: options?.signal,
      }),
    )
  }

  async put<
    ENDPOINT extends EndpointWithMethod<'PUT'>,
    PATH = ENDPOINT['path'],
    BODY = ENDPOINT['body'],
  >(
    endpoint: ENDPOINT,
    reqOpt: WithoutNever<{ path: PATH; body: BODY }>,
    options?: RequestOptions,
  ): PromDeResp<ENDPOINT['response']> {
    const mergedOptions = MyAxios.getMergedOptions(options)
    const requestWrapper = mergedOptions.skipProgressBar
      ? (p: any) => p
      : mergedOptions.requestWrapper
    const path = 'path' in reqOpt ? reqOpt.path : undefined
    const body = 'body' in reqOpt ? reqOpt.body : undefined

    const finalUrl = this.getFinalUrl(endpoint, path as Record<string, any>)

    return await requestWrapper(
      this.instance.put(finalUrl, body, {
        headers: await this._generateHeaderOptions({ endpoint, body, finalUrl }, options),
        signal: options?.signal,
      }),
    )
  }

  async patch<
    ENDPOINT extends EndpointWithMethod<'PATCH'>,
    PATH = ENDPOINT['path'],
    BODY = ENDPOINT['body'],
  >(
    endpoint: ENDPOINT,
    reqOpt: WithoutNever<{ path: PATH; body: BODY }>,
    options?: RequestOptions,
  ): PromDeResp<ENDPOINT['response']> {
    const mergedOptions = MyAxios.getMergedOptions(options)
    const requestWrapper = mergedOptions.skipProgressBar
      ? (p: any) => p
      : mergedOptions.requestWrapper
    const path = 'path' in reqOpt ? reqOpt.path : undefined
    const body = 'body' in reqOpt ? reqOpt.body : undefined

    const finalUrl = this.getFinalUrl(endpoint, path as Record<string, any>)

    return await requestWrapper(
      this.instance.patch(finalUrl, body, {
        headers: await this._generateHeaderOptions({ endpoint, body, finalUrl }, options),
        signal: options?.signal,
      }),
    )
  }

  public getAxios(): Axios {
    return this.instance
  }

  /**
   * Some endpoints intentionally use fetch (for example SSE). Keep their URL,
   * locale/fingerprint and replay-protection headers identical to regular API calls.
   */
  async prepareStreamingRequest(path: string, body: unknown): Promise<{ url: string; headers: Record<string, string> }> {
    return {
      url: this.buildRequestUrl(path),
      headers: await this._generateHeaderOptions(
        { endpoint: undefined, body, finalUrl: path },
        { enableReplayProtection: true, skipProgressBar: true },
      ),
    }
  }

  private buildRequestUrl(
    url: string,
    params?: Record<string, string | number | boolean | null | undefined>,
    cacheBust: boolean = false,
  ): string {
    const isAbsolute = /^https?:\/\//.test(url)
    const finalUrl = new URL(url, isAbsolute ? undefined : this.baseURL)

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          finalUrl.searchParams.append(key, String(value))
        }
      })
    }

    if (cacheBust) {
      finalUrl.searchParams.append('t', Date.now().toString())
    }

    return finalUrl.toString()
  }

  static setDefaultOptions(options: RequestOptions) {
    MyAxios._defaultOptions = MyAxios.getMergedOptions(options)
  }

  static getMergedOptions(options?: RequestOptions): FullRequestOptions {
    return { ...MyAxios._defaultOptions, ...options }
  }
}

export const useRequestStore = defineStore('Request', () => {
  const instance = new MyAxios(import.meta.env.VITE_BACKEND_URL, 60000)
  const createAxios = (baseURL: string) => {
    const instance = new MyAxios(baseURL, 60000)

    return instance
  }

  const getAxios = () => instance

  // 2FA 验证成功后重试所有原始请求
  const retryPendingTwoFactorRequests = async () => {
    return instance.retryPendingTwoFactorRequests()
  }

  const prepareStreamingRequest = (path: string, body: unknown) => instance.prepareStreamingRequest(path, body)

  return { createAxios, getAxios, prepareStreamingRequest, retryPendingTwoFactorRequests }
})

export type RequestStore = ReturnType<typeof useRequestStore>
export type MyAxiosInstance = InstanceType<typeof MyAxios>
export { MyAxios }
