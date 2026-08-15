import { Permission } from '@/constant/permission'
import { getSiteNavigationPermissions } from './navigation-site-access'

export type SiteShell = 'public' | 'identity' | 'application' | 'console'
export type SiteKind = 'public' | 'identity' | 'account' | 'product' | 'user-console' | 'management'

export interface SiteDefinition {
  id: string
  /** Empty only for the configured public hostname. */
  hostPrefix: string
  defaultPath: string
  routeGroups: readonly string[]
  shell: SiteShell
  labelKey: string
  app?: string
  kind?: SiteKind
  navigationGroup?: 'public' | 'account' | 'products' | 'user-console' | 'management'
  accessPermissions?: readonly Permission[]
}

type ProductCode =
  | 'kv'
  | 'short_link'
  | 'secret'
  | 'status'
  | 'verification'
  | 'ip_geolocation'
  | 'push'
type ProductSiteDefinition = SiteDefinition & { id: `product-${ProductCode}` }

const productDefinitions: readonly ProductSiteDefinition[] = (
  ['kv', 'short_link', 'secret', 'status', 'verification', 'ip_geolocation', 'push'] as const
).map((product) => {
  const slug =
    product === 'short_link'
      ? 'short-link'
      : product === 'ip_geolocation'
        ? 'ip-geolocation'
        : product
  const id = `product-${product}` as const

  return {
    id,
    hostPrefix: `${slug}.console`,
    app: `console-product-${product}`,
    defaultPath: '/overview',
    routeGroups: [id, 'shared'],
    shell: 'application',
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
  } satisfies ProductSiteDefinition
})

/** Authoritative catalog of product sites. It intentionally contains no environment hostname. */
export const siteDefinitions = [
  {
    id: 'public',
    hostPrefix: '',
    defaultPath: '/home',
    routeGroups: ['public', 'shared'],
    shell: 'public',
    labelKey: 'nav.sitePublic',
  },
  {
    id: 'identity',
    hostPrefix: 'auth',
    defaultPath: '/login',
    routeGroups: ['identity', 'shared'],
    shell: 'identity',
    labelKey: 'nav.siteIdentity',
  },
  {
    id: 'account',
    hostPrefix: 'account',
    defaultPath: '/overview',
    routeGroups: ['account', 'shared'],
    shell: 'application',
    labelKey: 'nav.siteAccount',
  },
  {
    id: 'chat',
    hostPrefix: 'chat',
    defaultPath: '/overview',
    routeGroups: ['chat', 'shared'],
    shell: 'application',
    labelKey: 'nav.siteChat',
  },
  {
    id: 'terminal',
    hostPrefix: 'terminal',
    defaultPath: '/overview',
    routeGroups: ['terminal', 'shared'],
    shell: 'application',
    labelKey: 'nav.siteTerminal',
  },
  {
    id: 'console-ai',
    hostPrefix: 'ai.console',
    defaultPath: '/overview',
    routeGroups: ['console-ai', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteConsoleAi',
  },
  {
    id: 'console-developer',
    hostPrefix: 'developer.console',
    defaultPath: '/overview',
    routeGroups: ['console-developer', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteConsoleDeveloper',
  },
  {
    id: 'console-ram',
    hostPrefix: 'ram.console',
    defaultPath: '/overview',
    routeGroups: ['console-ram', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteConsoleRam',
  },
  {
    id: 'management-core',
    hostPrefix: 'management',
    defaultPath: '/overview',
    routeGroups: ['management-core', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteManagementCore',
  },
  ...productDefinitions,
  {
    id: 'product-oj',
    hostPrefix: 'oj.console',
    app: 'console-product-oj',
    defaultPath: '/overview',
    routeGroups: ['product-oj', 'shared'],
    shell: 'application',
    labelKey: 'nav.ojSubmitter',
  },
  {
    id: 'management-ai',
    hostPrefix: 'ai.management',
    defaultPath: '/overview',
    routeGroups: ['management-ai', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteManagementAi',
  },
  {
    id: 'management-developer',
    hostPrefix: 'developer.management',
    defaultPath: '/overview',
    routeGroups: ['management-developer', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteManagementDeveloper',
  },
  {
    id: 'management-terminal',
    hostPrefix: 'terminal.management',
    defaultPath: '/overview',
    routeGroups: ['management-terminal', 'shared'],
    shell: 'console',
    labelKey: 'nav.siteManagementTerminal',
  },
] as const satisfies readonly SiteDefinition[]

export type SiteProfileId = (typeof siteDefinitions)[number]['id']
export type SiteRouteGroup = SiteProfileId | 'shared'

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
      `Site profile "${definition.id}" references unknown route group "${invalidRouteGroup}".`,
    )
  }
}

export const getSiteAccessPermissions = (siteId: SiteProfileId): readonly Permission[] => {
  // Keep the profile metadata compatible for callers, while deriving it from
  // the same navigation manifest used by the sidebar and global search.
  // The import is type-only at runtime through the resolver to avoid a second
  // hand-maintained permission map.
  return getSiteNavigationPermissions(siteId)
}
