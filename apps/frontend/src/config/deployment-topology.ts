export type DeploymentId = 'local' | 'release' | 'staging'

export interface DeploymentTopology {
  id: DeploymentId
  platformRootDomain: string
  siteRootDomain: string
  publicHostname: string
  protocol: 'http' | 'https'
  port?: number
}

const normalizeHostname = (hostname: string): string =>
  hostname.trim().toLowerCase().replace(/\.$/, '')

const buildOrigin = (topology: DeploymentTopology, hostname: string): string =>
  `${topology.protocol}://${hostname}${topology.port ? `:${topology.port}` : ''}`

export const getDeploymentOrigin = buildOrigin

const platformRootDomain = import.meta.env.VITE_PLATFORM_ROOT_DOMAIN || 'qysyw.cn'
const configuredSiteRootDomain = import.meta.env.VITE_SITE_ROOT_DOMAIN || platformRootDomain
const configuredPublicHostname =
  import.meta.env.VITE_PUBLIC_SITE_HOST || `www.${configuredSiteRootDomain}`
const localRootDomain = import.meta.env.VITE_LOCAL_ROOT_DOMAIN || 'qysyw.test'
const stagingSiteRootDomain = `staging.${platformRootDomain}`

const releasePublicHostname =
  normalizeHostname(configuredSiteRootDomain) === normalizeHostname(platformRootDomain)
    ? configuredPublicHostname
    : `www.${platformRootDomain}`
const stagingPublicHostname =
  normalizeHostname(configuredSiteRootDomain) === normalizeHostname(stagingSiteRootDomain)
    ? configuredPublicHostname
    : stagingSiteRootDomain

export const releaseTopology: DeploymentTopology = {
  id: 'release',
  platformRootDomain: normalizeHostname(platformRootDomain),
  siteRootDomain: normalizeHostname(platformRootDomain),
  publicHostname: normalizeHostname(releasePublicHostname),
  protocol: 'https',
}

/** Staging is an explicit site family, never inferred from an arbitrary subdomain. */
export const stagingTopology: DeploymentTopology = {
  id: 'staging',
  platformRootDomain: normalizeHostname(platformRootDomain),
  siteRootDomain: normalizeHostname(stagingSiteRootDomain),
  publicHostname: normalizeHostname(stagingPublicHostname),
  protocol: 'https',
}

export const localTopology: DeploymentTopology = {
  id: 'local',
  platformRootDomain: normalizeHostname(platformRootDomain),
  siteRootDomain: normalizeHostname(localRootDomain),
  publicHostname: `www.${normalizeHostname(localRootDomain)}`,
  protocol: 'https',
  port: 5173,
}

export const deploymentTopologies = [localTopology, releaseTopology, stagingTopology] as const
