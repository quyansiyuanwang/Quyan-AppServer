import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'
import { resolveSiteProfile } from '@/config/site-registry'
import { createRoutesForProfile } from '@/router/routes'
import { resolveCanonicalRouteUrl } from '@/router/routes'

const getKnownProfile = (hostname: string) => {
  const profile = resolveSiteProfile(hostname)
  if (profile.id === 'rejected') throw new Error(`Expected ${hostname} to be registered`)
  return profile
}

const collectRouteNames = (routes: ReturnType<typeof createRoutesForProfile>): string[] =>
  routes.flatMap((route) => [
    ...(typeof route.name === 'string' ? [route.name] : []),
    ...collectRouteNames(route.children ?? []),
  ])

const findRoute = (
  routes: ReturnType<typeof createRoutesForProfile>,
  routeName: string,
): RouteRecordRaw | undefined => {
  for (const route of routes) {
    if (route.name === routeName) return route
    const nestedRoute = findRoute(route.children ?? [], routeName)
    if (nestedRoute) return nestedRoute
  }

  return undefined
}

describe('profile route factory', () => {
  it('keeps only account and shared routes for the account profile', () => {
    const routeNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('account.qysyw.cn')),
    )

    expect(routeNames).toContain('settingsProfile')
    expect(routeNames).toContain('myTickets')
    expect(routeNames).not.toContain('chat')
    expect(routeNames).not.toContain('relaySettings')
    expect(routeNames).not.toContain('login')
  })

  it('makes the identity profile the only profile with authentication routes', () => {
    const identityRouteNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('auth.qysyw.cn')),
    )
    const chatRouteNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('chat.qysyw.cn')),
    )

    expect(identityRouteNames).toEqual(
      expect.arrayContaining(['login', 'register', 'externalAuthCallback']),
    )
    expect(chatRouteNames).toContain('chat')
    expect(chatRouteNames).not.toContain('login')
    expect(chatRouteNames).not.toContain('settingsProfile')
  })

  it('isolates nested console profiles from other operational modules', () => {
    const aiRouteNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('ai.console.qysyw.cn')),
    )
    const terminalRouteNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('terminal.qysyw.cn')),
    )
    const managementAiRouteNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('ai.management.qysyw.cn')),
    )
    const managementTerminalRouteNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('terminal.management.qysyw.cn')),
    )
    const accountRouteNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('account.qysyw.cn')),
    )

    expect(aiRouteNames).toEqual(
      expect.arrayContaining(['relayTokenManagement', 'apiDocumentation', 'relayChannelProvider']),
    )
    expect(aiRouteNames).not.toContain('relaySettings')
    expect(managementAiRouteNames).toContain('relaySettings')
    expect(aiRouteNames).not.toContain('userManagement')
    expect(accountRouteNames).not.toContain('relayTokenManagement')
    expect(terminalRouteNames).toContain('remoteTerminal')
    expect(managementTerminalRouteNames).toEqual(
      expect.arrayContaining([
        'remoteTerminalProductTemplates',
        'remoteTerminalProductEntitlements',
        'remoteTerminalProductDevices',
      ]),
    )
    expect(terminalRouteNames).not.toContain('relaySettings')
  })

  it('exposes the terminal profile default path at its canonical route', () => {
    const terminalRoutes = createRoutesForProfile(getKnownProfile('terminal.qysyw.cn'))
    const landingRoute = findRoute(terminalRoutes, 'terminalOverview')

    expect(landingRoute?.path).toBe('overview')
    expect(findRoute(terminalRoutes, 'root')?.redirect).toBe('/overview')
    expect(collectRouteNames(terminalRoutes)).toEqual(
      expect.arrayContaining(['terminalOverview', 'remoteTerminal', 'myRemoteTerminalProducts']),
    )
  })

  it('redirects every management root entry to the management overview', () => {
    const managementRoutes = createRoutesForProfile(getKnownProfile('management.qysyw.cn'))

    expect(findRoute(managementRoutes, 'root')?.redirect).toBe('/overview')
    expect(findRoute(managementRoutes, 'index')?.redirect).toBe('/overview')
    expect(collectRouteNames(managementRoutes)).toEqual(
      expect.arrayContaining([
        'iamOverview',
        'userManagement',
        'groupManagement',
        'iamAuthorizations',
        'iamPermissionPolicies',
        'iamPermissionDiagnostics',
      ]),
    )
  })

  it('redirects the terminal-management root to its overview', () => {
    const terminalManagementRoutes = createRoutesForProfile(
      getKnownProfile('terminal.management.qysyw.cn'),
    )

    expect(findRoute(terminalManagementRoutes, 'root')?.redirect).toBe('/overview')
    expect(findRoute(terminalManagementRoutes, 'remoteTerminalProductTemplates')?.path).toBe(
      'products/remote-terminal/templates',
    )
    expect(findRoute(terminalManagementRoutes, 'remoteTerminalProductEntitlements')?.path).toBe(
      'products/remote-terminal/entitlements',
    )
    expect(findRoute(terminalManagementRoutes, 'remoteTerminalProductDevices')?.path).toBe(
      'products/remote-terminal/devices',
    )
  })

  it('isolates each product console from account, catalog, and operations routes', () => {
    const productRoutes = createRoutesForProfile(getKnownProfile('verification.console.qysyw.cn'))

    expect(collectRouteNames(productRoutes)).toContain('product-verification')
    expect(collectRouteNames(productRoutes)).not.toContain('product-short_link')
    expect(collectRouteNames(productRoutes)).not.toContain('product-management-verification')
    expect(collectRouteNames(productRoutes)).not.toContain('developerProducts')
    expect(collectRouteNames(productRoutes)).not.toContain('settingsProfile')
    expect(collectRouteNames(productRoutes)).not.toContain('myTickets')
  })

  it('registers all OJ Submitter pages only in the OJ product console', () => {
    const ojRoutes = createRoutesForProfile(getKnownProfile('oj.console.qysyw.cn'))
    const accountRoutes = createRoutesForProfile(getKnownProfile('account.qysyw.cn'))

    expect(collectRouteNames(ojRoutes)).toEqual(
      expect.arrayContaining([
        'ojSubmitterRoot',
        'ojAPIKeyManagement',
        'ojUsageStatistics',
        'ojPricingManagement',
      ]),
    )
    expect(findRoute(ojRoutes, 'root')?.redirect).toBe('/overview')
    expect(collectRouteNames(accountRoutes)).not.toContain('ojAPIKeyManagement')
  })

  it('isolates RAM administration in the RAM console', () => {
    const ramRoutes = createRoutesForProfile(getKnownProfile('ram.console.qysyw.cn'))
    const managementRoutes = createRoutesForProfile(getKnownProfile('management.qysyw.cn'))

    expect(collectRouteNames(ramRoutes)).toEqual(
      expect.arrayContaining([
        'ramOverview',
        'ramManagement',
        'ramRoles',
        'ramBindings',
        'ramPolicies',
        'ramAuthorization',
        'ramSessions',
      ]),
    )
    expect(findRoute(ramRoutes, 'root')?.redirect).toBe('/overview')
    expect(collectRouteNames(ramRoutes)).not.toContain('userManagement')
    expect(collectRouteNames(managementRoutes)).not.toContain('ramManagement')
  })

  it('resolves foreign route names to their registered canonical host', () => {
    const accountProfile = getKnownProfile('account.qysyw.cn')

    expect(resolveCanonicalRouteUrl('relaySettings', accountProfile)).toBe(
      'https://ai.management.qysyw.cn/relay/settings',
    )
    expect(resolveCanonicalRouteUrl('relayTokenManagement', accountProfile)).toBe(
      'https://ai.console.qysyw.cn/relay/tokens',
    )
    expect(resolveCanonicalRouteUrl('settingsProfile', accountProfile)).toBe(
      'https://account.qysyw.cn/settings/profile',
    )

    const localAccountProfile = getKnownProfile('account.qysyw.test')
    expect(resolveCanonicalRouteUrl('settingsProfile', localAccountProfile)).toBe(
      'https://account.qysyw.test:5173/settings/profile',
    )
    expect(resolveCanonicalRouteUrl('userManagement', accountProfile)).toBe(
      'https://management.qysyw.cn/iam/users',
    )
    expect(resolveCanonicalRouteUrl('ramManagement', accountProfile)).toBe(
      'https://ram.console.qysyw.cn/users',
    )
    expect(resolveCanonicalRouteUrl('ramRoles', accountProfile)).toBe(
      'https://ram.console.qysyw.cn/roles',
    )
    expect(resolveCanonicalRouteUrl('remoteTerminal', accountProfile)).toBe(
      'https://terminal.qysyw.cn/workspace',
    )
  })

  it('keeps AI and developer operational deep links in the SPA route catalog', () => {
    const aiConsoleRoutes = createRoutesForProfile(getKnownProfile('ai.console.qysyw.cn'))
    const aiManagementRoutes = createRoutesForProfile(getKnownProfile('ai.management.qysyw.cn'))
    const developerManagementRoutes = createRoutesForProfile(
      getKnownProfile('developer.management.qysyw.cn'),
    )

    expect(findRoute(aiConsoleRoutes, 'relayTokenManagement')?.path).toBe('relay/tokens')
    expect(findRoute(aiManagementRoutes, 'relaySettings')?.path).toBe('relay/settings')
    expect(findRoute(developerManagementRoutes, 'developerServiceManagement')?.path).toBe(
      'services',
    )
  })
})
