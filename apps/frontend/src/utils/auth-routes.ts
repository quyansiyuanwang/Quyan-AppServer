import type { RouteLocationRaw } from 'vue-router'

const normalizeRedirect = (redirect?: string): string | undefined => {
  if (typeof redirect !== 'string') return undefined
  const normalized = redirect.trim()
  return normalized.startsWith('/') ? normalized : undefined
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

  const blockedExactPaths = normalizeBlockedPaths(options?.blockedExactPaths)
  const blockedPrefixes = normalizeBlockedPaths(options?.blockedPrefixes)

  if (blockedExactPaths.includes(normalized)) return undefined
  if (blockedPrefixes.some((prefix) => normalized.startsWith(prefix))) return undefined

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
