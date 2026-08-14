export type DeploymentId = 'local' | 'release'

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
const siteRootDomain = import.meta.env.VITE_SITE_ROOT_DOMAIN || platformRootDomain
const publicHostname = import.meta.env.VITE_PUBLIC_SITE_HOST || `www.${siteRootDomain}`
const localRootDomain = import.meta.env.VITE_LOCAL_ROOT_DOMAIN || 'qysyw.test'

export const releaseTopology: DeploymentTopology = {
  id: 'release',
  platformRootDomain: normalizeHostname(platformRootDomain),
  siteRootDomain: normalizeHostname(siteRootDomain),
  publicHostname: normalizeHostname(publicHostname),
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

export const deploymentTopologies = [localTopology, releaseTopology] as const
