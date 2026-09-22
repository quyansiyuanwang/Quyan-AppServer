import { TypedLocalStorage } from '@/utils/typedLocalStorage'

import {
  type SharedPreferenceKey,
  getSharedPreferenceCookieName,
  getSharedPreferenceCookieDomain,
  SHARED_PREFERENCE_COOKIE_MAX_AGE_SECONDS,
} from '@/constant/preference-cookies'
export {
  type SharedPreferenceKey,
  SHARED_PREFERENCE_COOKIE_PREFIX,
  SHARED_PREFERENCE_COOKIE_MAX_AGE_SECONDS,
  getSharedPreferenceCookieName,
  getSharedPreferenceCookieDomain,
} from '@/constant/preference-cookies'

const getCookieValue = (name: string): string | null => {
  if (typeof document === 'undefined') return null

  const encodedName = `${encodeURIComponent(name)}=`
  const match = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(encodedName))
  if (!match) return null

  try {
    return decodeURIComponent(match.slice(encodedName.length))
  } catch {
    return null
  }
}

const writeCookie = (name: string, value: string): void => {
  if (typeof document === 'undefined') return

  const domain = getSharedPreferenceCookieDomain(window.location.hostname)
  const attributes = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${SHARED_PREFERENCE_COOKIE_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
  ]
  if (window.location.protocol === 'https:') attributes.push('Secure')
  if (domain) attributes.push(`Domain=${domain}`)
  document.cookie = attributes.join('; ')
}

/**
 * Reads a deployment-wide preference and migrates its former per-origin
 * localStorage value the first time a site in that deployment is opened.
 */
export const getSharedPreference = (
  key: SharedPreferenceKey,
  legacyStorageKey?: string,
): string | null => {
  const cookieValue = getCookieValue(getSharedPreferenceCookieName(key))
  if (cookieValue !== null) return cookieValue

  const legacyValue = legacyStorageKey ? TypedLocalStorage.getItem(legacyStorageKey) : null
  if (legacyValue) setSharedPreference(key, legacyValue)
  return legacyValue
}

/** Keeps the legacy per-origin key in sync while sharing new writes across sites. */
export const setSharedPreference = (
  key: SharedPreferenceKey,
  value: string,
  legacyStorageKey?: string,
): void => {
  writeCookie(getSharedPreferenceCookieName(key), value)
  if (legacyStorageKey) TypedLocalStorage.setItem(legacyStorageKey, value)
}
