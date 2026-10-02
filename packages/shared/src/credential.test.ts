import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_PREFIXES,
  classifyCredential,
  isCanonicalCredential,
  isValidCredential,
  toCanonicalCredential,
  toLegacyCredential,
} from './credential'

describe('credential prefix contract', () => {
  it.each([
    ['accessKey', 'ak_secret', 'sk-ak-secret'],
    ['relayToken', 'rlt_secret', 'sk-rlt-secret'],
    ['productKey', 'dpk_secret', 'sk-dpk-secret'],
    ['ojApiKey', 'ojqa_secret', 'sk-ojqa-secret'],
    ['projectKey', 'dk_secret', 'sk-dk-secret'],
  ] as const)('canonicalizes %s', (type, legacy, canonical) => {
    expect(classifyCredential(legacy)).toBe(type)
    expect(toCanonicalCredential(legacy)).toBe(canonical)
    expect(toLegacyCredential(canonical)).toBe(legacy)
    expect(isCanonicalCredential(canonical, type)).toBe(true)
    expect(isValidCredential(canonical, type)).toBe(true)
    expect(isValidCredential(legacy, type)).toBe(true)
  })

  it('does not change unknown values or suffixes', () => {
    expect(toCanonicalCredential('not-a-key')).toBe('not-a-key')
    expect(toCanonicalCredential(`${CREDENTIAL_PREFIXES.relayToken.legacy}a-b-9`)).toBe('sk-rlt-a-b-9')
  })
})
