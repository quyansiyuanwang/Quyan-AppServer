import { Permission } from '@/constant/permission'

export type SiteShell = 'public' | 'identity' | 'application' | 'console'
export type SiteKind = 'public' | 'identity' | 'account' | 'product' | 'user-console' | 'management'
export type SiteProfileId = (typeof siteDefinitions)[number]['id']
export type SiteRouteGroup = SiteProfileId | 'shared'

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
}

export interface RejectedSiteProfile {
  id: 'rejected'
  hostname: string
  defaultPath: '/'
  routeGroups: readonly []
  shell: 'public'
  app: string
  kind: 'public'
  navigationGroup: 'public'
  accessPermissions: readonly []
}

export type ResolvedSiteProfile = SiteProfile | RejectedSiteProfile

interface SiteDefinition {
  id: string
  productionHostname: string
  localHostname: string
  defaultPath: string
  routeGroups: readonly string[]
  shell: SiteShell
  app?: string
  kind?: SiteKind
  navigationGroup?: 'public' | 'account' | 'products' | 'user-console' | 'management'
  accessPermissions?: readonly Permission[]
}

const identityProductionOrigin = 'https://auth.qysyw.cn'
const localDevelopmentPort = ':5173'
const identityLocalOrigin = `https://auth.qysyw.test${localDevelopmentPort}`

const profileAccessPermissions: Partial<Record<SiteProfileId, readonly Permission[]>> = {
  account: [Permission.USER_UPDATE_SELF_PROFILE, Permission.RELAY_TOKEN_READ],
  chat: [Permission.RELAY_TOKEN_READ],
  terminal: [Permission.REMOTE_TERMINAL_PRODUCT_READ, Permission.REMOTE_TERMINAL_DEVICE_READ],
  'console-ai': [
    Permission.RELAY_TOKEN_READ,
    Permission.RELAY_CHANNEL_PROVIDER_READ,
    Permission.RELAY_CHANNEL_SUBMIT,
  ],
  'console-developer': [Permission.OAUTH_CLIENT_READ, Permission.AUTH_CENTER_CLIENT_READ],
  'console-terminal': [
    Permission.REMOTE_TERMINAL_DEVICE_READ,
    Permission.REMOTE_TERMINAL_SESSION_READ,
    Permission.REMOTE_TERMINAL_SESSION_CREATE,
  ],
  'console-ram': [
    Permission.RAM_USER_READ,
    Permission.RAM_ROLE_READ,
    Permission.RAM_BINDING_READ,
    Permission.RAM_SESSION_READ,
    Permission.RAM_POLICY_READ,
  ],
  'product-kv': [
    Permission.PRODUCT_KV_READ,
    Permission.PRODUCT_KV_WRITE,
    Permission.PRODUCT_KV_MANAGE,
  ],
  'product-short_link': [
    Permission.PRODUCT_SHORT_LINK_READ,
    Permission.PRODUCT_SHORT_LINK_WRITE,
    Permission.PRODUCT_SHORT_LINK_MANAGE,
  ],
  'product-secret': [
    Permission.PRODUCT_SECRET_READ,
    Permission.PRODUCT_SECRET_WRITE,
    Permission.PRODUCT_SECRET_USE,
    Permission.PRODUCT_SECRET_MANAGE,
  ],
  'product-status': [
    Permission.PRODUCT_STATUS_READ,
    Permission.PRODUCT_STATUS_WRITE,
    Permission.PRODUCT_STATUS_PUBLISH,
    Permission.PRODUCT_STATUS_MANAGE,
  ],
  'product-verification': [
    Permission.PRODUCT_VERIFICATION_SEND,
    Permission.PRODUCT_VERIFICATION_VERIFY,
    Permission.PRODUCT_VERIFICATION_MANAGE,
  ],
  'product-ip_geolocation': [
    Permission.PRODUCT_IP_GEOLOCATION_LOOKUP,
    Permission.PRODUCT_IP_GEOLOCATION_MANAGE,
  ],
  'product-push': [
    Permission.PRODUCT_PUSH_SEND,
    Permission.PRODUCT_PUSH_CHANNEL_MANAGE,
    Permission.PRODUCT_PUSH_DELIVERY_READ,
    Permission.PRODUCT_PUSH_MANAGE,
  ],
  'product-oj': [Permission.OJ_APIKEY_READ, Permission.OJ_USAGE_READ, Permission.OJ_PRICING_READ],
  'management-core': [
    Permission.USER_READ,
    Permission.GROUP_READ,
    Permission.PERMISSION_VIEW,
    Permission.RAM_ROLE_READ,
    Permission.SYSTEM_CONFIG,
    Permission.ANALYTICS_READ,
  ],
  'management-ai': [
    Permission.MODEL_PRICING_UPDATE,
    Permission.RELAY_CHANNEL_REVIEW,
    Permission.RELAY_CHANNEL_HEALTH_READ,
    Permission.RELAY_REQUEST_DIAGNOSTICS_READ,
    Permission.RELAY_CHANNEL_PROBE_READ,
    Permission.UPSTREAM_STATUS_READ,
  ],
  'management-developer': [
    Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE,
    Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE,
    Permission.OAUTH_CLIENT_REVIEW_READ,
  ],
  'management-terminal': [
    Permission.REMOTE_TERMINAL_PRODUCT_READ,
    Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ,
  ],
}

/** Single source of truth for every accepted hostname and its domain app. */
export const siteDefinitions = [
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
    defaultPath: '/dashboard',
    routeGroups: ['console-core', 'account', 'shared'],
    shell: 'application',
  },
  {
    id: 'console-ai',
    productionHostname: 'ai.console.qysyw.cn',
    localHostname: 'ai.console.qysyw.test',
    defaultPath: '/relay/tokens',
    routeGroups: ['console-ai', 'shared'],
    shell: 'console',
  },
  {
    id: 'console-developer',
    productionHostname: 'developer.console.qysyw.cn',
    localHostname: 'developer.console.qysyw.test',
    defaultPath: '/applications/oauth',
    routeGroups: ['console-developer', 'shared'],
    shell: 'console',
  },
  {
    id: 'console-terminal',
    productionHostname: 'terminal.console.qysyw.cn',
    localHostname: 'terminal.console.qysyw.test',
    defaultPath: '/console',
    routeGroups: ['console-terminal', 'shared'],
    shell: 'console',
  },
  {
    id: 'console-ram',
    productionHostname: 'ram.console.qysyw.cn',
    localHostname: 'ram.console.qysyw.test',
    defaultPath: '/overview',
    routeGroups: ['console-ram', 'shared'],
    shell: 'console',
  },
  {
    id: 'management-core',
    productionHostname: 'management.qysyw.cn',
    localHostname: 'management.qysyw.test',
    defaultPath: '/iam/overview',
    routeGroups: ['management-core', 'shared'],
    shell: 'console',
  },
  ...(
    ['kv', 'short_link', 'secret', 'status', 'verification', 'ip_geolocation', 'push'] as const
  ).map((product) => {
    const slug =
      product === 'short_link'
        ? 'short-link'
        : product === 'ip_geolocation'
          ? 'ip-geolocation'
          : product
    return {
      id: ('product-' + product) as `product-${typeof product}`,
      app: 'console-product-' + product,
      productionHostname: slug + '.console.qysyw.cn',
      localHostname: slug + '.console.qysyw.test',
      defaultPath: '/products/' + product,
      routeGroups: [('product-' + product) as `product-${typeof product}`, 'shared'] as const,
      shell: 'application' as const,
    }
  }),
  {
    id: 'product-oj',
    app: 'console-product-oj',
    productionHostname: 'oj.console.qysyw.cn',
    localHostname: 'oj.console.qysyw.test',
    defaultPath: '/oj/apikeys',
    routeGroups: ['product-oj', 'shared'],
    shell: 'application',
  },
  {
    id: 'management-ai',
    productionHostname: 'ai.management.qysyw.cn',
    localHostname: 'ai.management.qysyw.test',
    defaultPath: '/relay/settings',
    routeGroups: ['management-ai', 'shared'],
    shell: 'console',
  },
  {
    id: 'management-developer',
    productionHostname: 'developer.management.qysyw.cn',
    localHostname: 'developer.management.qysyw.test',
    defaultPath: '/services',
    routeGroups: ['management-developer', 'shared'],
    shell: 'console',
  },
  {
    id: 'management-terminal',
    productionHostname: 'terminal.management.qysyw.cn',
    localHostname: 'terminal.management.qysyw.test',
    defaultPath: '/products/remote-terminal',
    routeGroups: ['management-terminal', 'shared'],
    shell: 'console',
  },
] as const satisfies readonly SiteDefinition[]

export const siteProfileIds = siteDefinitions.map(
  (definition) => definition.id,
) as readonly SiteProfileId[]

const siteProfileIdSet = new Set(siteProfileIds)

for (const definition of siteDefinitions) {
  const invalidRouteGroup = definition.routeGroups.find(
    (group) => group !== 'shared' && !siteProfileIdSet.has(group as SiteProfileId),
  )
  if (invalidRouteGroup) {
    throw new Error(
      'Site profile "' +
        definition.id +
        '" references unknown route group "' +
        invalidRouteGroup +
        '".',
    )
  }
}

const toSiteProfile = (
  definition: (typeof siteDefinitions)[number],
  hostname: string,
  canonicalOrigin: string,
  authOrigin: string,
): SiteProfile => {
  const configuredDefinition = definition as SiteDefinition

  return {
    id: definition.id as SiteProfileId,
    hostname,
    canonicalOrigin,
    authOrigin,
    defaultPath: definition.defaultPath,
    routeGroups: definition.routeGroups as readonly SiteRouteGroup[],
    shell: definition.shell,
    app:
      configuredDefinition.app ??
      (definition.id === 'console-core' ? 'console-portal' : definition.id),
    kind:
      configuredDefinition.kind ??
      (definition.id.startsWith('management-')
        ? 'management'
        : definition.id.startsWith('product-')
          ? 'product'
          : definition.id.startsWith('console-')
            ? 'user-console'
            : definition.id === 'identity'
              ? 'identity'
              : definition.id === 'public'
                ? 'public'
                : 'account'),
    navigationGroup:
      configuredDefinition.navigationGroup ??
      (definition.id.startsWith('management-')
        ? 'management'
        : definition.id.startsWith('product-') || ['developer', 'terminal'].includes(definition.id)
          ? 'products'
          : definition.id === 'public' || definition.id === 'identity'
            ? 'public'
            : definition.id.startsWith('console-')
              ? 'user-console'
              : 'account'),
    accessPermissions:
      configuredDefinition.accessPermissions ?? profileAccessPermissions[definition.id] ?? [],
  }
}

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

export const getSiteProfilesForEnvironment = (
  currentProfile: SiteProfile,
): readonly SiteProfile[] => {
  const hostnameSuffix = currentProfile.hostname.endsWith('.test') ? '.test' : '.cn'

  return siteProfiles.filter(
    (profile) => profile.id !== 'identity' && profile.hostname.endsWith(hostnameSuffix),
  )
}

/** Returns only destinations exposed to the current user in the site switcher. */
export const getAccessibleSiteProfiles = (
  currentProfile: SiteProfile,
  effectivePermissions: readonly string[],
): readonly SiteProfile[] => {
  const permissionSet = new Set(effectivePermissions)

  return getSiteProfilesForEnvironment(currentProfile).filter(
    (profile) =>
      profile.id === currentProfile.id ||
      profile.id === 'public' ||
      profile.accessPermissions.length === 0 ||
      profile.accessPermissions.some((permission) => permissionSet.has(permission)),
  )
}

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
  app: 'rejected',
  kind: 'public',
  navigationGroup: 'public',
  accessPermissions: [],
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
