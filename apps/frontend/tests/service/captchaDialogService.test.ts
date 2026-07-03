import { beforeEach, describe, expect, it, vi } from 'vitest'

const { replaceMock, getTrustStatusMock, verifyAndTrustMock, getCaptchaRuntimeConfigMock, getCaptchaTokenMock } =
 vi.hoisted(() => ({
 replaceMock: vi.fn(),
 getTrustStatusMock: vi.fn(),
 verifyAndTrustMock: vi.fn(),
 getCaptchaRuntimeConfigMock: vi.fn(),
 getCaptchaTokenMock: vi.fn(),
 }))

vi.mock('@/router', () => ({
 default: {
 replace: replaceMock,
 },
}))

vi.mock('@/service/captchaTrustStateService', () => ({
 captchaTrustStateService: {
 getTrustStatus: getTrustStatusMock,
 },
}))

vi.mock('@/service/captchaTrustService', () => ({
 captchaTrustService: {
 verifyAndTrust: verifyAndTrustMock,
 },
}))

vi.mock('@/utils/captcha', () => ({
 getCaptchaRuntimeConfig: getCaptchaRuntimeConfigMock,
 getCaptchaToken: getCaptchaTokenMock,
}))

import { ensureCaptchaTrust, resolveCaptchaPreflightAction, warmupCaptchaTrust } from '@/service/captchaDialogService'

describe('captchaDialogService', () => {
 beforeEach(() => {
 vi.clearAllMocks()
 Object.defineProperty(window, 'location', {
 configurable: true,
 value: {
 pathname: '/login',
 search: '?redirect=%2Fhome',
 },
 })
 })

 it('returns true when trust status is already valid', async () => {
 getTrustStatusMock.mockResolvedValueOnce({ trusted: true, expiresInSeconds:120 })

 await expect(ensureCaptchaTrust('login')).resolves.toBe(true)
 expect(replaceMock).not.toHaveBeenCalled()
 })

 it('silently establishes trust with recaptcha', async () => {
 getTrustStatusMock.mockResolvedValueOnce({ trusted: false, expiresInSeconds:0 })
 getCaptchaRuntimeConfigMock.mockResolvedValueOnce({
 enabled: true,
 provider: 'recaptcha',
 fallbackProvider: 'none',
 })
 getCaptchaTokenMock.mockResolvedValueOnce('recaptcha-token')
 verifyAndTrustMock.mockResolvedValueOnce({ trusted: true, expiresInSeconds:1800 })

 await expect(ensureCaptchaTrust('login')).resolves.toBe(true)
 expect(getCaptchaTokenMock).toHaveBeenCalledWith('login', 'recaptcha')
 expect(verifyAndTrustMock).toHaveBeenCalledWith('recaptcha-token', 'login', 'recaptcha')
 expect(replaceMock).not.toHaveBeenCalled()
 })

 it('redirects to captcha verification page only after recaptcha fallback fails', async () => {
 getTrustStatusMock.mockResolvedValueOnce({ trusted: false, expiresInSeconds:0 })
 getCaptchaRuntimeConfigMock.mockResolvedValueOnce({
 enabled: true,
 provider: 'recaptcha',
 fallbackProvider: 'turnstile',
 })
 getCaptchaTokenMock.mockResolvedValueOnce('')

 await expect(ensureCaptchaTrust('login', '/target')).resolves.toBe(false)
 expect(getCaptchaTokenMock).toHaveBeenCalledWith('login', 'recaptcha')
 expect(replaceMock).toHaveBeenCalledWith({
 name: 'captchaVerification',
 query: {
 action: 'login',
 redirect: '/target',
 },
 })
 })

 it('redirects to captcha verification page when recaptcha trust request fails and turnstile is fallback', async () => {
 getTrustStatusMock.mockResolvedValueOnce({ trusted: false, expiresInSeconds:0 })
 getCaptchaRuntimeConfigMock.mockResolvedValueOnce({
 enabled: true,
 provider: 'recaptcha',
 fallbackProvider: 'turnstile',
 })
 getCaptchaTokenMock.mockResolvedValueOnce('recaptcha-token')
 verifyAndTrustMock.mockRejectedValueOnce(new Error('captcha failed'))

 await expect(ensureCaptchaTrust('login', '/target')).resolves.toBe(false)
 expect(getCaptchaTokenMock).toHaveBeenCalledWith('login', 'recaptcha')
 expect(verifyAndTrustMock).toHaveBeenCalledWith('recaptcha-token', 'login', 'recaptcha')
 expect(replaceMock).toHaveBeenCalledWith({
 name: 'captchaVerification',
 query: {
 action: 'login',
 redirect: '/target',
 },
 })
 })

 it('reuses the original redirect when already on captcha page', async () => {
 getTrustStatusMock.mockResolvedValueOnce({ trusted: false, expiresInSeconds:0 })
 getCaptchaRuntimeConfigMock.mockResolvedValueOnce({
 enabled: true,
 provider: 'turnstile',
 fallbackProvider: 'none',
 })
 Object.defineProperty(window, 'location', {
 configurable: true,
 value: {
 pathname: '/auth/captcha',
 search: '?action=login&redirect=%2Flogin%3Fredirect%3D%2Fhome',
 },
 })

 await expect(ensureCaptchaTrust('view_policy')).resolves.toBe(false)
 expect(replaceMock).toHaveBeenCalledWith({
 name: 'captchaVerification',
 query: {
 action: 'view_policy',
 redirect: '/login?redirect=/home',
 },
 })
 })

 it('resolves login preflight action from route query mode', () => {
 expect(
 resolveCaptchaPreflightAction({
 name: 'login',
 query: { mode: 'register' },
 meta: {},
 }),
 ).toBe('register')

 expect(
 resolveCaptchaPreflightAction({
 name: 'login',
 query: {},
 meta: {},
 }),
 ).toBe('login')
 })

 it('resolves explicit register route to register action', () => {
 expect(
 resolveCaptchaPreflightAction({
 name: 'register',
 query: {},
 meta: {},
 }),
 ).toBe('register')
 })

 it('resolves meta captcha action for non-login routes', () => {
 expect(
 resolveCaptchaPreflightAction({
 name: 'forgotPassword',
 query: {},
 meta: { captchaAction: 'reset_password' },
 }),
 ).toBe('reset_password')
 })

 it('warms up recaptcha trust without navigation', async () => {
 getTrustStatusMock.mockResolvedValueOnce({ trusted: false, expiresInSeconds:0 })
 getCaptchaRuntimeConfigMock.mockResolvedValueOnce({
 enabled: true,
 provider: 'recaptcha',
 fallbackProvider: 'turnstile',
 })
 getCaptchaTokenMock.mockResolvedValueOnce('recaptcha-token')
 verifyAndTrustMock.mockResolvedValueOnce({ trusted: true, expiresInSeconds:1800 })

 await expect(warmupCaptchaTrust('login')).resolves.toBeUndefined()
 expect(getCaptchaTokenMock).toHaveBeenCalledWith('login', 'recaptcha')
 expect(verifyAndTrustMock).toHaveBeenCalledWith('recaptcha-token', 'login', 'recaptcha')
 expect(replaceMock).not.toHaveBeenCalled()
 })
})