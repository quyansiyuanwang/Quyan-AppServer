// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StorageKey from '@/constant/storagekey'
import {
  clearAccessToken,
  clearTokenExpiration,
  getAccessToken,
  isTokenExpired,
  parseJWT,
  saveTokenExpiration,
  setAccessToken,
} from '@/stores/request'

const toBase64Url = (value: string): string => {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const buildToken = (expiration: number): string => {
  const claims = {
    data: JSON.stringify({ data: { uid: 'u1' }, expiration }),
    type: 'access',
  }

  return `header.${toBase64Url(JSON.stringify(claims))}.signature`
}

const buildTokenWithoutExpiration = (): string => {
  const claims = {
    data: JSON.stringify({ data: { uid: 'u1' } }),
    type: 'access',
  }

  return `header.${toBase64Url(JSON.stringify(claims))}.signature`
}

describe('request token helpers', () => {
  beforeEach(() => {
    localStorage.clear()
    clearAccessToken()
    vi.restoreAllMocks()
  })

  it('parseJWT returns parsed payload for valid token', () => {
    const token = buildToken(1_700_000_000)

    expect(parseJWT(token)).toEqual({
      data: { uid: 'u1' },
      expiration: 1_700_000_000,
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

  it('returns false when no token expiration can be resolved', () => {
    expect(isTokenExpired()).toBe(false)
  })
})
