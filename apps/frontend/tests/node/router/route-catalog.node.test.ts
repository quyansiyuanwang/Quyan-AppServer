import { describe, expect, it } from 'vitest'
import { resolveSiteProfile, siteProfiles } from '@/config/site-registry'
import { createRoutesForProfile } from '@/router/routes'
import type { RouteRecordRaw } from 'vue-router'
import { getRouteCatalogEntry, resolveRouteMigration, routeCatalog } from '@/router/route-catalog'
import { resolveRouteMigrationUrl } from '@/router/route-migration'
import { siteOverviewMetricProfileIds } from '@/config/site-overview'
import { siteOverviewFeatures } from '@/config/site-overview-features'

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

const collectRouteNames = (routes: readonly RouteRecordRaw[]): Set<string> => {
  const names = new Set<string>()
  for (const route of routes) {
    if (typeof route.name === 'string') names.add(route.name)
    for (const name of collectRouteNames(route.children ?? [])) names.add(name)
  }
  return names
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
      const routes = createRoutesForProfile(profile)
      const root = routes
        .flatMap((route) => [route, ...(route.children ?? [])])
        .find((route) => route.name === 'root')
      expect(root?.redirect).toBe(profile.defaultPath)
    }
  })

  it('provides an overview route for every site profile', () => {
    for (const profile of siteProfiles) {
      const routeNames = collectRouteNames(createRoutesForProfile(profile))
      expect([...routeNames].some((name) => name.toLowerCase().includes('overview'))).toBe(true)
    }
  })

  it('uses a data overview projection for every non-terminal site profile', () => {
    const metricProfiles = new Set<string>(siteOverviewMetricProfileIds)

    for (const profile of siteProfiles) {
      if (profile.id === 'terminal') continue
      expect(metricProfiles.has(profile.id), profile.id).toBe(true)
    }
  })

  it('keeps every overview feature preview bound to a route on its owning site', () => {
    const featureKeys = new Set<string>()

    for (const feature of siteOverviewFeatures) {
      const entry = getRouteCatalogEntry(feature.route)
      expect(entry, feature.route).toBeDefined()

      for (const profileId of feature.profiles) {
        const key = `${profileId}:${feature.route}`
        expect(featureKeys.has(key), `Duplicate feature preview: ${key}`).toBe(false)
        featureKeys.add(key)
        expect(entry?.group, feature.route).toBe(profileId)
        const profile = siteProfiles.find((candidate) => candidate.id === profileId)
        expect(profile, profileId).toBeDefined()
        expect(collectRouteNames(createRoutesForProfile(profile!))).toContain(feature.route)
      }
    }
  })

  it('covers every non-overview leaf exposed through a site sidebar category', () => {
    const sidebarRedirectAliases = new Set(['permission'])

    for (const profile of siteProfiles) {
      const expectedRoutes = routeCatalog
        .filter(
          (entry) =>
            profile.routeGroups.includes(entry.group) &&
            Boolean(entry.overviewCategory) &&
            entry.path !== '/overview' &&
            !entry.path.includes(':') &&
            !sidebarRedirectAliases.has(entry.name),
        )
        .map((entry) => entry.name)

      const previewRoutes = siteOverviewFeatures
        .filter((feature) => feature.profiles.includes(profile.id))
        .map((feature) => feature.route)

      for (const route of expectedRoutes) {
        expect(previewRoutes, `${profile.id}:${route}`).toContain(route)
      }
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
    const publicProfile = getKnownProfile('www.qysyw.test')
    expect(resolveRouteMigrationUrl('/home', '', '', publicProfile)).toBeUndefined()

    const terminal = getKnownProfile('terminal.qysyw.cn')
    expect(resolveRouteMigration('/overview', terminal)).toBeUndefined()

    const ram = getKnownProfile('ram.console.qysyw.cn')
    expect(resolveRouteMigration('/overview', ram)).toBeUndefined()
  })

  it('keeps OAuth authorize query parameters on the identity profile', () => {
    // Visiting the identity site's own canonical /oauth/authorize is not a
    // cross-site migration, so sanitizeMigrationSearch must not strip the
    // legitimate redirect_uri/state/code_challenge request parameters. A full
    // OAuth authorize URL is exactly what an auth-entry route receives.
    const identity = getKnownProfile('auth.qysyw.test')
    const search =
      '?response_type=code&client_id=quyan-cli' +
      '&redirect_uri=http%3A%2F%2F127.0.0.1%3A40016%2Fcallback' +
      '&scope=profile&state=abc&code_challenge=xyz&code_challenge_method=S256'
    expect(resolveRouteMigrationUrl('/oauth/authorize', search, '', identity)).toBeUndefined()
  })
})
