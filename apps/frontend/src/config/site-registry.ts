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
  labelKey: string
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
  labelKey: 'nav.sitePublic'
}

export type ResolvedSiteProfile = SiteProfile | RejectedSiteProfile

interface SiteDefinition {
  id: string
  productionHostname: string
  localHostname: string
  defaultPath: string
  routeGroups: readonly string[]
  shell: SiteShell
  labelKey: string
  app?: string
  kind?: SiteKind
  navigationGroup?: 'public' | 'account' | 'products' | 'user-console' | 'management'
  accessPermissions?: readonly Permission[]
}

const productionRootDomain = import.meta.env.VITE_ROOT_DOMAIN || 'qysyw.cn'
const localRootDomain = import.meta.env.VITE_LOCAL_ROOT_DOMAIN || 'qysyw.test'
const localDevelopmentPort = ':5173'
const hostnameFor = (prefix: string, rootDomain: string) => `${prefix}.${rootDomain}`
const productionHostnameFor = (prefix: string) => hostnameFor(prefix, productionRootDomain)
const localHostnameFor = (prefix: string) => hostnameFor(prefix, localRootDomain)
const publicProductionHostname =
  import.meta.env.VITE_PUBLIC_SITE_HOST || productionHostnameFor('www')
const identityProductionOrigin = `https://${productionHostnameFor('auth')}`
const identityLocalOrigin = `https://${localHostnameFor('auth')}${localDevelopmentPort}`

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
    productionHostname: publicProductionHostname,
    localHostname: localHostnameFor('www'),
    defaultPath: '/home',
    routeGroups: ['public', 'shared'],
    shell: 'public',
    labelKey: 'nav.sitePublic',
  },
  {
    id: 'identity',
    productionHostname: productionHostnameFor('auth'),
    localHostname: localHostnameFor('auth'),
    defaultPath: '/login',
    routeGroups: ['identity', 'shared'],
    shell: 'identity',
    labelKey: 'nav.siteIdentity',
  },
  {
    id: 'account',
    productionHostname: productionHostnameFor('account'),
    localHostname: localHostnameFor('account'),
    defaultPath: '/overview',
    routeGroups: ['account', 'shared'],
    shell: 'application',
    labelKey: 'nav.siteAccount',
  },
  {
    id: 'chat',
    productionHostname: productionHostnameFor('chat'),
    localHostname: localHostnameFor('chat'),
    defaultPath: '/overview',
    routeGroups: ['chat', 'shared'],
    shell: 'application',
    labelKey: 'nav.siteChat',
  },
  {
    id: 'terminal',
    productionHostname: productionHostnameFor('terminal'),
    localHostname: localHostnameFor('terminal'),
    defaultPath: '/overview',
    routeGroups: ['terminal', 'shared'],
    shell: 'application',
    labelKey: 'nav.siteTerminal',
  },
  {
    id: 'console-ai',
    productionHostname: productionHostnameFor('ai.console'),
    localHostname: localHostnameFor('ai.console'),
    defaultPath: '/overview',
    routeGroups: ['console-ai', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteConsoleAi',
  },
  {
    id: 'console-developer',
    productionHostname: productionHostnameFor('developer.console'),
    localHostname: localHostnameFor('developer.console'),
    defaultPath: '/overview',
    routeGroups: ['console-developer', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteConsoleDeveloper',
  },
  {
    id: 'console-ram',
    productionHostname: productionHostnameFor('ram.console'),
    localHostname: localHostnameFor('ram.console'),
    defaultPath: '/overview',
    routeGroups: ['console-ram', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteConsoleRam',
  },
  {
    id: 'management-core',
    productionHostname: productionHostnameFor('management'),
    localHostname: localHostnameFor('management'),
    defaultPath: '/overview',
    routeGroups: ['management-core', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteManagementCore',
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
      productionHostname: productionHostnameFor(`${slug}.console`),
      localHostname: localHostnameFor(`${slug}.console`),
      defaultPath: '/overview',
      routeGroups: [('product-' + product) as `product-${typeof product}`, 'shared'] as const,
      shell: 'application' as const,
      labelKey:
        product === 'kv'
          ? 'nav.productKv'
          : product === 'short_link'
            ? 'nav.productShortLink'
            : product === 'secret'
              ? 'nav.productSecret'
              : product === 'status'
                ? 'nav.productStatus'
                : product === 'verification'
                  ? 'nav.productVerification'
                  : product === 'ip_geolocation'
                    ? 'nav.productIpGeolocation'
                    : 'nav.productPush',
    }
  }),
  {
    id: 'product-oj',
    app: 'console-product-oj',
    productionHostname: productionHostnameFor('oj.console'),
    localHostname: localHostnameFor('oj.console'),
    defaultPath: '/overview',
    routeGroups: ['product-oj', 'shared'],
    shell: 'application',
    labelKey: 'nav.ojSubmitter',
  },
  {
    id: 'management-ai',
    productionHostname: productionHostnameFor('ai.management'),
    localHostname: localHostnameFor('ai.management'),
    defaultPath: '/overview',
    routeGroups: ['management-ai', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteManagementAi',
  },
  {
    id: 'management-developer',
    productionHostname: productionHostnameFor('developer.management'),
    localHostname: localHostnameFor('developer.management'),
    defaultPath: '/overview',
    routeGroups: ['management-developer', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteManagementDeveloper',
  },
  {
    id: 'management-terminal',
    productionHostname: productionHostnameFor('terminal.management'),
    localHostname: localHostnameFor('terminal.management'),
    defaultPath: '/overview',
    routeGroups: ['management-terminal', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteManagementTerminal',
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
    app: configuredDefinition.app ?? definition.id,
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
        : definition.id.startsWith('product-') || definition.id === 'terminal'
          ? 'products'
          : definition.id === 'public' || definition.id === 'identity'
            ? 'public'
            : definition.id.startsWith('console-')
              ? 'user-console'
              : 'account'),
    accessPermissions:
      configuredDefinition.accessPermissions ?? profileAccessPermissions[definition.id] ?? [],
    labelKey: configuredDefinition.labelKey,
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

const staticProfilesByHostname = new Map(siteProfiles.map((profile) => [profile.hostname, profile]))
const staticProfilesByOrigin = new Map(
  siteProfiles.map((profile) => [profile.canonicalOrigin, profile]),
)
const dynamicProductionProfiles = new Map<string, readonly SiteProfile[]>()

const isValidRootDomain = (hostname: string): boolean => {
  const labels = hostname.split('.')
  return (
    hostname.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
}

const getProductionPrefix = (definition: (typeof siteDefinitions)[number]): string | undefined => {
  if (definition.id === 'public') return ''

  const suffix = `.${productionRootDomain}`
  if (!definition.productionHostname.endsWith(suffix)) return undefined
  return definition.productionHostname.slice(0, -suffix.length)
}

const productionPrefixes = siteDefinitions
  .map((definition) => getProductionPrefix(definition))
  .filter((prefix): prefix is string => Boolean(prefix))
  .sort((left, right) => right.length - left.length)
const retiredRootLabels = new Set(['console', 'developer'])

const createDynamicProductionProfiles = (rootDomain: string): readonly SiteProfile[] => {
  const existing = dynamicProductionProfiles.get(rootDomain)
  if (existing) return existing

  const identityOrigin = `https://${hostnameFor('auth', rootDomain)}`
  const profiles = siteDefinitions.flatMap((definition) => {
    const prefix = getProductionPrefix(definition)
    if (prefix === undefined) return []

    const hostname = prefix ? hostnameFor(prefix, rootDomain) : rootDomain
    return [toSiteProfile(definition, hostname, `https://${hostname}`, identityOrigin)]
  })

  dynamicProductionProfiles.set(rootDomain, profiles)
  return profiles
}

/**
 * Derives a deployment root from a known site prefix. This keeps one static
 * build portable across delegated roots such as `md.qysyw.cn` without turning
 * arbitrary subdomains into product routes.
 */
const inferProductionRootDomain = (hostname: string): string | undefined => {
  if (!isValidRootDomain(hostname) || hostname.endsWith(`.${localRootDomain}`)) return undefined

  for (const prefix of productionPrefixes) {
    const prefixWithDot = `${prefix}.`
    if (!hostname.startsWith(prefixWithDot)) continue

    const rootDomain = hostname.slice(prefixWithDot.length)
    if (isValidRootDomain(rootDomain) && !retiredRootLabels.has(rootDomain.split('.')[0]!))
      return rootDomain
  }

  if (hostname.startsWith('www.')) {
    const rootDomain = hostname.slice('www.'.length)
    if (isValidRootDomain(rootDomain)) return rootDomain
  }

  // EO only serves this static bundle for domains explicitly bound to the
  // project. A single delegated label, e.g. `md.qysyw.cn`, is therefore a
  // valid public root; deeper unknown hosts stay rejected unless they match a
  // known site prefix above.
  if (hostname.endsWith(`.${productionRootDomain}`)) {
    const delegatedLabel = hostname.slice(0, -(productionRootDomain.length + 1))
    return delegatedLabel && !delegatedLabel.includes('.') && !retiredRootLabels.has(delegatedLabel)
      ? hostname
      : undefined
  }

  return hostname === productionRootDomain ? hostname : undefined
}

const resolveDynamicProductionProfile = (hostname: string): SiteProfile | undefined => {
  const rootDomain = inferProductionRootDomain(hostname)
  if (!rootDomain) return undefined
  return createDynamicProductionProfiles(rootDomain).find(
    (profile) => profile.hostname === hostname,
  )
}

const getProfilesForEnvironment = (profile: SiteProfile): readonly SiteProfile[] => {
  if (profile.hostname.endsWith(`.${localRootDomain}`)) {
    return siteProfiles.filter((candidate) => candidate.hostname.endsWith(`.${localRootDomain}`))
  }

  const rootDomain = inferProductionRootDomain(profile.hostname)
  if (rootDomain && rootDomain !== productionRootDomain)
    return createDynamicProductionProfiles(rootDomain)

  return siteProfiles.filter((candidate) => candidate.hostname.endsWith(`.${productionRootDomain}`))
}

export const getSiteProfilesForEnvironment = (
  currentProfile: SiteProfile,
): readonly SiteProfile[] => {
  return getProfilesForEnvironment(currentProfile).filter((profile) => profile.id !== 'identity')
}

export const getSiteProfileForEnvironment = (
  profileId: SiteProfileId,
  currentProfile: SiteProfile,
): SiteProfile | undefined =>
  getProfilesForEnvironment(currentProfile).find((profile) => profile.id === profileId)

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

export const resolveSiteProfile = (hostname: string): ResolvedSiteProfile => {
  const normalizedHostname = normalizeSiteHostname(hostname)
  if (!normalizedHostname) return getRejectedSiteProfile(hostname)

  return (
    staticProfilesByHostname.get(normalizedHostname) ??
    resolveDynamicProductionProfile(normalizedHostname) ??
    getRejectedSiteProfile(normalizedHostname)
  )
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

    const normalizedHostname = normalizeSiteHostname(parsed.hostname)
    if (!normalizedHostname) return getRejectedSiteProfile(parsed.hostname)

    const profile =
      staticProfilesByOrigin.get(parsed.origin) ??
      resolveDynamicProductionProfile(normalizedHostname)
    return profile?.canonicalOrigin === parsed.origin
      ? profile
      : getRejectedSiteProfile(parsed.hostname)
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
