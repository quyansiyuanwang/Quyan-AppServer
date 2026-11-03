import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_PREFIXES,
  type CredentialType,
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
    expect(toCanonicalCredential(`${CREDENTIAL_PREFIXES.relayToken.legacy}a-b-9`)).toBe(
      'sk-rlt-a-b-9',
    )
  })

  it.each(Object.keys(CREDENTIAL_PREFIXES) as CredentialType[])(
    'validates the complete %s credential',
    (type) => {
      for (const prefix of Object.values(CREDENTIAL_PREFIXES[type])) {
        expect(isValidCredential(`${prefix}fixture-A9`, type)).toBe(true)
        expect(isValidCredential(`${prefix}fixture-A9`, type, 11)).toBe(false)
        for (const suffix of [
          '',
          'fixture_secret',
          'fixture secret',
          'fixture\n',
          'fixture\r\n',
          'fixture\0',
          'fixture\t',
          '密钥',
        ]) {
          expect(isValidCredential(`${prefix}${suffix}`, type)).toBe(false)
        }
        expect(isValidCredential(prefix, type, 0)).toBe(false)
      }
      for (const otherType of Object.keys(CREDENTIAL_PREFIXES) as CredentialType[]) {
        if (otherType === type) continue
        for (const prefix of Object.values(CREDENTIAL_PREFIXES[otherType])) {
          expect(isValidCredential(`${prefix}fixture`, type)).toBe(false)
        }
      }
    },
  )

  it.each([
    undefined,
    null,
    0,
    true,
    [],
    ['sk-rlt-fixture'],
    {},
    { toString: () => 'sk-rlt-fixture' },
    'sk-fixture',
  ])('rejects malformed runtime input %#', (value) => {
    expect(isValidCredential(value, 'relayToken')).toBe(false)
  })
})
