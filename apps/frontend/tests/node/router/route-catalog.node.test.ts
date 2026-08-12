import { describe, expect, it } from 'vitest'
import { resolveSiteProfile, siteProfiles } from '@/config/site-registry'
import { createRoutesForProfile } from '@/router/routes'
import type { RouteRecordRaw } from 'vue-router'
import { getRouteCatalogEntry, resolveRouteMigration, routeCatalog } from '@/router/route-catalog'
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

  it('uses a registered default path for every site profile', () => {
    for (const profile of siteProfiles) {
      expect(profile.defaultPath).toMatch(/^\//)
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
    expect(resolveRouteMigration('/access-keys', account)).toEqual({
      profileId: 'account',
      path: '/settings/security',
    })
    expect(resolveRouteMigration('/relay/settings', account)).toEqual({
      profileId: 'management-ai',
      path: '/relay/settings',
    })
    expect(resolveRouteMigration('/relay/tokens', account)).toEqual({
      profileId: 'console-ai',
      path: '/relay/tokens',
    })
    expect(resolveRouteMigration('/iam/ram', getKnownProfile('management.qysyw.test'))).toEqual({
      profileId: 'console-ram',
      path: '/users',
    })
    expect(resolveRouteMigration('/iam/roles', getKnownProfile('management.qysyw.test'))).toEqual({
      profileId: 'console-ram',
      path: '/roles',
    })
    expect(
      resolveRouteMigration('/iam/permissions', getKnownProfile('management.qysyw.test')),
    ).toEqual({
      profileId: 'management-core',
      path: '/iam/authorizations',
    })
    expect(resolveRouteMigration('/short-link/analytics/team-a/link-b', account)).toEqual({
      profileId: 'product-short_link',
      path: '/links/team-a/link-b/analytics',
    })
    expect(resolveRouteMigration('/oj/apikeys', account)).toEqual({
      profileId: 'product-oj',
      path: '/api-keys',
    })
    expect(
      resolveRouteMigration(
        '/products/remote-terminal-cloud',
        getKnownProfile('terminal.qysyw.test'),
      ),
    ).toEqual({
      profileId: 'terminal',
      path: '/subscriptions',
    })
    expect(
      resolveRouteMigration(
        '/products/remote-terminal',
        getKnownProfile('terminal.management.qysyw.test'),
      ),
    ).toEqual({
      profileId: 'management-terminal',
      path: '/products/remote-terminal/templates',
    })
  })

  it('builds same-environment migration URLs and preserves query/hash', () => {
    const account = getKnownProfile('account.qysyw.test')

    expect(
      resolveRouteMigrationUrl('/management/permissions', '?tab=roles', '#member-1', account),
    ).toBe('https://management.qysyw.test:5173/iam/authorizations?tab=roles#member-1')
    expect(resolveRouteMigrationUrl('/oj/usage', '?range=30d', '#requests', account)).toBe(
      'https://oj.console.qysyw.test:5173/usage?range=30d#requests',
    )
    expect(
      resolveRouteMigrationUrl(
        '/oj/usage',
        '?range=30d&access_token=secret&return_url=https%3A%2F%2Fevil.example',
        '',
        account,
      ),
    ).toBe('https://oj.console.qysyw.test:5173/usage?range=30d')
    expect(resolveRouteMigrationUrl('/not-a-route', '', '', account)).toBeUndefined()
  })

  it('does not migrate a canonical path that already belongs to the current profile', () => {
    const terminal = getKnownProfile('terminal.qysyw.cn')
    expect(resolveRouteMigration('/overview', terminal)).toBeUndefined()

    const ram = getKnownProfile('ram.console.qysyw.cn')
    expect(resolveRouteMigration('/overview', ram)).toBeUndefined()
  })
})
