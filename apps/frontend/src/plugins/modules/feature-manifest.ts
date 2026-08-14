import type { ResolvedSiteProfile, SiteProfileId } from '@/config/site-registry'
import { routeCatalog } from '@/router/route-catalog'

export interface FeatureManifestEntry {
  id: string
  siteId: SiteProfileId
  routeName: string
  path: string
}

/**
 * The only lightweight index shared by routing, navigation and global search.
 * It contains no component, service or store import.
 */
export const getFeatureManifestEntries = (siteId: SiteProfileId): readonly FeatureManifestEntry[] =>
  routeCatalog
    .filter((entry) => entry.group === siteId || entry.group === 'shared')
    .map((entry) => ({
      id: `${siteId}:${entry.name}`,
      siteId,
      routeName: entry.name,
      path: entry.path,
    }))

export const hasFeatureRoute = (
  profile: Pick<ResolvedSiteProfile, 'id'>,
  routeName: string,
): boolean =>
  profile.id !== 'rejected' &&
  getFeatureManifestEntries(profile.id).some((entry) => entry.routeName === routeName)
