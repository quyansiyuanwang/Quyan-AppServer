import type { Permission } from '@/constant/permission'
import type { SiteProfileId } from './site-catalog'
import { navigationMenuDefinition, type NavigationNode } from './navigation-catalog'
import { getRouteCatalogEntry } from '@/router/route-catalog'

interface SiteNavigationAccess {
  /** Empty means the site has at least one public-to-authenticated navigation entry. */
  permissions: readonly Permission[]
  open: boolean
}

const accessBySite = new Map<SiteProfileId, SiteNavigationAccess>()

const collect = (
  nodes: readonly NavigationNode[],
  siteId: SiteProfileId,
  result: {
    permissions: Permission[]
    open: boolean
  },
) => {
  for (const node of nodes) {
    if (node.route) {
      const entry = getRouteCatalogEntry(node.route)
      if (entry?.group === siteId) {
        if (!node.permissions?.length) result.open = true
        else result.permissions.push(...node.permissions)
      }
    }
    if (node.children) collect(node.children, siteId, result)
  }
}

export const getSiteNavigationAccess = (siteId: SiteProfileId): SiteNavigationAccess => {
  const cached = accessBySite.get(siteId)
  if (cached) return cached

  const result = { permissions: [], open: false }
  collect(navigationMenuDefinition, siteId, result)
  const access = {
    permissions: [...new Set(result.permissions)],
    open: result.open,
  } satisfies SiteNavigationAccess
  accessBySite.set(siteId, access)
  return access
}

export const getSiteNavigationPermissions = (siteId: SiteProfileId): readonly Permission[] =>
  getSiteNavigationAccess(siteId).permissions

export const hasSiteNavigationAccess = (
  siteId: SiteProfileId,
  effectivePermissions: readonly string[],
): boolean => {
  const access = getSiteNavigationAccess(siteId)
  if (access.open) return true
  const permissionSet = new Set(effectivePermissions)
  return access.permissions.some((permission) => permissionSet.has(permission))
}
