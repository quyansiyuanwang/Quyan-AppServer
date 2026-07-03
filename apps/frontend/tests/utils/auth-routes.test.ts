import { describe, expect, it } from 'vitest'
import {
  getForgotPasswordRoute,
  getLoginRoute,
  getRegisterRoute,
  getSafeAuthRedirect,
} from '@/utils/auth-routes'

describe('auth route helpers', () => {
  it('builds login route without redirect', () => {
    expect(getLoginRoute()).toEqual({ name: 'login' })
  })

  it('builds login route with safe redirect', () => {
    expect(getLoginRoute('/home')).toEqual({
      name: 'login',
      query: { redirect: '/home' },
    })
  })

  it('drops unsafe login redirect', () => {
    expect(getLoginRoute('https://evil.example')).toEqual({ name: 'login' })
  })

  it('builds register route without redirect', () => {
    expect(getRegisterRoute()).toEqual({ name: 'register' })
  })

  it('builds register route with safe redirect', () => {
    expect(getRegisterRoute('/home')).toEqual({
      name: 'register',
      query: { redirect: '/home' },
    })
  })

  it('builds forgot-password route without redirect', () => {
    expect(getForgotPasswordRoute()).toEqual({ name: 'forgotPassword' })
  })

  it('builds forgot-password route with safe redirect', () => {
    expect(getForgotPasswordRoute('/home')).toEqual({
      name: 'forgotPassword',
      query: { redirect: '/home' },
    })
  })

  it('returns undefined for blocked exact auth redirects', () => {
    expect(
      getSafeAuthRedirect('/login', {
        blockedExactPaths: ['/login', '/register'],
      }),
    ).toBeUndefined()
  })

  it('returns undefined for blocked auth redirect prefixes', () => {
    expect(
      getSafeAuthRedirect('/auth/verify?method=code', {
        blockedPrefixes: ['/auth/verify'],
      }),
    ).toBeUndefined()
  })

  it('returns safe auth redirect when not blocked', () => {
    expect(
      getSafeAuthRedirect('/home', {
        blockedExactPaths: ['/login'],
        blockedPrefixes: ['/auth/verify'],
      }),
    ).toBe('/home')
  })
})
