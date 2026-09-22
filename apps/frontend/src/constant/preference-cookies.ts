import { deploymentTopologies, type DeploymentTopology } from '@/config/deployment-topology'
export const SHARED_PREFERENCE_KEYS = [
  'locale',
  'theme',
  'siteOpenInNewTab',
  'recentSites',
  'pinnedRoutes',
] as const
export type SharedPreferenceKey = (typeof SHARED_PREFERENCE_KEYS)[number]

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
