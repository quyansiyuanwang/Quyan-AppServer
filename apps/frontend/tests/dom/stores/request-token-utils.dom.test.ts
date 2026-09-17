// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StorageKey from '@/constant/storagekey'
import { createAccessToken } from '../../helpers/access-token'
import {
  clearAccessToken,
  clearTokenExpiration,
  getAccessToken,
  isTokenExpired,
  parseJWT,
  saveTokenExpiration,
  setAccessToken,
} from '@/stores/request'

const buildToken = (expiration: number): string =>
  createAccessToken('u1', 'version-1', { exp: expiration, iat: expiration - 60 })

const buildTokenWithoutExpiration = (): string =>
  createAccessToken('u1', 'version-1', { exp: undefined })

describe('request token helpers', () => {
  beforeEach(() => {
    localStorage.clear()
    clearAccessToken()
    vi.restoreAllMocks()
  })

  it('parseJWT returns parsed payload for valid token', () => {
    const token = buildToken(1_700_000_000)

    expect(parseJWT(token)).toMatchObject({
      userId: 'u1',
      updatedAt: 'version-1',
      exp: 1_700_000_000,
    })
  })

  it('parseJWT returns null for malformed token', () => {
    expect(parseJWT('invalid')).toBeNull()
    expect(parseJWT('a.b')).toBeNull()
    expect(parseJWT('a.@@@.c')).toBeNull()
  })

  it('saves and clears access token expiration in memory', () => {
    saveTokenExpiration(buildToken(1_800_000_000))
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_001 * 1000)
    expect(isTokenExpired()).toBe(true)
    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION)).toBeNull()

    clearTokenExpiration()
    expect(isTokenExpired()).toBe(false)
  })

  it('does not persist expiration when parsed payload has no expiration field', () => {
    saveTokenExpiration(buildTokenWithoutExpiration())

    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION)).toBeNull()
  })

  it('does not persist or inspect refresh token expiration', () => {
    const refreshExpiration = 1_800_000_100
    const refreshToken = buildToken(refreshExpiration)

    saveTokenExpiration(refreshToken, true)
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, refreshToken)
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_200 * 1000)

    expect(isTokenExpired({ isRefresh: true, bufferSeconds: 1 })).toBe(false)
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN_EXPIRATION)).toBeNull()

    clearTokenExpiration(true)
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN_EXPIRATION)).toBeNull()
  })

  it('derives expiration from the in-memory access token without reading legacy storage', () => {
    const expiration = 1_700_000_010
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, buildToken(expiration))
    setAccessToken(buildToken(expiration))

    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_013 * 1000)

    expect(isTokenExpired({ bufferSeconds: 2 })).toBe(true)
    expect(getAccessToken()).toBe(buildToken(expiration))
    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION)).toBeNull()
  })

  it.each([
    buildTokenWithoutExpiration(),
    'invalid',
    createAccessToken('u1', 'version-1', { exp: 'not-a-number' }),
  ])('clears the previous deadline when the next token has no valid exp', (nextToken) => {
    saveTokenExpiration(buildToken(1))
    expect(isTokenExpired()).toBe(true)
    saveTokenExpiration(nextToken)
    expect(isTokenExpired()).toBe(false)
  })

  it('refreshes only when the standard exp reaches the configured buffer', () => {
    const expiration = 1_800_000_000
    setAccessToken(buildToken(expiration))
    vi.spyOn(Date, 'now').mockReturnValue((expiration - 5) * 1000)
    expect(isTokenExpired({ bufferSeconds: 2 })).toBe(false)
    vi.spyOn(Date, 'now').mockReturnValue((expiration - 2) * 1000)
    expect(isTokenExpired({ bufferSeconds: 2 })).toBe(true)
  })

  it('treats exp zero as expired rather than missing', () => {
    saveTokenExpiration(buildToken(0))
    expect(isTokenExpired()).toBe(true)
  })

  it('returns false when no token expiration can be resolved', () => {
    expect(isTokenExpired()).toBe(false)
  })
})
