// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import StorageKey from '@/constant/storagekey'
import {
  getSharedPreference,
  getSharedPreferenceCookieName,
  setSharedPreference,
} from '@/utils/sharedPreferences'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'

const themeCookieName = getSharedPreferenceCookieName('theme')
const pinnedRoutesCookieName = getSharedPreferenceCookieName('pinnedRoutes')

const clearThemePreference = (): void => {
  document.cookie = `${encodeURIComponent(themeCookieName)}=; Path=/; Max-Age=0`
  document.cookie = `${encodeURIComponent(pinnedRoutesCookieName)}=; Path=/; Max-Age=0`
  TypedLocalStorage.removeItem(StorageKey.Theme.THEME_TOGGLE_IS_DARK)
  TypedLocalStorage.removeItem(`${StorageKey.Navigation.PINNED_ROUTES}:public`)
}

afterEach(clearThemePreference)

describe('shared preferences', () => {
  it('writes a shared cookie while retaining the legacy per-origin value', () => {
    setSharedPreference('theme', 'dark', StorageKey.Theme.THEME_TOGGLE_IS_DARK)

    expect(document.cookie).toContain(`${encodeURIComponent(themeCookieName)}=dark`)
    expect(TypedLocalStorage.getItem(StorageKey.Theme.THEME_TOGGLE_IS_DARK)).toBe('dark')
  })

  it('uses the shared cookie before the per-origin legacy value', () => {
    document.cookie = `${encodeURIComponent(themeCookieName)}=light; Path=/`
    TypedLocalStorage.setItem(StorageKey.Theme.THEME_TOGGLE_IS_DARK, 'dark')

    expect(getSharedPreference('theme', StorageKey.Theme.THEME_TOGGLE_IS_DARK)).toBe('light')
  })

  it('migrates an existing per-origin preference to the shared cookie', () => {
    TypedLocalStorage.setItem(StorageKey.Theme.THEME_TOGGLE_IS_DARK, 'auto')

    expect(getSharedPreference('theme', StorageKey.Theme.THEME_TOGGLE_IS_DARK)).toBe('auto')
    expect(document.cookie).toContain(`${encodeURIComponent(themeCookieName)}=auto`)
  })

  it('shares pinned routes while retaining the former site-local key', () => {
    const legacyKey = `${StorageKey.Navigation.PINNED_ROUTES}:public`
    const pinnedRoutes = JSON.stringify(['home', 'accountSettings'])

    TypedLocalStorage.setItem(legacyKey, pinnedRoutes)

    expect(getSharedPreference('pinnedRoutes', legacyKey)).toBe(pinnedRoutes)
    expect(document.cookie).toContain(`${encodeURIComponent(pinnedRoutesCookieName)}=`)

    setSharedPreference('pinnedRoutes', JSON.stringify(['home']), legacyKey)
    expect(TypedLocalStorage.getItem(legacyKey)).toBe(JSON.stringify(['home']))
  })
})
