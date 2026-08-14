import { Permission } from '@/constant/permission'

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

const profileAccessPermissions: Partial<Record<string, readonly Permission[]>> = {
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
    Permission.SUPPORT_AI_CONFIG,
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

export const getSiteAccessPermissions = (siteId: SiteProfileId): readonly Permission[] =>
  profileAccessPermissions[siteId] ?? []
