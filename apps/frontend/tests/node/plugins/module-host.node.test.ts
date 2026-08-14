import { describe, expect, it, vi } from 'vitest'
import { resolveSiteProfile } from '@/config/site-registry'
import { ModuleHost } from '@/plugins/modules'
import type { FeatureModule, SiteModule } from '@/plugins/modules'

const profile = resolveSiteProfile('account.qysyw.cn')
if (profile.id === 'rejected') throw new Error('Expected a known account profile')

const router = {} as never

describe('ModuleHost', () => {
  it('coalesces concurrent site loads and validates the site identity', async () => {
    const load = vi.fn(async () => ({
      default: {
        id: 'account',
        loadApp: async () => ({}) as never,
        loadRoutes: async () => [],
        features: [],
      } satisfies SiteModule,
    }))
    const host = new ModuleHost({ account: load })

    const [first, second] = await Promise.all([host.loadSite(profile), host.loadSite(profile)])

    expect(first).toBe(second)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('coalesces feature loading and disposes the active feature before switching', async () => {
    const dispose = vi.fn()
    const activate = vi.fn()
    const feature: FeatureModule = {
      id: 'account:settings',
      siteId: 'account',
      routeNames: ['settingsProfile'],
      paths: ['/settings/profile'],
      load: vi.fn(async () => ({ activate, dispose })),
    }
    const secondFeature: FeatureModule = {
      id: 'account:billing',
      siteId: 'account',
      routeNames: ['balanceHistory'],
      paths: ['/billing/balance'],
      load: vi.fn(async () => ({})),
    }
    const host = new ModuleHost({
      account: async () => ({
        default: {
          id: 'account',
          loadApp: async () => ({}) as never,
          loadRoutes: async () => [],
          features: [feature, secondFeature],
        },
      }),
    })

    await Promise.all([
      host.activateRoute(router, profile, 'settingsProfile'),
      host.activateRoute(router, profile, 'settingsProfile'),
    ])
    await host.activateRoute(router, profile, 'balanceHistory')

    expect(feature.load).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
