import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import StorageKey from '@/constant/storagekey'

const DEFAULT_STORAGE_SCOPE = 'guest'
const USER_SCOPE_PREFIX = 'user:'

interface TokenPayload<T = Record<string, unknown>> {
  data: T
  expiration: number
}

interface JWTClaims {
  data: string
  type: string
}

const normalizeUserId = (userId?: string | null): string | null => {
  if (!userId) return null
  const normalized = String(userId).trim()
  return normalized || null
}

const buildUserStorageScope = (userId: string): string => `${USER_SCOPE_PREFIX}${userId}`

const parseTokenPayload = <T = Record<string, unknown>>(token: string): TokenPayload<T> | null => {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[1]) return null

    const payload = parts[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((char) => '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    )

    const claims: JWTClaims = JSON.parse(jsonPayload)
    return JSON.parse(claims.data) as TokenPayload<T>
  } catch {
    return null
  }
}

export const getCurrentStorageScope = (): string => {
  const currentScope = TypedLocalStorage.getItem(StorageKey.Scope.CURRENT)
  return currentScope?.trim() || DEFAULT_STORAGE_SCOPE
}

export const setCurrentStorageScope = (scope?: string | null): string => {
  const normalized = scope?.trim() || DEFAULT_STORAGE_SCOPE
  TypedLocalStorage.setItem(StorageKey.Scope.CURRENT, normalized)
  return normalized
}

export const resetCurrentStorageScope = (): string => setCurrentStorageScope(DEFAULT_STORAGE_SCOPE)

export const setCurrentStorageScopeForUserId = (userId?: string | null): string => {
  const normalizedUserId = normalizeUserId(userId)
  return normalizedUserId
    ? setCurrentStorageScope(buildUserStorageScope(normalizedUserId))
    : resetCurrentStorageScope()
}

export const getScopedStorageKey = (baseKey: string, scope: string = getCurrentStorageScope()) =>
  `${baseKey}::${scope}`

export const getUserIdFromToken = (token?: string | null): string | null => {
  if (!token) return null
  const payload = parseTokenPayload<{ userId?: string }>(token)
  return normalizeUserId(payload?.data?.userId)
}

/** The backend rotates this value whenever a user's authorization changes. */
export const getUserUpdatedAtFromToken = (token?: string | null): string | null => {
  if (!token) return null
  const payload = parseTokenPayload<{ updatedAt?: string }>(token)
  const updatedAt = payload?.data?.updatedAt
  return typeof updatedAt === 'string' && updatedAt.trim() ? updatedAt : null
}

export const syncCurrentStorageScopeFromToken = (token?: string | null): string => {
  const userId = getUserIdFromToken(token)
  return userId ? setCurrentStorageScopeForUserId(userId) : getCurrentStorageScope()
}
