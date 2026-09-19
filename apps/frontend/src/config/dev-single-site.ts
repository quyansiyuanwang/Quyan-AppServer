import {
  siteDefinitions,
  siteProfileIds,
  type SiteProfileId,
  type SiteRouteGroup,
} from './site-catalog'
import {
  getRejectedSiteProfile,
  type ResolvedSiteProfile,
  type SiteProfile,
  type SiteRegistry,
} from './site-resolver'

/**
 * Privilege-free local development serves a single site on plain HTTP
 * `localhost`, so no hosts edit, certificate or elevation is required.
 *
 * The mode is unreachable in production builds: every branch is gated on
 * `import.meta.env.DEV` plus the explicit `VITE_DEV_SINGLE_SITE` flag, and the
 * multi-domain HTTPS topology stays available through `pnpm run dev:domains`.
 */
export const devSingleSiteHostnames = ['localhost', '127.0.0.1', '::1'] as const

export const defaultDevSingleSiteProfile: SiteProfileId = 'management-core'

const identityRouteGroup: SiteRouteGroup = 'identity'

export interface DevSingleSiteOptions {
  enabled: boolean
  siteProfileId: SiteProfileId
  hostnames: readonly string[]
}

export interface DevSingleSiteInput {
  /** `import.meta.env.DEV` */
  dev: boolean
  /** `import.meta.env.VITE_DEV_SINGLE_SITE` */
  flag?: string
  /** `import.meta.env.VITE_DEV_SITE_PROFILE` */
  requestedProfile?: string
  hostnames?: readonly string[]
  warn?: (message: string) => void
}

export const normalizeDevHostname = (hostname: string): string =>
  String(hostname ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '')

export const isDevSingleSiteProfileId = (value: string): value is SiteProfileId =>
  (siteProfileIds as readonly string[]).includes(value)

/**
 * Accepts either a registered profile id (`management-core`) or the hostname
 * prefix it is published under (`management`), so the value in
 * `.env.localhost` stays readable.
 */
export const resolveDevSingleSiteProfileId = (requested: string): SiteProfileId | undefined => {
  const value = String(requested ?? '').trim()
  if (!value) return undefined
  if (isDevSingleSiteProfileId(value)) return value

  const definition = siteDefinitions.find((candidate) => candidate.hostPrefix === value)
  return definition && isDevSingleSiteProfileId(definition.id) ? definition.id : undefined
}

export const readDevSingleSiteOptions = (input: DevSingleSiteInput): DevSingleSiteOptions => {
  const hostnames = (input.hostnames ?? devSingleSiteHostnames)
    .map(normalizeDevHostname)
    .filter(Boolean)

  const enabled = Boolean(input.dev) && String(input.flag ?? '').trim() === 'true'
  const requested = String(input.requestedProfile ?? '').trim()
  const resolved = resolveDevSingleSiteProfileId(requested)

  if (enabled && requested && !resolved) {
    input.warn?.(
      `VITE_DEV_SITE_PROFILE="${requested}" 不是已注册站点，回退到 ${defaultDevSingleSiteProfile}。`,
    )
  }

  return {
    enabled,
    siteProfileId: resolved ?? defaultDevSingleSiteProfile,
    hostnames,
  }
}

/**
 * Wraps the closed registry with a single-origin view of one site profile.
 *
 * The aliased profile keeps its own route tree (plus the identity group, so
 * login stays on the same origin) but adopts the browser origin for
 * `canonicalOrigin`/`authOrigin`; every other hostname stays rejected, so the
 * mode cannot be used to reach a site that the registry does not know.
 */
export const createDevSingleSiteRegistry = (
  base: SiteRegistry,
  options: DevSingleSiteOptions,
  origin: string,
): SiteRegistry => {
  const normalizedOrigin = String(origin).replace(/\/$/, '')
  const source =
    base.profiles.find(
      (profile) => profile.id === options.siteProfileId && profile.deploymentId === 'local',
    ) ?? base.profiles.find((profile) => profile.id === options.siteProfileId)

  if (!source) {
    throw new Error(`Dev single-site profile is not registered: ${options.siteProfileId}`)
  }

  const aliased: SiteProfile = {
    ...source,
    canonicalOrigin: normalizedOrigin,
    authOrigin: normalizedOrigin,
    routeGroups: [...new Set<SiteRouteGroup>([...source.routeGroups, identityRouteGroup])],
  }

  const hostnames = new Set(options.hostnames.map(normalizeDevHostname).filter(Boolean))

  const resolveAliasedHost = (hostname: string): ResolvedSiteProfile =>
    hostnames.has(normalizeDevHostname(hostname)) ? aliased : getRejectedSiteProfile(hostname)

  return {
    profiles: [aliased],
    resolveHost: resolveAliasedHost,
    resolveOrigin(value) {
      try {
        const parsed = new URL(value)
        return parsed.origin === normalizedOrigin
          ? aliased
          : getRejectedSiteProfile(parsed.hostname)
      } catch {
        return getRejectedSiteProfile('')
      }
    },
    getProfilesForEnvironment: () => [aliased],
    getPublicSite: () => aliased,
  }
}
