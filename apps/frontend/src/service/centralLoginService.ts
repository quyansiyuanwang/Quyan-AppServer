import { createAuthControllerApi } from '@/client/services/auth-controller.gen'
import { CustomCode } from '@/constant/custom-code'
import {
  isKnownSiteProfile,
  getSiteProfileForEnvironment,
  resolveCurrentSiteProfile,
  type SiteProfile,
} from '@/config/site-registry'
import { useRequestStore } from '@/stores/request'
import { cache } from '@/utils/common'
import { toServiceError } from '@/utils/error-utils'
import { assignDocument, replaceDocument } from '@/service/navigationService'

const getAuthControllerApi = cache(() => createAuthControllerApi(useRequestStore().getAxios()))

const getCurrentRelativeLocation = (): string =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`

export const getCentralAuthUrl = (profile: SiteProfile, path: string, flowId: string): string => {
  const url = new URL(path, profile.authOrigin)
  url.searchParams.set('flowId', flowId)
  return url.toString()
}

export const getCentralLoginUrl = (profile: SiteProfile, flowId: string): string =>
  getCentralAuthUrl(profile, '/login', flowId)

/**
 * Builds the deterministic authentication entry used when the central-login
 * flow service is temporarily unavailable. The fallback intentionally omits a
 * cross-origin redirect parameter; only a server-created flow can safely
 * resume a business URL after authentication.
 */
export const getCentralLoginFallbackUrl = (profile: SiteProfile): string =>
  new URL('/login', profile.authOrigin).toString()

export const createCentralLoginFlow = async (
  returnPath = getCurrentRelativeLocation(),
): Promise<string> => {
  const profile = resolveCurrentSiteProfile()
  if (!isKnownSiteProfile(profile) || profile.id === 'identity')
    throw new Error('Central login can only be started from a registered business profile')

  const returnTo = new URL(returnPath, profile.canonicalOrigin)
  if (returnTo.origin !== profile.canonicalOrigin)
    throw new Error('Central login return path must stay on this site')

  const result = await getAuthControllerApi().createCentralLoginFlow({
    body: { returnTo: returnTo.toString() },
  })
  if (!result.data?.flowId) throw toServiceError(result, 'Failed to create central login flow')
  return result.data.flowId
}

export const redirectToCentralLogin = async (returnPath?: string): Promise<void> => {
  const profile = resolveCurrentSiteProfile()
  if (!isKnownSiteProfile(profile) || profile.id === 'identity') return

  const flowId = await createCentralLoginFlow(returnPath)
  assignDocument(getCentralLoginUrl(profile, flowId))
}

export const redirectToCentralPasskeyManagement = async (): Promise<void> => {
  const profile = resolveCurrentSiteProfile()
  if (!isKnownSiteProfile(profile) || profile.id !== 'account')
    throw new Error('Passkey registration must start from the account profile')

  const result = await getAuthControllerApi().createAuthenticatedCentralLoginFlow({
    body: { returnTo: new URL('/settings/security', profile.canonicalOrigin).toString() },
  })
  if (!result.data?.flowId)
    throw toServiceError(result, 'Failed to create passkey registration flow')
  assignDocument(getCentralAuthUrl(profile, '/auth/passkeys', result.data.flowId))
}

export const redirectToCentralExternalBinding = async (
  provider: 'github' | 'wechat-open' | 'wechat-web',
): Promise<void> => {
  const profile = resolveCurrentSiteProfile()
  if (!isKnownSiteProfile(profile) || profile.id !== 'account')
    throw new Error('External account binding must start from the account profile')

  const result = await getAuthControllerApi().createAuthenticatedCentralLoginFlow({
    body: { returnTo: new URL('/settings/security', profile.canonicalOrigin).toString() },
  })
  if (!result.data?.flowId)
    throw toServiceError(result, 'Failed to create external account binding flow')

  const target = new URL('/auth/external/bind', profile.authOrigin)
  target.searchParams.set('provider', provider)
  target.searchParams.set('flowId', result.data.flowId)
  assignDocument(target.toString())
}

export const consumeCentralLoginFlow = async (flowId: string): Promise<string> => {
  const result = await getAuthControllerApi().consumeCentralLoginFlow({ body: { flowId } })
  if (!result.data?.returnTo) throw toServiceError(result, 'Failed to resume central login flow')
  return result.data.returnTo
}

const CENTRAL_LOGIN_FLOW_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const removeCentralLoginFlowId = (location: string): string => {
  const url = new URL(location, 'http://localhost')
  url.searchParams.delete('flowId')
  return `${url.pathname}${url.search}${url.hash}`
}

const clearCentralLoginFlowIdFromUrl = (): void => {
  if (typeof window === 'undefined') return

  const currentUrl = new URL(window.location.href)
  if (!currentUrl.searchParams.has('flowId')) return

  const relativeLocation = removeCentralLoginFlowId(currentUrl.href)
  window.history.replaceState(window.history.state, '', relativeLocation)
}

const isUnavailableCentralLoginFlow = (error: unknown): boolean => {
  const serviceError = error as {
    code?: unknown
    response?: { status?: unknown }
  }
  const status = serviceError.response?.status
  if (status === 400 || status === 403 || status === 404 || status === 409) return true

  return (
    serviceError.code === CustomCode.NOT_FOUND ||
    serviceError.code === CustomCode.VALIDATION_FAILED ||
    serviceError.code === CustomCode.PERMISSION_DENIED
  )
}

export const completeCentralLogin = async (flowId: unknown): Promise<boolean> => {
  if (typeof flowId !== 'string' || !flowId) {
    clearCentralLoginFlowIdFromUrl()
    return false
  }
  if (!CENTRAL_LOGIN_FLOW_ID_PATTERN.test(flowId)) {
    clearCentralLoginFlowIdFromUrl()
    return false
  }

  try {
    const returnTo = await consumeCentralLoginFlow(flowId)
    replaceDocument(returnTo)
    return true
  } catch (error) {
    if (!isUnavailableCentralLoginFlow(error)) throw error

    // A flow is single-use and short-lived. Remove stale state so the normal
    // login flow can continue instead of repeatedly submitting the same ID.
    clearCentralLoginFlowIdFromUrl()
    return false
  }
}

export const getDefaultAccountDestination = (): string => {
  const currentProfile = resolveCurrentSiteProfile()
  if (!isKnownSiteProfile(currentProfile)) throw new Error('Current site profile is not registered')

  const accountProfile = getSiteProfileForEnvironment('account', currentProfile)
  if (!accountProfile) throw new Error('Account profile is not registered')
  return new URL(accountProfile.defaultPath, accountProfile.canonicalOrigin).toString()
}
