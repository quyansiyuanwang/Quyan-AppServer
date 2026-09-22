import { createSiteRegistry } from './site-resolver'
import { deploymentTopologies } from './deployment-topology'
import { createDevSingleSiteRegistry, readDevSingleSiteOptions } from './dev-single-site'
import type { SiteProfileId } from './site-catalog'
import type { ResolvedSiteProfile, SiteProfile, SiteRegistry } from './site-resolver'
import { hasSiteNavigationAccess } from './navigation-site-access'

export {
  siteDefinitions,
  siteProfileIds,
  type SiteDefinition,
  type SiteKind,
  type SiteProfileId,
  type SiteRouteGroup,
  type SiteShell,
} from './site-catalog'
export {
  createSiteRegistry,
  getRejectedSiteProfile,
  normalizeSiteHostname,
  type RejectedSiteProfile,
  type ResolvedSiteProfile,
  type SiteProfile,
  type SiteRegistry,
} from './site-resolver'
export {
  createDevSingleSiteRegistry,
  readDevSingleSiteOptions,
  type DevSingleSiteOptions,
} from './dev-single-site'
export {
  deploymentTopologies,
  localTopology,
  releaseTopology,
  stagingTopology,
  type DeploymentId,
  type DeploymentTopology,
} from './deployment-topology'

/** The singleton used by browser routing, navigation, and layout code. */
const baseSiteRegistry = createSiteRegistry(deploymentTopologies)

const devSingleSiteOptions = readDevSingleSiteOptions({
  dev: import.meta.env.DEV === true,
  flag: import.meta.env.VITE_DEV_SINGLE_SITE,
  requestedProfile: import.meta.env.VITE_DEV_SITE_PROFILE,
  warn: (message) => console.warn(`[dev-single-site] ${message}`),
})

/**
 * True only for the privilege-free localhost development server. Production
 * builds always read `import.meta.env.DEV === false`, and the SSR/node path has
 * no browser origin to alias.
 */
export const devSingleSiteMode: boolean =
  devSingleSiteOptions.enabled && typeof window !== 'undefined'

export const isDevSingleSiteMode = (): boolean => devSingleSiteMode

export const siteRegistry: SiteRegistry = devSingleSiteMode
  ? createDevSingleSiteRegistry(baseSiteRegistry, devSingleSiteOptions, window.location.origin)
  : baseSiteRegistry

export const siteProfiles = siteRegistry.profiles

export const resolveSiteProfile = (hostname: string) => siteRegistry.resolveHost(hostname)
export const resolveSiteProfileFromOrigin = (origin: string) => siteRegistry.resolveOrigin(origin)

export const resolveCurrentSiteProfile = () => {
  if (typeof window === 'undefined') return siteRegistry.resolveHost('')
  return siteRegistry.resolveHost(window.location.hostname)
}

export const getSiteProfilesForEnvironment = (profile: SiteProfile) =>
  siteRegistry.getProfilesForEnvironment(profile).filter((candidate) => candidate.id !== 'identity')

export const getSiteProfileForEnvironment = (
  profileId: SiteProfileId,
  currentProfile: SiteProfile,
) =>
  siteRegistry.getProfilesForEnvironment(currentProfile).find((profile) => profile.id === profileId)

/** Returns only destinations exposed to the current user in the site switcher. */
export const getAccessibleSiteProfiles = (
  currentProfile: SiteProfile,
  effectivePermissions: readonly string[],
) => {
  const permissionSet = new Set(effectivePermissions)
  return getSiteProfilesForEnvironment(currentProfile).filter(
    (profile) =>
      profile.id === currentProfile.id ||
      profile.id === 'public' ||
      hasSiteNavigationAccess(profile.id, [...permissionSet]),
  )
}

export const getPublicSiteProfile = (hostname?: string) => siteRegistry.getPublicSite(hostname)

export const isKnownSiteProfile = (profile: ResolvedSiteProfile): profile is SiteProfile =>
  profile.id !== 'rejected'
