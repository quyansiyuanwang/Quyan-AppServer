import { describe, expect, it } from 'vitest'
import {
  getSiteProfilesForEnvironment,
  getAccessibleSiteProfiles,
  getPublicSiteProfile,
  isKnownSiteProfile,
  normalizeSiteHostname,
  createSiteRegistry,
  resolveSiteProfile,
  resolveSiteProfileFromOrigin,
  siteDefinitions,
  siteProfileIds,
  siteProfiles,
} from '@/config/site-registry'
import { hasDomainViewLoader } from '@/router/domain-view-loader'

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

  it('keeps first-level site navigation in the current environment', () => {
    const localAccount = resolveSiteProfile('account.qysyw.test')
    const productionAccount = resolveSiteProfile('account.qysyw.cn')

    if (!isKnownSiteProfile(localAccount) || !isKnownSiteProfile(productionAccount)) {
      throw new Error('Expected account profiles to be registered')
    }

    const localProfiles = getSiteProfilesForEnvironment(localAccount)
    const productionProfiles = getSiteProfilesForEnvironment(productionAccount)

    expect(localProfiles).toHaveLength(siteDefinitions.length - 1)
    expect(localProfiles.every((profile) => profile.hostname.endsWith('.test'))).toBe(true)
    expect(localProfiles.every((profile) => profile.canonicalOrigin.endsWith(':5173'))).toBe(true)
    expect(localProfiles.some((profile) => profile.id === 'identity')).toBe(false)
    expect(localProfiles.some((profile) => profile.id === 'product-json_endpoint')).toBe(true)
    expect(productionProfiles).toHaveLength(siteDefinitions.length - 1)
    expect(productionProfiles.every((profile) => profile.hostname.endsWith('.cn'))).toBe(true)
    expect(productionProfiles.every((profile) => !profile.canonicalOrigin.includes(':5173'))).toBe(
      true,
    )
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

  it('derives site visibility from the same navigation permissions as the sidebar', () => {
    const account = resolveSiteProfile('account.qysyw.cn')
    if (!isKnownSiteProfile(account)) throw new Error('Expected account profile')

    const withSupportPermission = getAccessibleSiteProfiles(account, ['support:ai:config'])
    expect(withSupportPermission.map((item) => item.id)).toContain('management-core')

    const withoutManagementPermission = getAccessibleSiteProfiles(account, ['ticket:submit'])
    expect(withoutManagementPermission.map((item) => item.id)).not.toContain('management-ai')
    expect(withoutManagementPermission.map((item) => item.id)).toContain('account')
  })

  it('assigns every deployment host to a distinct domain app', () => {
    for (const deploymentId of ['release', 'staging'] as const) {
      const profiles = siteProfiles.filter((profile) => profile.deploymentId === deploymentId)
      expect(new Set(profiles.map((profile) => profile.app)).size).toBe(profiles.length)
    }
    expect(resolveSiteProfile('console.qysyw.cn')).toMatchObject({ id: 'rejected' })
  })

  it('derives profile IDs from the site registry', () => {
    expect(siteProfileIds).toEqual(siteDefinitions.map((definition) => definition.id))
  })

  it('discovers a route-view plugin for every site profile', () => {
    for (const siteId of siteProfileIds) {
      expect(hasDomainViewLoader(siteId), siteId).toBe(true)
    }
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
    expect(resolveSiteProfile('noexist.qysyw.cn')).toMatchObject({
      id: 'rejected',
      hostname: 'noexist.qysyw.cn',
    })
  })

  it('resolves the canonical public site for rejected release and local hosts', () => {
    expect(getPublicSiteProfile('noexist.qysyw.cn')).toMatchObject({
      id: 'public',
      canonicalOrigin: 'https://www.qysyw.cn',
    })
    expect(getPublicSiteProfile('noexist.qysyw.test')).toMatchObject({
      id: 'public',
      canonicalOrigin: 'https://www.qysyw.test:5173',
    })
    expect(getPublicSiteProfile('noexist.staging.qysyw.cn')).toMatchObject({
      id: 'public',
      canonicalOrigin: 'https://staging.qysyw.cn',
    })
  })

  it('registers staging hosts as a closed deployment family', () => {
    const staging = resolveSiteProfile('staging.qysyw.cn')
    const stagingAccount = resolveSiteProfile('account.staging.qysyw.cn')
    if (!isKnownSiteProfile(staging) || !isKnownSiteProfile(stagingAccount)) {
      throw new Error('Expected staging site profiles to be registered')
    }

    expect(staging).toMatchObject({ id: 'public', deploymentId: 'staging' })
    expect(stagingAccount).toMatchObject({ id: 'account', deploymentId: 'staging' })
    expect(
      getSiteProfilesForEnvironment(stagingAccount).every(
        (profile) =>
          profile.hostname === 'staging.qysyw.cn' || profile.hostname.endsWith('.staging.qysyw.cn'),
      ),
    ).toBe(true)
    expect(resolveSiteProfile('noexist.staging.qysyw.cn')).toMatchObject({ id: 'rejected' })
  })

  it('uses an injected staging topology without accepting arbitrary delegated roots', () => {
    const registry = createSiteRegistry([
      {
        id: 'release',
        platformRootDomain: 'qysyw.cn',
        siteRootDomain: 'staging.qysyw.cn',
        publicHostname: 'staging.qysyw.cn',
        protocol: 'https',
      },
    ])

    expect(registry.resolveHost('auth.staging.qysyw.cn')).toMatchObject({
      id: 'identity',
      canonicalOrigin: 'https://auth.staging.qysyw.cn',
    })
    expect(registry.resolveHost('ai.console.staging.qysyw.cn')).toMatchObject({
      id: 'console-ai',
      canonicalOrigin: 'https://ai.console.staging.qysyw.cn',
    })
    expect(registry.resolveHost('noexist.qysyw.cn')).toMatchObject({ id: 'rejected' })
    expect(registry.getPublicSite('noexist.qysyw.cn')).toMatchObject({
      canonicalOrigin: 'https://staging.qysyw.cn',
    })
  })
})
