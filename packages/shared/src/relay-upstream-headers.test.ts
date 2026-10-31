import { describe, expect, it } from 'vitest'
import {
  RELAY_DEFAULT_FORWARDED_HEADERS,
  getRelayDefaultForwardedHeaderNames,
  isRelayForwardableHeaderName,
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
