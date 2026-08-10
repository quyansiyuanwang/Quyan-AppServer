import { describe, expect, it } from 'vitest'
import { resolveSiteProfile, siteProfiles } from '@/config/site-registry'
import { createRoutesForProfile } from '@/router/routes'
import type { RouteRecordRaw } from 'vue-router'
import {
  getRouteCatalogEntry,
  resolveRouteMigration,
  routeCatalog,
  siteProfileDefaultPaths,
} from '@/router/route-catalog'
import { resolveRouteMigrationUrl } from '@/router/route-migration'

const getKnownProfile = (hostname: string) => {
  const profile = resolveSiteProfile(hostname)
  if (profile.id === 'rejected') throw new Error(`Expected ${hostname} to be registered`)
  return profile
}

const joinPath = (parentPath: string, childPath: string): string => {
  if (childPath.startsWith('/')) return childPath
  const joined = `${parentPath.replace(/\/$/, '')}/${childPath}`.replace(/\/+/g, '/')
  return joined.length > 1 ? joined.replace(/\/$/, '') : '/'
}

const collectRoutePaths = (
  routes: readonly RouteRecordRaw[],
  parentPath = '',
): Map<string, string> => {
  const paths = new Map<string, string>()

  for (const route of routes) {
    const path = joinPath(parentPath, route.path)
    if (typeof route.name === 'string') paths.set(route.name, path)
    for (const [name, childPath] of collectRoutePaths(route.children ?? [], path)) {
      paths.set(name, childPath)
    }
  }

  return paths
}

describe('route catalog', () => {
  it('provides a route group and canonical path for every registered route', () => {
    for (const entry of routeCatalog) {
      expect(getRouteCatalogEntry(entry.name)).toEqual(entry)
      expect(entry.path).toMatch(/^\//)
      expect(entry.group).toBeTruthy()
    }
  })

  it('uses the catalog default for every site profile', () => {
    for (const profile of siteProfiles) {
      expect(profile.defaultPath).toBe(siteProfileDefaultPaths[profile.id])
    }
  })

  it('registers each catalog route only in its owning profile at the canonical path', () => {
    const productionProfiles = siteProfiles.filter((profile) => profile.hostname.endsWith('.cn'))

    for (const entry of routeCatalog) {
      for (const profile of productionProfiles) {
        const paths = collectRoutePaths(createRoutesForProfile(profile))
        if (profile.routeGroups.includes(entry.group)) {
          expect(paths.get(entry.name), `${entry.name} on ${profile.id}`).toBe(entry.path)
        } else {
          expect(paths.has(entry.name), `${entry.name} on ${profile.id}`).toBe(false)
        }
      }
    }
  })

  it('migrates legacy paths and misplaced canonical paths without losing parameters', () => {
    const account = getKnownProfile('account.qysyw.test')

    expect(resolveRouteMigration('/account/balance', account)).toEqual({
      profileId: 'account',
      path: '/billing/balance',
    })
    expect(resolveRouteMigration('/relay/settings', account)).toEqual({
      profileId: 'console-ai',
      path: '/relay/settings',
    })
    expect(resolveRouteMigration('/short-link/analytics/team-a/link-b', account)).toEqual({
      profileId: 'console-developer',
      path: '/products/short_link/analytics/team-a/link-b',
    })
  })

  it('builds same-environment migration URLs and preserves query/hash', () => {
    const account = getKnownProfile('account.qysyw.test')

    expect(resolveRouteMigrationUrl('/management/users', '?tab=roles', '#member-1', account)).toBe(
      'https://console.qysyw.test:5173/iam/users?tab=roles#member-1',
    )
    expect(resolveRouteMigrationUrl('/not-a-route', '', '', account)).toBeUndefined()
  })

  it('does not migrate a canonical path that already belongs to the current profile', () => {
    const terminal = getKnownProfile('terminal.qysyw.cn')
    expect(resolveRouteMigration('/products/remote-terminal-cloud', terminal)).toBeUndefined()
  })
})
