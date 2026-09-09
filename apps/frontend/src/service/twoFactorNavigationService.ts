import StorageKey from '@/constant/storagekey'
import { TypedSessionStorage } from '@/utils/typedSessionStorage'

interface TwoFactorResponseData {
  challengeToken?: unknown
  method?: unknown
  purpose?: unknown
  redirect?: unknown
}

const getResponseData = (response: unknown): TwoFactorResponseData | undefined => {
  if (!response || typeof response !== 'object') return undefined
  const candidate = response as {
    data?: TwoFactorResponseData
    response?: { data?: { data?: TwoFactorResponseData } }
  }
  return candidate.data || candidate.response?.data?.data
}

export const getTwoFactorChallengeToken = (response: unknown): string | undefined => {
  const token = getResponseData(response)?.challengeToken
  return typeof token === 'string' && token.trim() ? token.trim() : undefined
}

const getRedirect = (): string | undefined => {
  if (typeof window === 'undefined') return undefined
  const path = `${window.location.pathname}${window.location.search}`
  return path.startsWith('/') && !path.startsWith('/auth/verify') ? path : undefined
}

let navigationPromise: Promise<void> | null = null

export const navigateToTwoFactorVerification = (response: unknown): void => {
  const data = getResponseData(response)
  const challengeToken = getTwoFactorChallengeToken(response)
  if (!data || !challengeToken) return

  const redirect = typeof data.redirect === 'string' ? data.redirect : getRedirect()
  TypedSessionStorage.setItem(
    StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE,
    JSON.stringify({ challengeToken, redirect, createdAt: Date.now() }),
  )

  const purpose = ['login', 'disable2fa', 'stepup'].includes(String(data.purpose))
    ? String(data.purpose)
    : 'stepup'
  const method = data.method === 'email' ? 'email' : 'code'

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
