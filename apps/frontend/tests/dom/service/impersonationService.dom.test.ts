// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import StorageKey from '@/constant/storagekey'

const { requestMock, refreshMock, pushMock, userInfoStore, permissionStore, sessionState } = vi.hoisted(
  () => ({
    requestMock: { post: vi.fn() },
    refreshMock: vi.fn(),
    pushMock: vi.fn(),
    userInfoStore: { clear: vi.fn(), fetchUserInfo: vi.fn(async () => undefined) },
    permissionStore: {
      clearCurrentUserPermissions: vi.fn(),
      loadCurrentUserPermissions: vi.fn(async () => undefined),
    },
    sessionState: { isImpersonating: false },
  }),
)

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({ getAxios: () => requestMock }),
  setAccessToken: vi.fn(),
}))
vi.mock('@/service/sessionCoordinator', () => ({ sessionCoordinator: { refresh: refreshMock } }))
vi.mock('@/stores/impersonationStore', () => ({
  useImpersonationStore: () => ({
    get isImpersonating() {
      return sessionState.isImpersonating
    },
    clearSession: vi.fn(() => {
      sessionState.isImpersonating = false
    }),
    setSession: vi.fn(() => {
      sessionState.isImpersonating = true
    }),
  }),
}))
vi.mock('@/stores/userInfoStore', () => ({ useUserInfoStore: () => userInfoStore }))
vi.mock('@/stores/permissionStore', () => ({ usePermissionStore: () => permissionStore }))
vi.mock('@/router', () => ({ default: { push: pushMock } }))
vi.mock('@/utils/storageScope', () => ({ setCurrentStorageScopeForUserId: vi.fn() }))
vi.mock('@/client/services/impersonation-controller.gen', () => ({
  createImpersonationControllerApi: () => ({ startImpersonation: requestMock.post }),
}))

import { impersonationService } from '@/service/impersonationService'

describe('impersonationService', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    sessionState.isImpersonating = false
  })

  it('keeps both original and impersonated bearer tokens out of browser storage', async () => {
    requestMock.post.mockResolvedValue({ data: { access_token: 'impersonation-access', mode: 'view' } })
    await impersonationService.startImpersonation({ id: 'target-user-1', username: 'target', name: 'Target' })

    expect(localStorage.getItem(StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN)).toBeNull()
    expect(localStorage.getItem(StorageKey.Impersonation.ORIGINAL_REFRESH_TOKEN)).toBeNull()
    expect(permissionStore.loadCurrentUserPermissions).toHaveBeenCalledOnce()
  })

  it('restores the original session through the shared refresh cookie when exiting', async () => {
    refreshMock.mockResolvedValue('restored-cookie-access')
    await impersonationService.exitImpersonation('/admin')

    expect(refreshMock).toHaveBeenCalledOnce()
    expect(pushMock).toHaveBeenCalledWith('/admin')
  })
})
