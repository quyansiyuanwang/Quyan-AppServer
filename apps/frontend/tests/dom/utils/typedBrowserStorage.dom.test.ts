// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { TypedSessionStorage } from '@/utils/typedSessionStorage'
import StorageKey from '@/constant/storagekey'

describe('typed browser storage', () => {
  it('round-trips JSON values and retains the existing raw-string format', () => {
    const value = { enabled: true, attempts: [1, 2] }

    TypedLocalStorage.set(StorageKey.Relay.CHANNEL_PROBE_APPLY_SETTINGS, value)
    TypedLocalStorage.setItem(StorageKey.Util.LOCALE, 'en')

    expect(TypedLocalStorage.get(StorageKey.Relay.CHANNEL_PROBE_APPLY_SETTINGS)).toEqual(value)
    expect(TypedLocalStorage.getItem(StorageKey.Util.LOCALE)).toBe('en')
  })

  it('falls back for missing, null, and malformed JSON values', () => {
    TypedLocalStorage.setItem(StorageKey.Util.LOCALE, '{invalid')
    expect(TypedLocalStorage.get(StorageKey.Util.LOCALE, 'zh-CN')).toBe('zh-CN')

    TypedLocalStorage.setItem(StorageKey.Util.LOCALE, 'null')
    expect(TypedLocalStorage.get(StorageKey.Util.LOCALE, 'zh-CN')).toBe('zh-CN')
    expect(TypedLocalStorage.get(StorageKey.Util.LOCALE, null)).toBeNull()
    expect(TypedLocalStorage.get(StorageKey.Util.LOCALE)).toBeUndefined()
  })

  it('keeps local and session data isolated and supports deletion', () => {
    TypedLocalStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, 'persistent-token')
    TypedSessionStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, 'session-token')

    expect(TypedLocalStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBe('persistent-token')
    expect(TypedSessionStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBe('session-token')

    TypedSessionStorage.remove(StorageKey.Auth.ACCESS_TOKEN)
    expect(TypedSessionStorage.has(StorageKey.Auth.ACCESS_TOKEN)).toBe(false)
    expect(TypedLocalStorage.has(StorageKey.Auth.ACCESS_TOKEN)).toBe(true)
  })

  it('does not throw when browser storage is unavailable', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(() => TypedLocalStorage.setItem(StorageKey.Util.LOCALE, 'en')).not.toThrow()
    expect(() =>
      TypedSessionStorage.set(StorageKey.Auth.ONE_TIME_TOKEN, { value: 'token' }),
    ).not.toThrow()

    setItem.mockRestore()
  })
})
