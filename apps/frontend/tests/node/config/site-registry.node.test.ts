import { describe, expect, it } from 'vitest'
import {
  getSiteProfilesForEnvironment,
  isKnownSiteProfile,
  normalizeSiteHostname,
  resolveSiteProfile,
  resolveSiteProfileFromOrigin,
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

  it('keeps first-level site navigation in the current environment', () => {
    const localAccount = resolveSiteProfile('account.qysyw.test')
    const productionAccount = resolveSiteProfile('account.qysyw.cn')

    if (!isKnownSiteProfile(localAccount) || !isKnownSiteProfile(productionAccount)) {
      throw new Error('Expected account profiles to be registered')
    }

    const localProfiles = getSiteProfilesForEnvironment(localAccount)
    const productionProfiles = getSiteProfilesForEnvironment(productionAccount)

    expect(localProfiles).toHaveLength(13)
    expect(localProfiles.every((profile) => profile.hostname.endsWith('.test'))).toBe(true)
    expect(localProfiles.every((profile) => profile.canonicalOrigin.endsWith(':5173'))).toBe(true)
    expect(localProfiles.some((profile) => profile.id === 'identity')).toBe(false)
    expect(productionProfiles).toHaveLength(13)
    expect(productionProfiles.every((profile) => profile.hostname.endsWith('.cn'))).toBe(true)
    expect(productionProfiles.every((profile) => !profile.canonicalOrigin.includes(':5173'))).toBe(
      true,
    )
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
  })
})
