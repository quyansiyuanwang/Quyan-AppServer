import { siteProfiles, type SiteProfile } from '@/config/site-registry'
import { resolveRouteMigration } from '@/router/route-catalog'

/** Resolves a legacy or misplaced URL to the canonical site in the same environment. */
export const resolveRouteMigrationUrl = (
  pathname: string,
  search: string,
  hash: string,
  profile: SiteProfile,
): string | undefined => {
  const migration = resolveRouteMigration(pathname, profile)
  if (!migration || migration.profileId === 'shared') return undefined

  const hostnameSuffix = profile.hostname.endsWith('.test') ? '.test' : '.cn'
  const targetProfile = siteProfiles.find(
    (candidate) =>
      candidate.id === migration.profileId && candidate.hostname.endsWith(hostnameSuffix),
  )
  if (!targetProfile) return undefined

  const target = new URL(migration.path, targetProfile.canonicalOrigin)
  target.search = search
  target.hash = hash
  return target.toString()
}
