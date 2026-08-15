import { describe, expect, it } from 'vitest'
import {
  getSharedPreferenceCookieDomain,
} from '@/utils/sharedPreferences'

describe('shared preference cookie domain', () => {
  it('shares production preferences across qysyw.cn sites', () => {
    expect(getSharedPreferenceCookieDomain('ai.management.qysyw.cn')).toBe('.qysyw.cn')
  })

  it('keeps staging and local preferences in their own deployment families', () => {
    expect(getSharedPreferenceCookieDomain('auth.staging.qysyw.cn')).toBe('.staging.qysyw.cn')
    expect(getSharedPreferenceCookieDomain('www.qysyw.test')).toBe('.qysyw.test')
  })

  it('does not attach a domain cookie on an unrelated host', () => {
    expect(getSharedPreferenceCookieDomain('localhost')).toBeUndefined()
    expect(getSharedPreferenceCookieDomain('unrelated.example')).toBeUndefined()
  })
})
