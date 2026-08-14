import { describe, expect, it } from 'vitest'
import { getFeatureManifestEntries, hasFeatureRoute } from '@/plugins/modules'
import { resolveSiteProfile } from '@/config/site-registry'

describe('feature manifest', () => {
  it('is the shared route availability index for each site', () => {
    const account = resolveSiteProfile('account.qysyw.cn')
    const consoleAi = resolveSiteProfile('ai.console.qysyw.cn')
    if (account.id === 'rejected' || consoleAi.id === 'rejected') {
      throw new Error('Expected registered site profiles')
    }

    expect(getFeatureManifestEntries('account').map((entry) => entry.routeName)).toEqual(
      expect.arrayContaining(['settingsProfile', 'myTickets']),
    )
    expect(hasFeatureRoute(account, 'relayTokenManagement')).toBe(false)
    expect(hasFeatureRoute(consoleAi, 'relayTokenManagement')).toBe(true)
    expect(hasFeatureRoute(consoleAi, 'settingsProfile')).toBe(false)
  })

  it('does not expose feature routes for a rejected hostname', () => {
    expect(hasFeatureRoute(resolveSiteProfile('noexist.qysyw.cn'), 'home')).toBe(false)
  })
})
