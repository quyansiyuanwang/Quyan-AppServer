import type { Permission } from '@/constant/permission'
import {
  getSiteAccessPermissions,
  siteDefinitions,
  type SiteDefinition,
  type SiteKind,
  type SiteProfileId,
  type SiteRouteGroup,
  type SiteShell,
} from './site-catalog'
import {
  deploymentTopologies,
  getDeploymentOrigin,
  type DeploymentId,
  type DeploymentTopology,
} from './deployment-topology'

export interface SiteProfile {
  id: SiteProfileId
  hostname: string
  canonicalOrigin: string
  authOrigin: string
  defaultPath: string
  routeGroups: readonly SiteRouteGroup[]
  shell: SiteShell
  app: string
  kind: SiteKind
  navigationGroup: 'public' | 'account' | 'products' | 'user-console' | 'management'
  accessPermissions: readonly Permission[]
  labelKey: string
  deploymentId: DeploymentId
}

export interface RejectedSiteProfile {
  id: 'rejected'
  hostname: string
  defaultPath: '/'
  routeGroups: readonly []
  shell: 'public'
  app: 'rejected'
  kind: 'public'
  navigationGroup: 'public'
  accessPermissions: readonly []
  labelKey: 'nav.sitePublic'
}

export type ResolvedSiteProfile = SiteProfile | RejectedSiteProfile

const siteKindFor = (siteId: SiteProfileId): SiteKind =>
  siteId.startsWith('management-')
    ? 'management'
    : siteId.startsWith('product-')
      ? 'product'
      : siteId.startsWith('console-')
        ? 'user-console'
        : siteId === 'identity'
          ? 'identity'
          : siteId === 'public'
            ? 'public'
            : 'account'

const navigationGroupFor = (siteId: SiteProfileId): SiteProfile['navigationGroup'] =>
  siteId.startsWith('management-')
    ? 'management'
    : siteId.startsWith('product-') || siteId === 'terminal'
      ? 'products'
      : siteId === 'public' || siteId === 'identity'
        ? 'public'
        : siteId.startsWith('console-')
          ? 'user-console'
          : 'account'

export const normalizeSiteHostname = (hostname: string): string | undefined => {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (
    !normalized ||
    normalized.includes(':') ||
    normalized.includes('/') ||
    normalized.includes('@')
  ) {
    return undefined
  }
  return normalized
}

export const getRejectedSiteProfile = (hostname: string): RejectedSiteProfile => ({
  id: 'rejected',
  hostname: normalizeSiteHostname(hostname) ?? '',
  defaultPath: '/',
  routeGroups: [],
  shell: 'public',
  app: 'rejected',
  kind: 'public',
  navigationGroup: 'public',
  accessPermissions: [],
  labelKey: 'nav.sitePublic',
})

const hostnameFor = (hostPrefix: string, topology: DeploymentTopology): string =>
  hostPrefix ? `${hostPrefix}.${topology.siteRootDomain}` : topology.publicHostname

const profileFor = (definition: SiteDefinition, topology: DeploymentTopology): SiteProfile => {
  const hostname = hostnameFor(definition.hostPrefix, topology)
  const siteId = definition.id as SiteProfileId

  return {
    id: siteId,
    hostname,
    canonicalOrigin: getDeploymentOrigin(topology, hostname),
    authOrigin: getDeploymentOrigin(topology, `auth.${topology.siteRootDomain}`),
    defaultPath: definition.defaultPath,
    routeGroups: definition.routeGroups as readonly SiteRouteGroup[],
    shell: definition.shell,
    app: definition.app ?? definition.id,
    kind: definition.kind ?? siteKindFor(siteId),
    navigationGroup: definition.navigationGroup ?? navigationGroupFor(siteId),
    accessPermissions: definition.accessPermissions ?? getSiteAccessPermissions(siteId),
    labelKey: definition.labelKey,
    deploymentId: topology.id,
  }
}

export interface SiteRegistry {
  readonly profiles: readonly SiteProfile[]
  resolveHost(hostname: string): ResolvedSiteProfile
  resolveOrigin(origin: string): ResolvedSiteProfile
  getProfilesForEnvironment(profile: SiteProfile): readonly SiteProfile[]
  getPublicSite(hostname?: string): SiteProfile
}

/**
 * Builds a closed hostname registry. A topology must name its site root
 * explicitly; this function never infers a deployment from an unknown host.
 */
export const createSiteRegistry = (
  topologies: readonly DeploymentTopology[] = deploymentTopologies,
): SiteRegistry => {
  const profiles = topologies.flatMap((topology) =>
    siteDefinitions.map((definition) => profileFor(definition, topology)),
  )
  const profilesByHostname = new Map(profiles.map((profile) => [profile.hostname, profile]))
  const profilesByOrigin = new Map(profiles.map((profile) => [profile.canonicalOrigin, profile]))

  const topologyForUnknownHostname = (hostname: string): DeploymentTopology =>
    topologies.find(
      (topology) =>
        hostname === topology.siteRootDomain || hostname.endsWith(`.${topology.siteRootDomain}`),
    ) ??
    topologies.find((topology) => topology.id === 'release') ??
    topologies[0]!

  return {
    profiles,
    resolveHost(hostname) {
      const normalizedHostname = normalizeSiteHostname(hostname)
      if (!normalizedHostname) return getRejectedSiteProfile(hostname)
      return (
        profilesByHostname.get(normalizedHostname) ?? getRejectedSiteProfile(normalizedHostname)
      )
    },
    resolveOrigin(origin) {
      try {
        const parsed = new URL(origin)
        if (
          parsed.pathname !== '/' ||
          parsed.search ||
          parsed.hash ||
          parsed.username ||
          parsed.password
        ) {
          return getRejectedSiteProfile(parsed.hostname)
        }

        return profilesByOrigin.get(parsed.origin) ?? getRejectedSiteProfile(parsed.hostname)
      } catch {
        return getRejectedSiteProfile('')
      }
    },
    getProfilesForEnvironment(profile) {
      return profiles.filter((candidate) => candidate.deploymentId === profile.deploymentId)
    },
    getPublicSite(hostname) {
      const normalizedHostname = hostname ? normalizeSiteHostname(hostname) : undefined
      const topology = normalizedHostname
        ? topologyForUnknownHostname(normalizedHostname)
        : (topologies.find((candidate) => candidate.id === 'release') ?? topologies[0])
      const profile = profiles.find(
        (candidate) => candidate.id === 'public' && candidate.deploymentId === topology?.id,
      )
      if (!profile) throw new Error('Public site profile is not registered')
      return profile
    },
  }
}
