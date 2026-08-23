import { deploymentTopologies, type DeploymentTopology } from '@/config/deployment-topology'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'

export type SharedPreferenceKey = 'locale' | 'theme' | 'siteOpenInNewTab' | 'recentSites'

/** The single browser contract used by every deployment site for shared preferences. */
export const SHARED_PREFERENCE_COOKIE_PREFIX = 'appserver.preference.'
export const SHARED_PREFERENCE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export const getSharedPreferenceCookieName = (key: SharedPreferenceKey): string =>
  `${SHARED_PREFERENCE_COOKIE_PREFIX}${key}`

const normalizeHostname = (hostname: string): string =>
  hostname.trim().toLowerCase().replace(/\.$/, '')

/**
 * Preferences are deliberately scoped to a deployment family: production,
 * staging, and local development must never overwrite each other.
 */
export const getSharedPreferenceCookieDomain = (
  hostname: string,
  topologies: readonly DeploymentTopology[] = deploymentTopologies,
): string | undefined => {
  const normalizedHostname = normalizeHostname(hostname)
  const topology = [...topologies]
    .filter(
      (candidate) =>
        normalizedHostname === candidate.siteRootDomain ||
        normalizedHostname.endsWith(`.${candidate.siteRootDomain}`),
    )
    .sort((left, right) => right.siteRootDomain.length - left.siteRootDomain.length)[0]

  return topology ? `.${topology.siteRootDomain}` : undefined
}

const getCookieValue = (name: string): string | null => {
  if (typeof document === 'undefined') return null

  const encodedName = `${encodeURIComponent(name)}=`
  const match = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(encodedName))
  if (!match) return null

  try {
    return decodeURIComponent(match.slice(encodedName.length))
  } catch {
    return null
  }
}

const writeCookie = (name: string, value: string): void => {
  if (typeof document === 'undefined') return

  const domain = getSharedPreferenceCookieDomain(window.location.hostname)
  const attributes = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${SHARED_PREFERENCE_COOKIE_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
  ]
  if (window.location.protocol === 'https:') attributes.push('Secure')
  if (domain) attributes.push(`Domain=${domain}`)
  document.cookie = attributes.join('; ')
}

/**
 * Reads a deployment-wide preference and migrates its former per-origin
 * localStorage value the first time a site in that deployment is opened.
 */
export const getSharedPreference = (
  key: SharedPreferenceKey,
  legacyStorageKey?: string,
): string | null => {
  const cookieValue = getCookieValue(getSharedPreferenceCookieName(key))
  if (cookieValue !== null) return cookieValue

  const legacyValue = legacyStorageKey ? TypedLocalStorage.getItem(legacyStorageKey) : null
  if (legacyValue) setSharedPreference(key, legacyValue)
  return legacyValue
}

/** Keeps the legacy per-origin key in sync while sharing new writes across sites. */
export const setSharedPreference = (
  key: SharedPreferenceKey,
  value: string,
  legacyStorageKey?: string,
): void => {
  writeCookie(getSharedPreferenceCookieName(key), value)
  if (legacyStorageKey) TypedLocalStorage.setItem(legacyStorageKey, value)
}
