import { createSiteRegistry } from './site-resolver'
import { deploymentTopologies } from './deployment-topology'
import type { SiteProfileId } from './site-catalog'
import type { ResolvedSiteProfile, SiteProfile } from './site-resolver'

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
  deploymentTopologies,
  localTopology,
  releaseTopology,
  type DeploymentId,
  type DeploymentTopology,
} from './deployment-topology'

/** The singleton used by browser routing, navigation, and layout code. */
export const siteRegistry = createSiteRegistry(deploymentTopologies)
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
      profile.accessPermissions.length === 0 ||
      profile.accessPermissions.some((permission) => permissionSet.has(permission)),
  )
}

export const getPublicSiteProfile = (hostname?: string) => siteRegistry.getPublicSite(hostname)

export const isKnownSiteProfile = (profile: ResolvedSiteProfile): profile is SiteProfile =>
  profile.id !== 'rejected'
