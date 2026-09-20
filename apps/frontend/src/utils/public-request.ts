/** Bootstrap-independent transport for public recovery requests. No auth refresh or storage reads. */
export const buildBackendUrl = (path: string, baseURL: string): string => {
  if (/^https?:\/\//.test(path)) return path
  const base = String(baseURL || '').trim()
  if (/^https?:\/\//.test(base)) return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  return new URL(
    `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`,
    window.location.origin,
  ).toString()
}

export const localeHeaders = (locale?: string): Record<string, string> =>
  locale === 'zh-CN' || locale === 'en' ? { 'X-Locale': locale } : {}

export async function publicRequest(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    body?: unknown
    locale?: string
    headers?: Record<string, string>
    timeoutMs: number
  },
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await fetch(buildBackendUrl(path, import.meta.env.VITE_BACKEND_URL), {
      method: options.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        ...localeHeaders(options.locale),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('Public request failed')
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}
