import { describe, expect, it } from 'vitest'
import { parseJWT } from '@/utils/jwt'
import { getUserIdFromToken, getUserUpdatedAtFromToken } from '@/utils/storageScope'
import { createAccessToken } from '../../helpers/access-token'

describe('backend JWT claim decoding', () => {
  it('reads the top-level user identity and authorization version issued by the backend', () => {
    const token = createAccessToken('user-1', '2026-09-18T00:00:00.000Z')
    expect(getUserIdFromToken(token)).toBe('user-1')
    expect(getUserUpdatedAtFromToken(token)).toBe('2026-09-18T00:00:00.000Z')
    expect(parseJWT(token)?.exp).toBeTypeOf('number')
  })

  it('decodes UTF-8 base64url claims without requiring padding', () => {
    const token = createAccessToken('用户-1', 'version-1', { label: '中文 🔐' })
    expect(getUserIdFromToken(token)).toBe('用户-1')
    expect(parseJWT(token)?.label).toBe('中文 🔐')
  })

  it.each([
    'invalid',
    'a.b',
    'a.@@@.c',
    ...[null, [], 42, 'text'].map(
      (value) => `header.${Buffer.from(JSON.stringify(value)).toString('base64url')}.signature`,
    ),
  ])('rejects malformed or non-object claims: %s', (token) => {
    expect(parseJWT(token)).toBeNull()
    expect(getUserIdFromToken(token)).toBeNull()
    expect(getUserUpdatedAtFromToken(token)).toBeNull()
  })

  it.each([null, 42, {}, [], '   '])('does not coerce invalid identity/version values', (value) => {
    const token = createAccessToken('user-1', 'version-1', { userId: value, updatedAt: value })
    expect(getUserIdFromToken(token)).toBeNull()
    expect(getUserUpdatedAtFromToken(token)).toBeNull()
  })
})
