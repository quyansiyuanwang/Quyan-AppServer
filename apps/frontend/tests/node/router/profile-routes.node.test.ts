import { describe, expect, it } from 'vitest'
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
): { path: string } | undefined => {
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
      createRoutesForProfile(getKnownProfile('terminal.console.qysyw.cn')),
    )
    const managementAiRouteNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('ai.management.qysyw.cn')),
    )
    const managementTerminalRouteNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('terminal.management.qysyw.cn')),
    )
    const developerRouteNames = collectRouteNames(
      createRoutesForProfile(getKnownProfile('developer.qysyw.cn')),
    )

    expect(aiRouteNames).toEqual(
      expect.arrayContaining(['relayTokenManagement', 'apiDocumentation', 'relayChannelProvider']),
    )
    expect(aiRouteNames).not.toContain('relaySettings')
    expect(managementAiRouteNames).toContain('relaySettings')
    expect(aiRouteNames).not.toContain('userManagement')
    expect(developerRouteNames).not.toContain('relayTokenManagement')
    expect(terminalRouteNames).toContain('remoteTerminal')
    expect(managementTerminalRouteNames).toContain('remoteTerminalProductManagement')
    expect(terminalRouteNames).not.toContain('relaySettings')
  })

  it('exposes the terminal profile default path at its canonical route', () => {
    const terminalRoutes = createRoutesForProfile(getKnownProfile('terminal.qysyw.cn'))
    const landingRoute = findRoute(terminalRoutes, 'myRemoteTerminalProducts')

    expect(landingRoute?.path).toBe('products/remote-terminal-cloud')
    expect(collectRouteNames(terminalRoutes)).toContain('myRemoteTerminalProducts')
  })

  it('gives the general console an isolated user dashboard', () => {
    const consoleRoutes = createRoutesForProfile(getKnownProfile('console.qysyw.cn'))

    expect(collectRouteNames(consoleRoutes)).toContain('consoleDashboard')
    expect(collectRouteNames(consoleRoutes)).not.toContain('userManagement')
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
    expect(resolveCanonicalRouteUrl('remoteTerminal', accountProfile)).toBe(
      'https://terminal.console.qysyw.cn/console',
    )
  })
})
