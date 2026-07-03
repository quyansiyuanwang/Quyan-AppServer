import { describe, expect, it } from 'vitest'
import {
  SUPPORTED_RELAY_FORMATS,
  normalizeRelayFormatArray,
  normalizeRelayFormats,
  parseConfiguredRelayFormats,
  serializeRelayFormats,
  toConfiguredRelayFormats,
} from '@/utils/relay-formats'

describe('relay-formats utils', () => {
  it('parses configured formats and deduplicates invalid entries', () => {
    expect(parseConfiguredRelayFormats('openai, gemini,unknown,OPENAI,anthropic')).toEqual([
      'openai',
      'gemini',
      'anthropic',
    ])
  })

  it('treats empty or all as no explicit restriction', () => {
    expect(parseConfiguredRelayFormats(undefined)).toEqual([])
    expect(parseConfiguredRelayFormats('  ')).toEqual([])
    expect(parseConfiguredRelayFormats('all')).toEqual([])
  })

  it('normalizes to full supported set when no explicit value exists', () => {
    expect(normalizeRelayFormats(undefined)).toEqual([...SUPPORTED_RELAY_FORMATS])
    expect(normalizeRelayFormats('all')).toEqual([...SUPPORTED_RELAY_FORMATS])
  })

  it('keeps explicit normalized formats when configured values are valid', () => {
    expect(normalizeRelayFormats('openai,invalid')).toEqual(['openai'])
  })

  it('normalizes arrays and serializes to configured string', () => {
    expect(normalizeRelayFormatArray(['openai', 'OPENAI', 'invalid', 'anthropic'])).toEqual([
      'openai',
      'anthropic',
    ])

    expect(toConfiguredRelayFormats('gemini,OPENAI')).toEqual(['gemini', 'openai'])
    expect(toConfiguredRelayFormats(['anthropic', 'invalid'])).toEqual(['anthropic'])

    expect(serializeRelayFormats(['gemini', 'openai', 'gemini'])).toBe('gemini,openai')
    expect(serializeRelayFormats([])).toBe('all')
  })
})
