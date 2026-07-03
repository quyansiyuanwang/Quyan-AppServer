/**
 * 通用 fetch-based HTTP 客户端
 * 特性：超时控制、自动重试（指数退避）、JSON 序列化保护、keepalive 支持
 *
 * 用法：
 *   const client = new HttpClient({ baseUrl: 'http://localhost:10001' })
 *   await client.post('/v1/track/batch', { events })
 *   client.postKeepalive('/v1/track/batch', { events }) // fire-and-forget
 */
export interface RetryConfig {
  /** 额外重试次数（不包含首次请求），默认 2 */
  maxRetries: number
  /** 基础延迟毫秒数，每次重试翻倍，默认 1000 */
  baseDelay: number
}

export interface HttpClientConfig {
  baseUrl: string
  /** 默认请求超时毫秒，默认 3000 */
  timeout?: number
  /** 默认重试策略，传 false 禁用重试 */
  retry?: RetryConfig | false
  /** 默认请求头 */
  headers?: Record<string, string>
}

export interface HttpClientOptions {
  timeout?: number
  retry?: RetryConfig | false
  headers?: Record<string, string>
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string,
    public body?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

const defaultRetry: RetryConfig = { maxRetries: 2, baseDelay: 1000 }

export class HttpClient {
  private baseUrl: string
  private defaultTimeout: number
  private defaultRetry: RetryConfig | false
  private defaultHeaders: Record<string, string>
  /** 连续失败计数器（所有请求汇总），用于抑制重试风暴 */
  private consecutiveFailures = 0

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.defaultTimeout = config.timeout ?? 3000
    this.defaultRetry = config.retry ?? defaultRetry
    this.defaultHeaders = { 'Content-Type': 'application/json', ...config.headers }
  }

  /** 发送 POST 请求，自动 JSON 序列化，带超时+重试 */
  async post<T = unknown>(path: string, body: unknown, options?: HttpClientOptions): Promise<T> {
    return this.request<T>('POST', path, body, options)
  }

  /** 发送 GET 请求 */
  async get<T = unknown>(path: string, options?: HttpClientOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options)
  }

  /** POST + keepalive（fire-and-forget，无响应、无重试） */
  postKeepalive(path: string, body: unknown): void {
    const payload = this.safeSerialize(body)
    if (!payload) return

    try {
      fetch(this.fullUrl(path), {
        method: 'POST',
        headers: this.mergeHeaders({}),
        body: payload,
        keepalive: true,
      }).catch(() => {
        /* fire-and-forget */
      })
    } catch {
      /* 同上 */
    }
  }

  // ── 内部实现 ──

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: HttpClientOptions,
  ): Promise<T> {
    const timeout = options?.timeout ?? this.defaultTimeout
    const retry = options?.retry ?? this.defaultRetry

    const bodyText = body !== undefined ? this.safeSerialize(body) : undefined
    if (body !== undefined && bodyText === null) {
      throw new Error(`HttpClient: Failed to serialize request body for ${method} ${path}`)
    }

    if (retry === false) {
      return this.executeSingle<T>(method, path, bodyText as string | undefined, timeout)
    }

    return this.executeWithRetry<T>(method, path, bodyText as string | undefined, timeout, retry)
  }

  private async executeSingle<T>(
    method: string,
    path: string,
    body: string | undefined,
    timeout: number,
  ): Promise<T> {
    const response = await this.fetchWithTimeout(
      this.fullUrl(path),
      {
        method,
        headers: this.mergeHeaders({}),
        body,
      },
      timeout,
    )

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new HttpError(
        `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
        response.status,
        response.statusText,
        text,
      )
    }

    return response.json().catch(() => ({}) as T)
  }

  private async executeWithRetry<T>(
    method: string,
    path: string,
    body: string | undefined,
    timeout: number,
    retry: RetryConfig,
  ): Promise<T> {
    let lastError: unknown
    let retried = false

    for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
      if (attempt > 0) {
        retried = true
        const delay = retry.baseDelay * Math.pow(2, attempt - 1) + Math.random() * 200
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      try {
        const result = await this.executeSingle<T>(method, path, body, timeout)
        this.consecutiveFailures = 0
        return result
      } catch (err) {
        lastError = err
        this.consecutiveFailures++

        if (!this.isRetryable(err)) break
        if (this.consecutiveFailures >= 20) break
      }
    }

    const label = `${method} ${path}`
    const msg = retried
      ? `HttpClient: ${label} failed after ${retry.maxRetries + 1} attempts`
      : `HttpClient: ${label} failed`
    throw lastError instanceof Error ? new Error(`${msg}: ${lastError.message}`) : new Error(msg)
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof TypeError) return true
    if (err instanceof DOMException) return true
    if (err instanceof HttpError && (err.status >= 500 || err.status === 429)) return true
    return false
  }

  private fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    return fetch(url, { ...options, signal: controller.signal }).finally(() => {
      clearTimeout(timer)
    })
  }

  private fullUrl(path: string): string {
    // 如果 path 已经是完整 URL，直接使用
    if (path.startsWith('http://') || path.startsWith('https://')) return path
    const normalized = path.startsWith('/') ? path : `/${path}`
    return `${this.baseUrl}${normalized}`
  }

  private safeSerialize(data: unknown): string | null {
    try {
      return JSON.stringify(data)
    } catch (err) {
      console.error('[HttpClient] JSON serialization failed:', err)
      return null
    }
  }

  private mergeHeaders(extra: Record<string, string>): Record<string, string> {
    return { ...this.defaultHeaders, ...extra }
  }
}
