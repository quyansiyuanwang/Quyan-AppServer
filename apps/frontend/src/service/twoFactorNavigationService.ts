import { CustomCode } from '@/constant/custom-code'
import StorageKey from '@/constant/storagekey'
import { TypedSessionStorage } from '@/utils/typedSessionStorage'

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

let navigationPromise: Promise<void> | null = null

export const navigateToTwoFactorVerification = (response: unknown): void => {
  const data = getTwoFactorResponseData(response)
  const challengeToken = getTwoFactorChallengeToken(response)
  if (!isTwoFactorRequiredResponse(response) || !data || !challengeToken) {
    if (isTwoFactorRequiredResponse(response) && !challengeToken)
      console.warn('[2FA] Required response did not include a challenge token')
    return
  }

  const redirect = typeof data.redirect === 'string' ? data.redirect : getRedirect()
  TypedSessionStorage.setItem(
    StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE,
    JSON.stringify({ challengeToken, redirect, createdAt: Date.now() }),
  )

  const purpose = ['login', 'disable2fa', 'stepup'].includes(String(data.purpose))
    ? String(data.purpose)
    : 'stepup'
  const method = ['code', 'email', 'passkey'].includes(String(data.method))
    ? String(data.method)
    : 'code'

  if (navigationPromise) return
  navigationPromise = import('@/router')
    .then(({ default: router }) =>
      router.push({ name: 'authVerification', query: { purpose, method } }),
    )
    .catch((error) => console.warn('[2FA] Failed to navigate to verification page:', error))
    .then(() => undefined)
    .finally(() => {
      navigationPromise = null
    })
}
