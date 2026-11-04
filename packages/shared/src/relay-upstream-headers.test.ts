import { describe, expect, it } from 'vitest'
import {
  RELAY_DEFAULT_FORWARDED_HEADERS,
  getRelayDefaultForwardedHeaderNames,
  isRelayForwardableHeaderName,
  normalizeRelayRequestHeaderPolicy,
  resolveRelayRequestHeaderPolicy,
} from './relay-upstream-headers'
import type { RelayRequestFormat } from './relay-model-availability'

describe('default forwarded request headers', () => {
  it.each<RelayRequestFormat>([
    'openai',
    'openai-chat-completions',
    'openai-responses',
    'anthropic',
    'gemini',
  ])('includes common headers and only the selected protocol defaults for %s', (format) => {
    const names = getRelayDefaultForwardedHeaderNames(format)
    for (const name of RELAY_DEFAULT_FORWARDED_HEADERS.common) expect(names).toContain(name)
    const protocol = format === 'anthropic' || format === 'gemini' ? format : 'openai'
    for (const [group, headers] of Object.entries(RELAY_DEFAULT_FORWARDED_HEADERS)) {
      if (group === 'common') continue
      for (const name of headers) expect(names.includes(name)).toBe(group === protocol)
    }
    expect(names.every(isRelayForwardableHeaderName)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('layered request-header policy', () => {
  const system = { mode: 'blacklist', allowlist: ['x-system'], blocklist: ['x-denied'] }
  it('inherits by default and merges exact normalized lists', () => {
    expect(
      resolveRelayRequestHeaderPolicy(system, {
        forwardedRequestHeaders: [' X-Channel '],
        blockedRequestHeaders: ['X-Debug'],
      }),
    ).toEqual({
      mode: 'blacklist',
      allowlist: ['x-system', 'x-channel'],
      blocklist: ['x-denied', 'x-debug'],
    })
  })
  it.each(['whitelist', 'blacklist'] as const)(
    'uses explicit channel mode %s without removing system denials',
    (mode) => {
      expect(
        resolveRelayRequestHeaderPolicy(system, {
          requestHeaderMode: mode,
          forwardAllRequestHeaders: mode !== 'blacklist',
        }),
      ).toMatchObject({ mode, blocklist: ['x-denied'] })
    },
  )
  it('explicit inheritance ignores stale legacy flags', () => {
    expect(
      resolveRelayRequestHeaderPolicy(system, {
        requestHeaderMode: 'inherit',
        forwardAllRequestHeaders: false,
      })?.mode,
    ).toBe('blacklist')
  })
  it.each([true, false])('retains legacy channel boolean %s', (value) => {
    expect(resolveRelayRequestHeaderPolicy(system, { forwardAllRequestHeaders: value })?.mode).toBe(
      value ? 'blacklist' : 'whitelist',
    )
  })
  it('does not mutate the system lists', () => {
    const original = {
      ...system,
      allowlist: [...system.allowlist],
      blocklist: [...system.blocklist],
    }
    resolveRelayRequestHeaderPolicy(system, { blockedRequestHeaders: ['x-other'] })
    expect(system).toEqual(original)
  })
  it.each([
    null,
    {},
    { mode: 'all', allowlist: [], blocklist: [] },
    { ...system, blocklist: ['*'] },
    { ...system, allowlist: ['authorization'] },
    { ...system, blocklist: 'x-debug' },
  ])('rejects malformed policy %j', (value) => {
    expect(normalizeRelayRequestHeaderPolicy(value)).toBeUndefined()
    expect(resolveRelayRequestHeaderPolicy(value)).toBeUndefined()
  })
  it('rejects malformed stored channel policy rather than dropping denials', () => {
    expect(
      resolveRelayRequestHeaderPolicy(system, { blockedRequestHeaders: ['bad name'] }),
    ).toBeUndefined()
    expect(resolveRelayRequestHeaderPolicy(system, { requestHeaderMode: 'all' })).toBeUndefined()
    expect(
      resolveRelayRequestHeaderPolicy(system, { forwardAllRequestHeaders: 'true' }),
    ).toBeUndefined()
    expect(resolveRelayRequestHeaderPolicy(system, { blockedRequestHeaders: null })).toBeUndefined()
    expect(
      resolveRelayRequestHeaderPolicy(system, { forwardedRequestHeaders: null }),
    ).toBeUndefined()
  })
})
