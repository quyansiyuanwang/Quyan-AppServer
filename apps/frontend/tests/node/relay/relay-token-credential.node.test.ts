import { describe, expect, it } from 'vitest'
import { relayTokenCredential, collectRelayTokenCredentials } from '@/utils/relay-token-credential'
describe('resource-authorized token credential handling', () => {
  it.each([undefined, null, '', '  ', 0, {}, { id: 'resource-id' }])(
    'does not treat %j as a credential',
    (value) => {
      expect(relayTokenCredential(value)).toBeUndefined()
    },
  )
  it('preserves an explicitly returned credential without inventing a fallback', () => {
    expect(relayTokenCredential('fixture-only-credential')).toBe('fixture-only-credential')
  })
  it('refuses a partially redacted batch instead of silently copying only visible values', () => {
    expect(collectRelayTokenCredentials([{ token: 'fixture-one' }, {}])).toBeUndefined()
    expect(collectRelayTokenCredentials([])).toBeUndefined()
    expect(
      collectRelayTokenCredentials([{ token: 'fixture-one' }, { token: 'fixture-two' }]),
    ).toEqual(['fixture-one', 'fixture-two'])
  })
})
