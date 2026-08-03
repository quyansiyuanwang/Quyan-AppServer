import { describe, expect, it } from 'vitest'
import {
  getForgotPasswordRoute,
  getLoginRoute,
  getQrApprovalRoute,
  getRegisterRoute,
  getSafeAuthRedirect,
  isQrApprovalRedirect,
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

  it('builds qr approval route without redirect', () => {
    expect(getQrApprovalRoute('session-1')).toEqual({
      path: '/auth/qr-approve',
      query: { sessionId: 'session-1' },
    })
  })

  it('builds qr approval route with safe redirect', () => {
    expect(getQrApprovalRoute('session-1', '/home')).toEqual({
      path: '/auth/qr-approve',
      query: { sessionId: 'session-1', redirect: '/home' },
    })
  })

  it('recognizes qr approval redirect with session id', () => {
    expect(isQrApprovalRedirect('/auth/qr-approve?sessionId=session-1')).toBe(true)
  })

  it('rejects qr approval redirect without session id', () => {
    expect(isQrApprovalRedirect('/auth/qr-approve')).toBe(false)
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
