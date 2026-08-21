import { describe, expect, it } from 'vitest'
import {
  ALL_RELAY_REQUEST_FORMATS,
  RELAY_PROBE_FORMATS,
  RELAY_REQUEST_FORMAT_ORDER,
  RELAY_REQUEST_FORMATS,
  RELAY_UPSTREAM_FORMATS,
  parseRelayRequestFormats,
} from './relay-model-availability'

describe('shared relay format contract', () => {
  it('keeps complete and legacy request format sets distinct', () => {
    expect(RELAY_REQUEST_FORMATS).toEqual([
      'openai-chat-completions',
      'openai-responses',
      'anthropic',
      'gemini',
    ])
    expect(ALL_RELAY_REQUEST_FORMATS).toEqual(['openai-chat-completions', 'anthropic', 'gemini'])
    expect(RELAY_REQUEST_FORMAT_ORDER).toEqual(RELAY_REQUEST_FORMATS)
  })

  it('publishes upstream and probe format sets', () => {
    expect(RELAY_UPSTREAM_FORMATS).toEqual(['openai', 'anthropic', 'gemini'])
    expect(RELAY_PROBE_FORMATS).toEqual([
      'openai',
      'openai-chat-completions',
      'openai-responses',
      'anthropic',
      'gemini',
    ])
  })

  it('normalizes legacy openai and filters unknown formats', () => {
    expect(parseRelayRequestFormats('openai,openai-responses,unknown,OPENAI')).toEqual([
      'openai-chat-completions',
      'openai-responses',
    ])
  })
})
