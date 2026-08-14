import { describe, expect, it } from 'vitest'
import {
  getSiteProfilesForEnvironment,
  getAccessibleSiteProfiles,
  isKnownSiteProfile,
  normalizeSiteHostname,
  resolveSiteProfile,
  resolveSiteProfileFromOrigin,
  siteDefinitions,
  siteProfileIds,
  siteProfiles,
} from '@/config/site-registry'

describe('site registry', () => {
  it('resolves explicitly registered production and nested console hosts', () => {
    const profile = resolveSiteProfile('AI.CONSOLE.QYSYW.CN.')

    expect(profile).toMatchObject({
      id: 'console-ai',
      hostname: 'ai.console.qysyw.cn',
      canonicalOrigin: 'https://ai.console.qysyw.cn',
      authOrigin: 'https://auth.qysyw.cn',
      shell: 'console',
    })
    expect(profile.routeGroups).toEqual(['console-ai', 'shared'])
  })

  it('resolves every local hostname through the same exact registry', () => {
    const profile = resolveSiteProfile('developer.console.qysyw.test')

    expect(profile).toMatchObject({
      id: 'console-developer',
      canonicalOrigin: 'https://developer.console.qysyw.test:5173',
      authOrigin: 'https://auth.qysyw.test:5173',
    })
  })

  it('derives delegated production roots from the current hostname', () => {
    expect(resolveSiteProfile('terminal.md.qysyw.cn')).toMatchObject({
      id: 'terminal',
      hostname: 'terminal.md.qysyw.cn',
      canonicalOrigin: 'https://terminal.md.qysyw.cn',
      authOrigin: 'https://auth.md.qysyw.cn',
    })
    expect(resolveSiteProfile('md.qysyw.cn')).toMatchObject({
      id: 'public',
      hostname: 'md.qysyw.cn',
      canonicalOrigin: 'https://md.qysyw.cn',
    })
    expect(resolveSiteProfileFromOrigin('https://auth.md.qysyw.cn')).toMatchObject({
      id: 'identity',
      canonicalOrigin: 'https://auth.md.qysyw.cn',
    })
  })

  it('keeps first-level site navigation in the current environment', () => {
    const localAccount = resolveSiteProfile('account.qysyw.test')
    const productionAccount = resolveSiteProfile('account.qysyw.cn')

    if (!isKnownSiteProfile(localAccount) || !isKnownSiteProfile(productionAccount)) {
      throw new Error('Expected account profiles to be registered')
    }

    const localProfiles = getSiteProfilesForEnvironment(localAccount)
    const productionProfiles = getSiteProfilesForEnvironment(productionAccount)

    expect(localProfiles).toHaveLength(19)
    expect(localProfiles.every((profile) => profile.hostname.endsWith('.test'))).toBe(true)
    expect(localProfiles.every((profile) => profile.canonicalOrigin.endsWith(':5173'))).toBe(true)
    expect(localProfiles.some((profile) => profile.id === 'identity')).toBe(false)
    expect(productionProfiles).toHaveLength(19)
    expect(productionProfiles.every((profile) => profile.hostname.endsWith('.cn'))).toBe(true)
    expect(productionProfiles.every((profile) => !profile.canonicalOrigin.includes(':5173'))).toBe(
      true,
    )
  })

  it('keeps delegated-root navigation on the same inferred deployment root', () => {
    const terminal = resolveSiteProfile('terminal.md.qysyw.cn')
    if (!isKnownSiteProfile(terminal)) throw new Error('Expected delegated terminal profile')

    const profiles = getSiteProfilesForEnvironment(terminal)
    expect(profiles).toHaveLength(19)
    expect(
      profiles.every(
        (profile) =>
          profile.hostname === 'md.qysyw.cn' || profile.hostname.endsWith('.md.qysyw.cn'),
      ),
    ).toBe(true)
    expect(profiles.find((profile) => profile.id === 'public')).toMatchObject({
      hostname: 'md.qysyw.cn',
    })
  })

  it('registers product consoles and hides inaccessible profiles from navigation', () => {
    const profile = resolveSiteProfile('oj.console.qysyw.cn')
    const account = resolveSiteProfile('account.qysyw.cn')
    if (!isKnownSiteProfile(profile) || !isKnownSiteProfile(account)) {
      throw new Error('Expected product and account profiles to be registered')
    }

    expect(profile).toMatchObject({
      id: 'product-oj',
      hostname: 'oj.console.qysyw.cn',
      defaultPath: '/overview',
      kind: 'product',
    })

    const accessible = getAccessibleSiteProfiles(account, [profile.accessPermissions[0]!])
    expect(accessible.map((item) => item.id)).toContain('product-oj')
    expect(accessible.map((item) => item.id)).not.toContain('management-core')
  })

  it('assigns every production host to a distinct domain app', () => {
    const productionProfiles = siteProfiles.filter((profile) => profile.hostname.endsWith('.cn'))

    expect(new Set(productionProfiles.map((profile) => profile.app)).size).toBe(
      productionProfiles.length,
    )
    expect(resolveSiteProfile('console.qysyw.cn')).toMatchObject({ id: 'rejected' })
  })

  it('derives profile IDs from the site registry', () => {
    expect(siteProfileIds).toEqual(siteDefinitions.map((definition) => definition.id))
  })

  it('accepts only registered canonical origins and normalizes default ports', () => {
    expect(resolveSiteProfileFromOrigin('HTTPS://auth.qysyw.cn:443')).toMatchObject({
      id: 'identity',
    })
    expect(resolveSiteProfileFromOrigin('https://auth.qysyw.cn:8443')).toMatchObject({
      id: 'rejected',
    })
    expect(resolveSiteProfileFromOrigin('https://auth.qysyw.cn/login')).toMatchObject({
      id: 'rejected',
    })
    expect(resolveSiteProfileFromOrigin('https://auth.qysyw.test:5173')).toMatchObject({
      id: 'identity',
    })
  })

  it('rejects unregistered and malformed hosts without suffix matching', () => {
    const profile = resolveSiteProfile('unregistered.console.qysyw.cn')

    expect(profile).toMatchObject({ id: 'rejected', hostname: 'unregistered.console.qysyw.cn' })
    expect(isKnownSiteProfile(profile)).toBe(false)
    expect(normalizeSiteHostname('auth.qysyw.cn:443')).toBeUndefined()
    expect(normalizeSiteHostname('https://auth.qysyw.cn')).toBeUndefined()
    expect(resolveSiteProfile('terminal.console.qysyw.cn')).toMatchObject({ id: 'rejected' })
  })
})
