// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StorageKey from '@/constant/storagekey'

const {
  requestMock,
  routerMock,
  clearAccessTokenMock,
  clearTokenExpirationMock,
  setAccessTokenMock,
  saveTokenExpirationMock,
  fetchUserInfoMock,
  initPermissionsMock,
  clearUserInfoMock,
  clearPermissionsMock,
  authEventBusMock,
  impersonationStoreState,
  clearSessionMock,
  setSessionMock,
  bootstrapSessionMock,
  getCurrentStorageScopeMock,
  setCurrentStorageScopeMock,
  setCurrentStorageScopeForUserIdMock,
  resetCurrentStorageScopeMock,
} = vi.hoisted(() => ({
  requestMock: {
    post: vi.fn(),
  },
  routerMock: {
    push: vi.fn(),
  },
  clearAccessTokenMock: vi.fn(() => {
    localStorage.removeItem(StorageKey.Auth.ACCESS_TOKEN)
  }),
  clearTokenExpirationMock: vi.fn((isRefresh?: boolean) => {
    localStorage.removeItem(
      isRefresh ? StorageKey.Auth.REFRESH_TOKEN_EXPIRATION : StorageKey.Auth.ACCESS_TOKEN_EXPIRATION,
    )
  }),
  setAccessTokenMock: vi.fn((token?: string | null) => {
    if (token) localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, token)
  }),
  saveTokenExpirationMock: vi.fn((token: string, isRefresh?: boolean) => {
    localStorage.setItem(
      isRefresh ? StorageKey.Auth.REFRESH_TOKEN_EXPIRATION : StorageKey.Auth.ACCESS_TOKEN_EXPIRATION,
      `${token}-expiry`,
    )
  }),
  fetchUserInfoMock: vi.fn(async () => undefined),
  initPermissionsMock: vi.fn(async () => undefined),
  clearUserInfoMock: vi.fn(),
  clearPermissionsMock: vi.fn(),
  authEventBusMock: {
    on: vi.fn(),
    off: vi.fn(),
  },
  impersonationStoreState: {
    isImpersonating: false,
  },
  clearSessionMock: vi.fn(() => {
    localStorage.removeItem(StorageKey.Impersonation.SESSION_INFO)
  }),
  setSessionMock: vi.fn((session: unknown) => {
    localStorage.setItem(StorageKey.Impersonation.SESSION_INFO, JSON.stringify(session))
  }),
  bootstrapSessionMock: vi.fn(async () => 'restored-via-refresh'),
  getCurrentStorageScopeMock: vi.fn(() => 'user:admin-1'),
  setCurrentStorageScopeMock: vi.fn(),
  setCurrentStorageScopeForUserIdMock: vi.fn(),
  resetCurrentStorageScopeMock: vi.fn(),
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
  saveTokenExpiration: saveTokenExpirationMock,
  clearTokenExpiration: clearTokenExpirationMock,
  setAccessToken: setAccessTokenMock,
  clearAccessToken: clearAccessTokenMock,
}))

vi.mock('@/stores/impersonationStore', () => ({
  useImpersonationStore: () => ({
    get isImpersonating() {
      return impersonationStoreState.isImpersonating
    },
    clearSession: clearSessionMock,
    setSession: setSessionMock,
  }),
}))

vi.mock('@/stores/userInfoStore', () => ({
  useUserInfoStore: () => ({
    clear: clearUserInfoMock,
    fetchUserInfo: fetchUserInfoMock,
  }),
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({
    clearCurrentUserPermissions: clearPermissionsMock,
    init: initPermissionsMock,
  }),
}))

vi.mock('@/stores/globalInstance', () => ({
  authEventBus: authEventBusMock,
}))

vi.mock('@/router', () => ({
  default: routerMock,
}))

vi.mock('@/service/authorizationService', () => ({
  authorizationService: {
    bootstrapSession: bootstrapSessionMock,
    getPendingPolicyConsentChallenge: vi.fn(() => null),
    setPendingPolicyConsentChallenge: vi.fn(),
    clearPendingPolicyConsentChallenge: vi.fn(),
  },
}))

vi.mock('@/utils/storageScope', () => ({
  getCurrentStorageScope: getCurrentStorageScopeMock,
  setCurrentStorageScope: setCurrentStorageScopeMock,
  setCurrentStorageScopeForUserId: setCurrentStorageScopeForUserIdMock,
  resetCurrentStorageScope: resetCurrentStorageScopeMock,
}))

import { impersonationService } from '@/service/impersonationService'

describe('impersonationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestMock.post.mockReset()
    localStorage.clear()
    sessionStorage.clear()
    impersonationStoreState.isImpersonating = false
  })

  it('backs up original admin session before starting impersonation', async () => {
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN, 'admin-access')
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, 'admin-refresh')
    localStorage.setItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION, 'admin-access-expiry')
    localStorage.setItem(StorageKey.Auth.REFRESH_TOKEN_EXPIRATION, 'admin-refresh-expiry')
    requestMock.post.mockResolvedValueOnce({
      data: {
        access_token: 'impersonation-access',
        expires_in: 3600,
        mode: 'view',
      },
    })

    await impersonationService.startImpersonation({
      id: 'target-user-1',
      username: 'target-user',
      name: 'Target User',
    })

    expect(localStorage.getItem(StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN)).toBe('admin-access')
    expect(localStorage.getItem(StorageKey.Impersonation.ORIGINAL_REFRESH_TOKEN)).toBe('admin-refresh')
    expect(localStorage.getItem(StorageKey.Impersonation.ORIGINAL_STORAGE_SCOPE)).toBe('user:admin-1')
    expect(setCurrentStorageScopeForUserIdMock).toHaveBeenCalledWith('target-user-1')
  })

  it('restores original admin session locally when exiting impersonation even if refresh is unavailable', async () => {
    localStorage.setItem(StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN, 'admin-access')
    localStorage.setItem(StorageKey.Impersonation.ORIGINAL_REFRESH_TOKEN, 'admin-refresh')
    localStorage.setItem(StorageKey.Impersonation.ORIGINAL_ACCESS_EXPIRY, 'admin-access-expiry')
    localStorage.setItem(StorageKey.Impersonation.ORIGINAL_REFRESH_EXPIRY, 'admin-refresh-expiry')
    localStorage.setItem(StorageKey.Impersonation.ORIGINAL_STORAGE_SCOPE, 'user:admin-1')
    localStorage.setItem(StorageKey.Impersonation.SESSION_INFO, JSON.stringify({ targetUserId: 'target-user-1' }))

    await impersonationService.exitImpersonation('/admin')

    expect(bootstrapSessionMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBe('admin-access')
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)).toBe('admin-refresh')
    expect(setCurrentStorageScopeMock).toHaveBeenCalledWith('user:admin-1')
    expect(fetchUserInfoMock).toHaveBeenCalled()
    expect(initPermissionsMock).toHaveBeenCalled()
    expect(routerMock.push).toHaveBeenCalledWith('/admin')
    expect(localStorage.getItem(StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN)).toBeNull()
  })
})