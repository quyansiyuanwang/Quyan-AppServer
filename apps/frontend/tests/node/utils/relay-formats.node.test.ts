import { describe, expect, it } from 'vitest'
import {
  normalizeRelayFormatArray,
  normalizeRelayFormats,
  parseConfiguredRelayFormats,
  serializeRelayFormats,
  toConfiguredRelayFormats,
} from '@/utils/relay-formats'

describe('relay-formats utils', () => {
  it('parses configured formats and deduplicates invalid entries', () => {
    expect(parseConfiguredRelayFormats('openai, gemini,unknown,OPENAI,anthropic')).toEqual([
      'openai-chat-completions',
      'gemini',
      'anthropic',
    ])
  })

  it('treats empty and obsolete all as no configured formats', () => {
    expect(parseConfiguredRelayFormats(undefined)).toEqual([])
    expect(parseConfiguredRelayFormats('  ')).toEqual([])
    expect(parseConfiguredRelayFormats('all')).toEqual([])
  })

  it('defaults only missing values to legacy Chat, Anthropic, and Gemini formats', () => {
    expect(normalizeRelayFormats(undefined)).toEqual([
      'openai-chat-completions',
      'anthropic',
      'gemini',
    ])
    expect(normalizeRelayFormats('all')).toEqual([])
  })

  it('keeps explicit normalized formats when configured values are valid', () => {
    expect(normalizeRelayFormats('openai,invalid')).toEqual(['openai-chat-completions'])
  })

  it('normalizes arrays and serializes to configured string', () => {
    expect(normalizeRelayFormatArray(['openai', 'OPENAI', 'invalid', 'anthropic'])).toEqual([
      'openai-chat-completions',
      'anthropic',
    ])

    expect(toConfiguredRelayFormats('gemini,OPENAI')).toEqual(['gemini', 'openai-chat-completions'])
    expect(toConfiguredRelayFormats(['anthropic', 'invalid'])).toEqual(['anthropic'])

    expect(serializeRelayFormats(['gemini', 'openai-chat-completions', 'gemini'])).toBe(
      'gemini,openai-chat-completions',
    )
    expect(serializeRelayFormats([])).toBe('')
  })
})
