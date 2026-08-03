// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StorageKey from '@/constant/storagekey'
import { CustomCode } from '@/constant/custom-code'

const {
  requestMock,
  authEventBusMock,
  routerMock,
  progressStoreMock,
  saveTokenExpirationMock,
  clearTokenExpirationMock,
  setAccessTokenMock,
  getAccessTokenMock,
  clearAccessTokenMock,
  isTokenExpiredMock,
  clearSessionMock,
  setSessionMock,
  impersonationState,
} = vi.hoisted(() => ({
  requestMock: {
    post: vi.fn(),
  },
  authEventBusMock: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
  routerMock: {
    push: vi.fn(),
  },
  progressStoreMock: {
    wrapTask: vi.fn(async (task: Promise<any>) => task),
  },
  saveTokenExpirationMock: vi.fn(),
  clearTokenExpirationMock: vi.fn(),
  setAccessTokenMock: vi.fn((token?: string | null) => {
    const normalizedToken = token?.trim() || null
    if (normalizedToken) localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, normalizedToken)
    else localStorage.removeItem(StorageKey.Auth.ACCESS_TOKEN)
    return normalizedToken
  }),
  getAccessTokenMock: vi.fn(() => localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)),
  clearAccessTokenMock: vi.fn(() => {
    localStorage.removeItem(StorageKey.Auth.ACCESS_TOKEN)
  }),
  isTokenExpiredMock: vi.fn(() => false),
  clearSessionMock: vi.fn(() => {
    localStorage.removeItem(StorageKey.Impersonation.SESSION_INFO)
  }),
  setSessionMock: vi.fn(),
  impersonationState: {
    isImpersonating: false,
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
  saveTokenExpiration: saveTokenExpirationMock,
  clearTokenExpiration: clearTokenExpirationMock,
  setAccessToken: setAccessTokenMock,
  getAccessToken: getAccessTokenMock,
  clearAccessToken: clearAccessTokenMock,
  isTokenExpired: isTokenExpiredMock,
}))

vi.mock('@/stores/globalInstance', () => ({
  authEventBus: authEventBusMock,
  customCodeBus: {
    emit: vi.fn(),
  },
}))

vi.mock('@/router', () => ({
  default: routerMock,
}))

vi.mock('@/utils/captcha', () => ({
  getCaptchaToken: vi.fn(async () => 'captcha-token'),
}))

vi.mock('@/stores/topLoadingProgressStore', () => ({
  useTopLoadingProgressStore: () => progressStoreMock,
}))

vi.mock('@/stores/userInfoStore', () => ({
  useUserInfoStore: () => ({
    clear: vi.fn(),
    setUserInfo: vi.fn(),
    fetchUserInfo: vi.fn(),
  }),
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({
    clearCurrentUserPermissions: vi.fn(),
    init: vi.fn(),
  }),
}))

vi.mock('@/stores/impersonationStore', () => ({
  useImpersonationStore: () => ({
    get isImpersonating() {
      return impersonationState.isImpersonating
    },
    clearSession: clearSessionMock,
    setSession: setSessionMock,
  }),
}))

vi.mock('@/service/replaySigningService', () => ({
  ReplaySigningService: {
    getInstance: () => ({
      refreshSigningMaterial: vi.fn(async () => undefined),
      clearSigningMaterial: vi.fn(),
    }),
  },
}))

import { authorizationService } from '@/service/authorizationService'

const expectOperation = (name: string) => expect.objectContaining({ name })

describe('authorizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestMock.post.mockReset()
    localStorage.clear()
    sessionStorage.clear()
    impersonationState.isImpersonating = false
  })

  it('stores tokens after successful token login and clears pending challenge', async () => {
    authorizationService.setPendingTwoFactorChallenge('challenge-1', '/home', 'login')

    requestMock.post.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        access_token: 'access.token.value',
        refresh_token: 'refresh.token.value',
      },
    })

    const result = await authorizationService.login('user-1', 'password-1', true)

    expect(result.code).toBe(CustomCode.OK)
    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBe('access.token.value')
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)).toBe('refresh.token.value')
    expect(sessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)).toBeNull()
  })

  it('keeps existing tokens when login response requires two-factor challenge', async () => {
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, 'old-access')
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, 'old-refresh')

    requestMock.post.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        requiresTwoFactor: true,
        challengeToken: 'challenge-token',
        expiresIn: 300,
      },
    })

    const result = await authorizationService.login('user-1', 'password-1', true)

    expect(result.data).toMatchObject({
      requiresTwoFactor: true,
    })
    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBe('old-access')
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)).toBe('old-refresh')
  })

  it('replaces stale session values in completeLogin', () => {
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, 'stale-access')
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, 'stale-refresh')
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION, '111')
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN_EXPIRATION, '222')
    authorizationService.setPendingTwoFactorChallenge('challenge-2', '/settings', 'register')

    authorizationService.completeLogin({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    })

    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBe('new-access')
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)).toBe('new-refresh')
    expect(clearTokenExpirationMock).toHaveBeenCalledTimes(2)
    expect(clearTokenExpirationMock).toHaveBeenNthCalledWith(1)
    expect(clearTokenExpirationMock).toHaveBeenNthCalledWith(2, true)
    expect(sessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)).toBeNull()
  })

  it('preserves existing refresh token when completeLogin is told to keep it', () => {
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, 'existing-refresh')

    authorizationService.completeLogin(
      {
        access_token: 'stepup-access',
      },
      {
        preserveRefreshTokenIfMissing: true,
        clearPendingTwoFactorChallenge: false,
      },
    )

    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBe('stepup-access')
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)).toBe('existing-refresh')
    expect(setAccessTokenMock).toHaveBeenCalledWith('stepup-access')
  })

  it('persists auth entry with pending two-factor challenge state', () => {
    authorizationService.setPendingTwoFactorChallenge('challenge-3', '/home', 'register')

    expect(authorizationService.getPendingTwoFactorChallenge()).toMatchObject({
      challengeToken: 'challenge-3',
      redirect: '/home',
      authEntry: 'register',
    })
  })

  it('persists pending policy consent challenge state', () => {
    authorizationService.setPendingPolicyConsentChallenge('policy-challenge-1', '/home')

    expect(authorizationService.getPendingPolicyConsentChallenge()).toMatchObject({
      challengeToken: 'policy-challenge-1',
      redirect: '/home',
    })
  })

  it('clears pending policy consent challenge on logout', async () => {
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, 'access-before-logout')
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, 'refresh-before-logout')
    authorizationService.setPendingPolicyConsentChallenge('policy-challenge-2', '/protected')
    requestMock.post.mockRejectedValueOnce(new Error('network error'))

    await authorizationService.logout('/protected')

    expect(
      sessionStorage.getItem(StorageKey.Auth.PENDING_POLICY_CONSENT_CHALLENGE),
    ).toBeNull()
  })

  it('clears refresh token during logout even if logout request fails', async () => {
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, 'access-before-logout')
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, 'refresh-before-logout')
    localStorage.setItem(StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN, 'admin-access')
    requestMock.post.mockRejectedValueOnce(new Error('network error'))

    await authorizationService.logout('/protected')

    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBeNull()
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)).toBeNull()
    expect(localStorage.getItem(StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN)).toBeNull()
    expect(clearAccessTokenMock).toHaveBeenCalled()
    expect(clearTokenExpirationMock).toHaveBeenCalledWith(true)
    expect(routerMock.push).toHaveBeenCalledWith({ name: 'login', query: { redirect: '/protected' } })
  })

  it('clears refresh token and emits failure when refresh returns auth failed', async () => {
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, 'refresh-before-failure')
    localStorage.setItem(StorageKey.Impersonation.SESSION_INFO, JSON.stringify({ targetUserId: 'u1' }))
    requestMock.post.mockResolvedValueOnce({
      code: CustomCode.AUTH_FAILED,
      data: null,
    })

    await authorizationService.refreshToken()

    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)).toBeNull()
    expect(localStorage.getItem(StorageKey.Impersonation.SESSION_INFO)).toBeNull()
    expect(clearAccessTokenMock).toHaveBeenCalled()
    expect(clearTokenExpirationMock).toHaveBeenCalledWith(true)
    expect(authEventBusMock.emit).toHaveBeenCalledWith(
      'ACCESS_TOKEN_REFRESH_FAILED',
      expect.any(Error),
    )
  })

  it('sends an empty refresh body when no refresh token is available', async () => {
    requestMock.post.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: {
        access_token: 'refreshed-access-token',
      },
    })

    await authorizationService.refreshToken()

    expect(requestMock.post).toHaveBeenCalledWith(
      expectOperation('AuthControllerRefresh'),
      { body: {} },
      { retry: false, requestWrapper: expect.any(Function) },
    )
    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBe('refreshed-access-token')
  })

  it('does not clear impersonation session during bootstrap restore when access token is only in memory', async () => {
    impersonationState.isImpersonating = true
    localStorage.setItem(
      StorageKey.Impersonation.SESSION_INFO,
      JSON.stringify({ targetUserId: 'target-user-1', mode: 'view', startedAt: Date.now() }),
    )
    requestMock.post.mockResolvedValueOnce({
      code: CustomCode.AUTH_FAILED,
      data: null,
    })

    const result = await authorizationService.bootstrapSession()

    expect(result).toBeNull()
    expect(clearSessionMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(StorageKey.Impersonation.SESSION_INFO)).not.toBeNull()
  })

  it('throws enriched error object when register verification code request fails', async () => {
    requestMock.post.mockResolvedValueOnce({
      code: CustomCode.VALIDATION_FAILED,
      message: 'invalid email',
      data: {
        field: 'email',
      },
    })

    await expect(authorizationService.sendRegisterVerificationCode('bad-email')).rejects.toMatchObject({
      message: 'invalid email',
      code: CustomCode.VALIDATION_FAILED,
      data: {
        field: 'email',
      },
    })
  })
})
