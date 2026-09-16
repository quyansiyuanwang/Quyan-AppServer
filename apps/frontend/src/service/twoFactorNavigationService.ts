import { CustomCode } from '@/constant/custom-code'
import StorageKey from '@/constant/storagekey'
import { TypedSessionStorage } from '@/utils/typedSessionStorage'

export class TwoFactorRedirectError extends Error {
  readonly code = CustomCode.TWO_FACTOR_REQUIRED
  readonly data?: TwoFactorResponseData

  constructor(message: string, data?: TwoFactorResponseData) {
    super(message)
    this.name = 'TwoFactorRedirectError'
    this.data = data
  }
}

export const isTwoFactorRedirectError = (error: unknown): error is TwoFactorRedirectError =>
  error instanceof TwoFactorRedirectError ||
  Boolean(
    error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'TwoFactorRedirectError',
  )

export interface TwoFactorResponseData {
  challengeToken?: unknown
  method?: unknown
  purpose?: unknown
  redirect?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const findChallengeData = (value: unknown, depth = 0): TwoFactorResponseData | undefined => {
  if (depth > 6 || !isRecord(value)) return undefined
  if (typeof value.challengeToken === 'string' && value.challengeToken.trim())
    return value as TwoFactorResponseData
  for (const key of ['data', 'response']) {
    const nested = findChallengeData(value[key], depth + 1)
    if (nested) return nested
  }
  return undefined
}

const findResponseCode = (value: unknown, depth = 0): number | undefined => {
  if (depth > 6 || !isRecord(value)) return undefined
  if (value.code !== undefined) {
    const code = Number(value.code)
    if (Number.isFinite(code)) return code
  }
  for (const key of ['data', 'response']) {
    const nested = findResponseCode(value[key], depth + 1)
    if (nested !== undefined) return nested
  }
  return undefined
}

export const getTwoFactorResponseData = (response: unknown): TwoFactorResponseData | undefined =>
  findChallengeData(response)

export const isTwoFactorRequiredResponse = (response: unknown): boolean =>
  findResponseCode(response) === CustomCode.TWO_FACTOR_REQUIRED

export const getTwoFactorChallengeToken = (response: unknown): string | undefined => {
  const token = getTwoFactorResponseData(response)?.challengeToken
  return typeof token === 'string' && token.trim() ? token.trim() : undefined
}

const getRedirect = (): string | undefined => {
  if (typeof window === 'undefined') return undefined
  const path = `${window.location.pathname}${window.location.search}`
  return path.startsWith('/') && !path.startsWith('/auth/verify') ? path : undefined
}

const getCurrentQueryValue = (name: string): string | undefined => {
  if (typeof window === 'undefined') return undefined
  const value = new URLSearchParams(window.location.search).get(name)?.trim()
  return value || undefined
}

const getCurrentAuthEntry = (): 'login' | 'register' => {
  if (typeof window === 'undefined') return 'login'
  return window.location.pathname.endsWith('/register') ||
    getCurrentQueryValue('mode') === 'register'
    ? 'register'
    : 'login'
}

let navigationPromise: Promise<boolean> | null = null

/**
 * Persist the challenge and finish routing to the verification view before the
 * intercepted request is handed back to its caller.  Returning the navigation
 * promise is important: callers must not surface the 2FA response as an
 * ordinary request error while the application is still on the protected page.
 */
export const navigateToTwoFactorVerification = (response: unknown): Promise<boolean> => {
  const data = getTwoFactorResponseData(response)
  const challengeToken = getTwoFactorChallengeToken(response)
  if (!isTwoFactorRequiredResponse(response) || !data || !challengeToken) {
    if (isTwoFactorRequiredResponse(response) && !challengeToken)
      console.warn('[2FA] Required response did not include a challenge token')
    return Promise.resolve(false)
  }

  if (navigationPromise) return navigationPromise

  const redirect = typeof data.redirect === 'string' ? data.redirect : getRedirect()
  const authEntry = getCurrentAuthEntry()
  TypedSessionStorage.setItem(
    StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE,
    JSON.stringify({ challengeToken, redirect, authEntry, createdAt: Date.now() }),
  )

  const purpose = ['login', 'disable2fa', 'stepup'].includes(String(data.purpose))
    ? String(data.purpose)
    : 'stepup'
  const method = ['code', 'email', 'passkey'].includes(String(data.method))
    ? String(data.method)
    : 'code'

  const navigation = import('@/router')
    .then(async ({ default: router }) => {
      const flowId = purpose === 'login' ? getCurrentQueryValue('flowId') : undefined
      await router.push({
        name: 'authVerification',
        query: {
          purpose,
          method,
          ...(flowId ? { flowId } : {}),
          ...(authEntry === 'register' ? { authEntry } : {}),
        },
      })
      return true
    })
    .catch((error) => {
      console.warn('[2FA] Failed to navigate to verification page:', error)
      return false
    })

  navigationPromise = navigation.finally(() => {
    navigationPromise = null
  })
  return navigationPromise
}
