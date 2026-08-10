import { createAuthControllerApi } from '@/client/services/auth-controller.gen'
import {
  isKnownSiteProfile,
  resolveCurrentSiteProfile,
  siteProfiles,
  type SiteProfile,
} from '@/config/site-registry'
import { useRequestStore } from '@/stores/request'
import { cache } from '@/utils/common'
import { toServiceError } from '@/utils/error-utils'

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
  window.location.assign(getCentralLoginUrl(profile, flowId))
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
  window.location.assign(getCentralAuthUrl(profile, '/auth/passkeys', result.data.flowId))
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
  window.location.assign(target.toString())
}

export const consumeCentralLoginFlow = async (flowId: string): Promise<string> => {
  const result = await getAuthControllerApi().consumeCentralLoginFlow({ body: { flowId } })
  if (!result.data?.returnTo) throw toServiceError(result, 'Failed to resume central login flow')
  return result.data.returnTo
}

export const completeCentralLogin = async (flowId: unknown): Promise<boolean> => {
  if (typeof flowId !== 'string' || !flowId) return false
  const returnTo = await consumeCentralLoginFlow(flowId)
  window.location.replace(returnTo)
  return true
}

export const getDefaultAccountDestination = (): string => {
  const currentProfile = resolveCurrentSiteProfile()
  const useLocalDomain = currentProfile.hostname.endsWith('.test')
  const accountProfile = siteProfiles.find(
    (profile) =>
      profile.id === 'account' && profile.hostname.endsWith(useLocalDomain ? '.test' : '.cn'),
  )
  if (!accountProfile) throw new Error('Account profile is not registered')
  return new URL(accountProfile.defaultPath, accountProfile.canonicalOrigin).toString()
}
