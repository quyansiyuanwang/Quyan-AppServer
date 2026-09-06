import { getSiteProfileForEnvironment, type SiteProfile } from '@/config/site-registry'
import { resolveRouteMigration } from '@/router/route-catalog'

/**
 * Query parameters that should be stripped during cross-site migration to prevent
 * credential leakage from one subdomain to another.
 */
const unsafeMigrationQueryKeys = new Set([
  'token',
  'access_token',
  'refresh_token',
  'redirect',
  'return',
  'return_url',
  'returnurl',
])

/**
 * Routes that require their query parameters to be preserved during cross-site
 * migration because those parameters are part of the protocol/flow, not leaked credentials.
 *
 * Examples:
 * - OAuth authorize endpoints need redirect_uri, state, code_challenge for the OAuth flow
 * - Payment callback endpoints need order_id, payment_status for transaction tracking
 */
const routesRequiringQueryPreservation = new Set([
  '/oauth/authorize',
])

const sanitizeMigrationSearch = (search: string): string => {
  const params = new URLSearchParams(search)
  for (const key of [...params.keys()]) {
    if (unsafeMigrationQueryKeys.has(key.toLowerCase())) params.delete(key)
  }
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

/** Resolves a legacy or misplaced URL to the canonical site in the same environment. */
export const resolveRouteMigrationUrl = (
  pathname: string,
  search: string,
  hash: string,
  profile: SiteProfile,
): string | undefined => {
  const migration = resolveRouteMigration(pathname, profile)
  if (!migration || migration.profileId === 'shared') return undefined

  // A catalog entry that maps the current path to the current profile's own
  // canonical path is not a real migration: the visitor is already on the
  // destination site. Returning early (instead of after sanitizing the query)
  // keeps legitimate request parameters intact.
  if (migration.profileId === profile.id && migration.path === pathname) return undefined

  const targetProfile = getSiteProfileForEnvironment(migration.profileId, profile)
  if (!targetProfile) return undefined

  const target = new URL(migration.path, targetProfile.canonicalOrigin)

  // Preserve query parameters for routes that require them as part of their protocol
  // (e.g., OAuth flows, payment callbacks). Strip potentially leaked credentials for all others.
  target.search = routesRequiringQueryPreservation.has(pathname)
    ? search
    : sanitizeMigrationSearch(search)

  target.hash = hash
  const current = new URL(pathname, profile.canonicalOrigin)
  current.search = search
  current.hash = hash

  // A catalog entry can describe the current site's canonical URL. Returning
  // it would make the navigation guard repeatedly replace the page with itself.
  if (target.toString() === current.toString()) return undefined

  return target.toString()
}
