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

    expect(aiRouteNames).toContain('relaySettings')
    expect(aiRouteNames).not.toContain('userManagement')
    expect(terminalRouteNames).toContain('remoteTerminalProductManagement')
    expect(terminalRouteNames).not.toContain('relaySettings')
  })

  it('resolves foreign route names to their registered canonical host', () => {
    const accountProfile = getKnownProfile('account.qysyw.cn')

    expect(resolveCanonicalRouteUrl('relaySettings', accountProfile)).toBe(
      'https://ai.console.qysyw.cn/relay/settings',
    )
    expect(resolveCanonicalRouteUrl('settingsProfile', accountProfile)).toBe(
      'https://account.qysyw.cn/settings/profile',
    )

    const localAccountProfile = getKnownProfile('account.qysyw.test')
    expect(resolveCanonicalRouteUrl('settingsProfile', localAccountProfile)).toBe(
      'https://account.qysyw.test:5173/settings/profile',
    )
  })
})
