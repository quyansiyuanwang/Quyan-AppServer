import type { RouteLocationRaw } from 'vue-router'

const normalizeRedirect = (redirect?: string): string | undefined => {
  if (typeof redirect !== 'string') return undefined
  const normalized = redirect.trim()
  return normalized.startsWith('/') ? normalized : undefined
}

const normalizeComparablePath = (redirect?: string): string | undefined => {
  const normalized = normalizeRedirect(redirect)
  if (!normalized) return undefined

  try {
    const parsed = new URL(normalized, 'http://localhost')
    return parsed.pathname.replace(/\/+$/, '') || '/'
  } catch {
    const [pathOnly] = normalized.split(/[?#]/, 1)
    return pathOnly?.replace(/\/+$/, '') || '/'
  }
}

const normalizeBlockedPaths = (blockedPaths: string[] | undefined): string[] =>
  Array.isArray(blockedPaths) ? blockedPaths.filter((item) => typeof item === 'string') : []

export const getSafeAuthRedirect = (
  redirect: unknown,
  options?: {
    blockedExactPaths?: string[]
    blockedPrefixes?: string[]
  },
): string | undefined => {
  const normalized = normalizeRedirect(typeof redirect === 'string' ? redirect : undefined)
  if (!normalized) return undefined
  const comparablePath = normalizeComparablePath(normalized)

  const blockedExactPaths = normalizeBlockedPaths(options?.blockedExactPaths)
  const blockedPrefixes = normalizeBlockedPaths(options?.blockedPrefixes)

  if (comparablePath && blockedExactPaths.includes(comparablePath)) return undefined
  if (comparablePath && blockedPrefixes.some((prefix) => comparablePath.startsWith(prefix)))
    return undefined

  return normalized
}

export const getLoginRoute = (redirect?: string): RouteLocationRaw => {
  const safeRedirect = normalizeRedirect(redirect)
  return safeRedirect
    ? {
        name: 'login',
        query: { redirect: safeRedirect },
      }
    : { name: 'login' }
}

export const getRegisterRoute = (redirect?: string): RouteLocationRaw => {
  const safeRedirect = normalizeRedirect(redirect)
  return safeRedirect
    ? {
        name: 'register',
        query: { redirect: safeRedirect },
      }
    : { name: 'register' }
}

export const getForgotPasswordRoute = (redirect?: string): RouteLocationRaw => {
  const safeRedirect = normalizeRedirect(redirect)
  return safeRedirect
    ? {
        name: 'forgotPassword',
        query: { redirect: safeRedirect },
      }
    : { name: 'forgotPassword' }
}

export const getQrApprovalRoute = (sessionId: string, redirect?: string): RouteLocationRaw => {
  const safeRedirect = normalizeRedirect(redirect)
  return {
    path: '/auth/qr-approve',
    query: safeRedirect ? { sessionId, redirect: safeRedirect } : { sessionId },
  }
}

export const isQrApprovalRedirect = (redirect: unknown): redirect is string => {
  const normalized = normalizeRedirect(typeof redirect === 'string' ? redirect : undefined)
  if (!normalized) return false

  try {
    const parsed = new URL(normalized, 'http://localhost')
    return (
      parsed.pathname.replace(/\/+$/, '') === '/auth/qr-approve' &&
      parsed.searchParams.has('sessionId')
    )
  } catch {
    return false
  }
}
