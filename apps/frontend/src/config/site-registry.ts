export const siteProfileIds = [
  'public',
  'identity',
  'account',
  'chat',
  'developer',
  'terminal',
  'console-core',
  'console-ai',
  'console-developer',
  'console-terminal',
] as const

export type SiteProfileId = (typeof siteProfileIds)[number]

export type SiteRouteGroup = SiteProfileId | 'shared'

export type SiteShell = 'public' | 'identity' | 'application' | 'console'

export interface SiteProfile {
  id: SiteProfileId
  hostname: string
  canonicalOrigin: string
  authOrigin: string
  defaultPath: string
  routeGroups: readonly SiteRouteGroup[]
  shell: SiteShell
}

export interface RejectedSiteProfile {
  id: 'rejected'
  hostname: string
  defaultPath: '/'
  routeGroups: readonly []
  shell: 'public'
}

export type ResolvedSiteProfile = SiteProfile | RejectedSiteProfile

interface SiteDefinition {
  id: SiteProfileId
  productionHostname: string
  localHostname: string
  defaultPath: string
  routeGroups: readonly SiteRouteGroup[]
  shell: SiteShell
}

const identityProductionOrigin = 'https://auth.qysyw.cn'
const localDevelopmentPort = ':5173'
const identityLocalOrigin = `https://auth.qysyw.test${localDevelopmentPort}`

const siteDefinitions: readonly SiteDefinition[] = [
  {
    id: 'public',
    productionHostname: 'www.qysyw.cn',
    localHostname: 'www.qysyw.test',
    defaultPath: '/home',
    routeGroups: ['public', 'shared'],
    shell: 'public',
  },
  {
    id: 'identity',
    productionHostname: 'auth.qysyw.cn',
    localHostname: 'auth.qysyw.test',
    defaultPath: '/login',
    routeGroups: ['identity', 'shared'],
    shell: 'identity',
  },
  {
    id: 'account',
    productionHostname: 'account.qysyw.cn',
    localHostname: 'account.qysyw.test',
    defaultPath: '/settings/profile',
    routeGroups: ['account', 'shared'],
    shell: 'application',
  },
  {
    id: 'chat',
    productionHostname: 'chat.qysyw.cn',
    localHostname: 'chat.qysyw.test',
    defaultPath: '/chat',
    routeGroups: ['chat', 'shared'],
    shell: 'application',
  },
  {
    id: 'developer',
    productionHostname: 'developer.qysyw.cn',
    localHostname: 'developer.qysyw.test',
    defaultPath: '/products',
    routeGroups: ['developer', 'shared'],
    shell: 'application',
  },
  {
    id: 'terminal',
    productionHostname: 'terminal.qysyw.cn',
    localHostname: 'terminal.qysyw.test',
    defaultPath: '/products/remote-terminal-cloud',
    routeGroups: ['terminal', 'shared'],
    shell: 'application',
  },
  {
    id: 'console-core',
    productionHostname: 'console.qysyw.cn',
    localHostname: 'console.qysyw.test',
    defaultPath: '/management/users',
    routeGroups: ['console-core', 'shared'],
    shell: 'console',
  },
  {
    id: 'console-ai',
    productionHostname: 'ai.console.qysyw.cn',
    localHostname: 'ai.console.qysyw.test',
    defaultPath: '/relay/settings',
    routeGroups: ['console-ai', 'shared'],
    shell: 'console',
  },
  {
    id: 'console-developer',
    productionHostname: 'developer.console.qysyw.cn',
    localHostname: 'developer.console.qysyw.test',
    defaultPath: '/developer/management',
    routeGroups: ['console-developer', 'shared'],
    shell: 'console',
  },
  {
    id: 'console-terminal',
    productionHostname: 'terminal.console.qysyw.cn',
    localHostname: 'terminal.console.qysyw.test',
    defaultPath: '/management/remote-terminal-products',
    routeGroups: ['console-terminal', 'shared'],
    shell: 'console',
  },
]

const toSiteProfile = (
  definition: SiteDefinition,
  hostname: string,
  canonicalOrigin: string,
  authOrigin: string,
): SiteProfile => ({
  id: definition.id,
  hostname,
  canonicalOrigin,
  authOrigin,
  defaultPath: definition.defaultPath,
  routeGroups: definition.routeGroups,
  shell: definition.shell,
})

const registeredProfiles = siteDefinitions.flatMap((definition) => [
  toSiteProfile(
    definition,
    definition.productionHostname,
    `https://${definition.productionHostname}`,
    identityProductionOrigin,
  ),
  toSiteProfile(
    definition,
    definition.localHostname,
    `https://${definition.localHostname}${localDevelopmentPort}`,
    identityLocalOrigin,
  ),
])

export const siteProfiles: readonly SiteProfile[] = registeredProfiles

const profilesByHostname = new Map(siteProfiles.map((profile) => [profile.hostname, profile]))
const profilesByOrigin = new Map(siteProfiles.map((profile) => [profile.canonicalOrigin, profile]))

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
})

export const resolveSiteProfile = (hostname: string): ResolvedSiteProfile => {
  const normalizedHostname = normalizeSiteHostname(hostname)
  if (!normalizedHostname) return getRejectedSiteProfile(hostname)

  return profilesByHostname.get(normalizedHostname) ?? getRejectedSiteProfile(normalizedHostname)
}

export const resolveSiteProfileFromOrigin = (origin: string): ResolvedSiteProfile => {
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
}

export const resolveCurrentSiteProfile = (): ResolvedSiteProfile => {
  if (typeof window === 'undefined') return getRejectedSiteProfile('')
  return resolveSiteProfile(window.location.hostname)
}

export const isKnownSiteProfile = (profile: ResolvedSiteProfile): profile is SiteProfile =>
  profile.id !== 'rejected'
