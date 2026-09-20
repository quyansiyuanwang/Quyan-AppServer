import { describe, expect, it } from 'vitest'
import { deploymentTopologies } from '@/config/deployment-topology'
import {
  createDevSingleSiteRegistry,
  defaultDevSingleSiteProfile,
  devSingleSiteHostnames,
  isDevSingleSiteProfileId,
  normalizeDevHostname,
  readDevSingleSiteOptions,
  resolveDevSingleSiteProfileId,
} from '@/config/dev-single-site'
import { createSiteRegistry } from '@/config/site-resolver'

const localOrigin = 'http://localhost:5173'
const baseRegistry = createSiteRegistry(deploymentTopologies)

const createLocalhostRegistry = (requestedProfile: string) =>
  createDevSingleSiteRegistry(
    baseRegistry,
    readDevSingleSiteOptions({ dev: true, flag: 'true', requestedProfile }),
    localOrigin,
  )

describe('privilege-free dev single-site mode', () => {
  it('requires both the dev server and an explicit flag', () => {
    expect(readDevSingleSiteOptions({ dev: true, flag: undefined }).enabled).toBe(false)
    expect(readDevSingleSiteOptions({ dev: true, flag: 'false' }).enabled).toBe(false)
    expect(readDevSingleSiteOptions({ dev: false, flag: 'true' }).enabled).toBe(false)
    expect(readDevSingleSiteOptions({ dev: true, flag: 'true' }).enabled).toBe(true)
  })

  it('accepts a profile id or the hostname prefix it is published under', () => {
    expect(isDevSingleSiteProfileId(defaultDevSingleSiteProfile)).toBe(true)
    expect(resolveDevSingleSiteProfileId('management-core')).toBe('management-core')
    expect(resolveDevSingleSiteProfileId('management')).toBe('management-core')
    expect(resolveDevSingleSiteProfileId('account')).toBe('account')
    expect(resolveDevSingleSiteProfileId('noexist')).toBeUndefined()
    expect(resolveDevSingleSiteProfileId('')).toBeUndefined()
    expect(readDevSingleSiteOptions({ dev: true, flag: 'true', requestedProfile: 'management' })).toMatchObject(
      { siteProfileId: 'management-core' },
    )
  })

  it('falls back to the default profile and warns for an unregistered profile id', () => {
    const warnings: string[] = []
    const options = readDevSingleSiteOptions({
      dev: true,
      flag: 'true',
      requestedProfile: 'noexist',
      warn: (message) => warnings.push(message),
    })

    expect(options.siteProfileId).toBe(defaultDevSingleSiteProfile)
    expect(warnings).toHaveLength(1)
  })

  it('normalizes loopback hostnames', () => {
    expect(devSingleSiteHostnames).toContain('localhost')
    expect(normalizeDevHostname('[::1]')).toBe('::1')
    expect(normalizeDevHostname(' LocalHost. ')).toBe('localhost')
  })

  it('aliases one profile onto the browser origin and registers the login routes', () => {
    const registry = createLocalhostRegistry('account')
    const profile = registry.resolveHost('localhost')

    expect(profile).toMatchObject({
      id: 'account',
      canonicalOrigin: localOrigin,
      authOrigin: localOrigin,
    })
    expect(profile.routeGroups).toContain('identity')
    expect(registry.resolveHost('127.0.0.1')).toMatchObject({ id: 'account' })
    expect(registry.resolveHost('[::1]')).toMatchObject({ id: 'account' })
    expect(registry.profiles.map((item) => item.id)).toEqual(['account'])
  })

  it('keeps every other host and origin rejected', () => {
    const registry = createLocalhostRegistry('management')

    expect(registry.resolveHost('management.qysyw.test')).toMatchObject({ id: 'rejected' })
    expect(registry.resolveHost('www.qysyw.cn')).toMatchObject({ id: 'rejected' })
    expect(registry.resolveHost('')).toMatchObject({ id: 'rejected' })
    expect(registry.resolveOrigin('https://management.qysyw.test:5173')).toMatchObject({
      id: 'rejected',
    })
    expect(registry.resolveOrigin('not-an-origin')).toMatchObject({ id: 'rejected' })
    expect(registry.resolveOrigin(localOrigin)).toMatchObject({ id: 'management-core' })
    expect(registry.getPublicSite()).toMatchObject({ id: 'management-core' })
    expect(
      registry.getProfilesForEnvironment(registry.profiles[0]!).map((item) => item.id),
    ).toEqual(['management-core'])
  })

  it('leaves the shared registry closed for non-dev callers', () => {
    expect(baseRegistry.resolveHost('localhost')).toMatchObject({ id: 'rejected' })
    expect(baseRegistry.resolveHost('account.qysyw.test')).toMatchObject({ id: 'account' })
  })
})
