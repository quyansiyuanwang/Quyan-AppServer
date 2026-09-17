import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import StorageKey from '@/constant/storagekey'
import { parseJWT } from '@/utils/jwt'

const DEFAULT_STORAGE_SCOPE = 'guest'
const USER_SCOPE_PREFIX = 'user:'

const normalizeUserId = (userId?: string | null): string | null => {
  if (!userId) return null
  const normalized = String(userId).trim()
  return normalized || null
}

const buildUserStorageScope = (userId: string): string => `${USER_SCOPE_PREFIX}${userId}`

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
  const userId = parseJWT(token)?.userId
  return typeof userId === 'string' ? normalizeUserId(userId) : null
}

/** The backend rotates this value whenever a user's authorization changes. */
export const getUserUpdatedAtFromToken = (token?: string | null): string | null => {
  if (!token) return null
  const updatedAt = parseJWT(token)?.updatedAt
  return typeof updatedAt === 'string' && updatedAt.trim() ? updatedAt : null
}

export const syncCurrentStorageScopeFromToken = (token?: string | null): string => {
  const userId = getUserIdFromToken(token)
  return userId ? setCurrentStorageScopeForUserId(userId) : getCurrentStorageScope()
}
