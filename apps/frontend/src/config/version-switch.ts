import { resolveLegacyRoutePath } from '@/router/route-catalog'
import {
  isKnownSiteProfile,
  resolveCurrentSiteProfile,
  type SiteRouteGroup,
} from '@/config/site-registry'

const unsafeQueryKeys = new Set([
  'token',
  'access_token',
  'refresh_token',
  'redirect',
  'redirect_uri',
  'return',
  'return_url',
  'returnurl',
])

const normalizeRootHttpsOrigin = (value: string | undefined): string | undefined => {
  if (!value?.trim()) return undefined

  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return undefined
    }

    return url.origin
  } catch {
    return undefined
  }
}

export const sanitizeVersionSwitchSearch = (search: string): string => {
  const params = new URLSearchParams(search)
  for (const key of [...params.keys()]) {
    if (unsafeQueryKeys.has(key.toLowerCase())) params.delete(key)
  }

  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

export const getLegacyAppOrigin = (): string | undefined =>
  normalizeRootHttpsOrigin(import.meta.env.VITE_LEGACY_APP_ORIGIN)

export const resolveMultiDomainToLegacyUrl = (
  legacyOrigin: string | undefined,
  pathname: string,
  search: string,
  hash: string,
  routeGroups?: readonly SiteRouteGroup[],
): string | undefined => {
  const origin = normalizeRootHttpsOrigin(legacyOrigin)
  if (!origin) return undefined

  const target = new URL(resolveLegacyRoutePath(pathname, routeGroups) ?? '/home', origin)
  const incomingParams = new URLSearchParams(sanitizeVersionSwitchSearch(search))
  for (const [key, value] of incomingParams) {
    target.searchParams.append(key, value)
  }
  target.hash = hash
  return target.toString()
}

export const resolveCurrentVersionSwitchUrl = (): string | undefined => {
  if (typeof window === 'undefined') return undefined
  const profile = resolveCurrentSiteProfile()

  return resolveMultiDomainToLegacyUrl(
    getLegacyAppOrigin(),
    window.location.pathname,
    window.location.search,
    window.location.hash,
    isKnownSiteProfile(profile) ? profile.routeGroups : undefined,
  )
}
