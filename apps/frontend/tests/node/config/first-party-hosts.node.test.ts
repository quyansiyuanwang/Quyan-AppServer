import { describe, expect, it } from 'vitest'
import { DEVELOPER_PRODUCTS } from '@quyan/shared'
import {
  buildFirstPartyHostnames,
  firstPartyHostPrefixes,
  platformHostPrefixes,
  productHostPrefixes,
} from '@/config/first-party-hosts'
import { siteDefinitions } from '@/config/site-catalog'

/**
 * The dev-server allowed-host list, the backend trusted-origin list, the local
 * hosts script and the site catalog all describe the same first-party hosts.
 * These assertions keep the literals in `first-party-hosts.ts` derived from the
 * shared product catalog instead of drifting.
 */
describe('first-party development hosts', () => {
  it('derives every product console from the shared product catalog', () => {
    const expected = DEVELOPER_PRODUCTS.map((product) => `${product.urlSlug}.console`)

    expect(productHostPrefixes).toEqual(expected)
    expect(expected).toContain('json-endpoints.console')
    for (const prefix of expected) expect(firstPartyHostPrefixes).toContain(prefix)
  })

  it('covers every registered site prefix except the legacy worktree host', () => {
    const registered = siteDefinitions
      .map((definition) => definition.hostPrefix)
      .filter((prefix): prefix is string => Boolean(prefix) && prefix !== 'legacy')

    for (const prefix of registered) expect(firstPartyHostPrefixes).toContain(prefix)
  })

  it('keeps the multi-domain dev server off the legacy single-domain host', () => {
    expect(platformHostPrefixes).not.toContain('legacy')
    expect(firstPartyHostPrefixes).not.toContain('legacy')
  })

  it('expands the prefixes for a local root domain', () => {
    const hostnames = buildFirstPartyHostnames('qysyw.test')

    expect(hostnames).toContain('json-endpoints.console.qysyw.test')
    expect(hostnames).toContain('management.qysyw.test')
    expect(hostnames).toHaveLength(firstPartyHostPrefixes.length)
  })
})
