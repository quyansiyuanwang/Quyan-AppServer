// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import StorageKey from '@/constant/storagekey'
import { SessionCoordinator } from '@/service/sessionCoordinator'

const { permissionService, userService } = vi.hoisted(() => ({
  permissionService: {
    getAllPermissions: vi.fn(),
    getUserPermissions: vi.fn(),
  },
  userService: {
    getMe: vi.fn(),
  },
}))

const authApi = {
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
}

vi.mock('@/client/services/auth-controller.gen', () => ({
  createAuthControllerApi: () => authApi,
}))
vi.mock('@/stores/request', async () => {
  const actual = await vi.importActual<typeof import('@/stores/request')>('@/stores/request')
  return { ...actual, useRequestStore: () => ({ getAxios: () => ({}) }) }
})
vi.mock('@/service/heartbeatService', () => ({
  heartbeatService: { start: vi.fn(async () => undefined), stop: vi.fn() },
}))
vi.mock('@/service/replaySigningService', () => ({
  ReplaySigningService: {
    getInstance: () => ({
      refreshSigningMaterial: vi.fn(async () => undefined),
      clearSigningMaterial: vi.fn(),
    }),
  },
}))
vi.mock('@/service/permissionService', () => ({ permissionService }))
vi.mock('@/service/userService', () => ({ userService }))

describe('session coordinator', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    authApi.refresh.mockReset()
    permissionService.getAllPermissions.mockReset()
    permissionService.getUserPermissions.mockReset()
    userService.getMe.mockReset()
  })

  it('restores an access token from the HttpOnly-cookie refresh endpoint once for concurrent callers', async () => {
    authApi.refresh.mockResolvedValue({ code: 0, data: { access_token: 'cookie-access' } })
    const sessionCoordinator = new SessionCoordinator()

    const [first, second] = await Promise.all([
      sessionCoordinator.ensureSession(),
      sessionCoordinator.ensureSession(),
    ])

    expect(first).toBe('cookie-access')
    expect(second).toBe('cookie-access')
    expect(authApi.refresh).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBeNull()
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)).toBeNull()
  })

  it('marks a failed cookie restore as anonymous without persisting credentials', async () => {
    authApi.refresh.mockResolvedValue({ code: 1001, data: null })
    const sessionCoordinator = new SessionCoordinator()

    await expect(sessionCoordinator.refresh()).resolves.toBeNull()
    expect(sessionCoordinator.getSnapshot().status).toBe('expired')
    expect(sessionCoordinator.getSnapshot().accessToken).toBeNull()
  })

  it('keeps the authenticated projection mounted while an existing token refreshes', async () => {
    let resolveRefresh:
      | ((value: { code: number; data: { access_token: string } }) => void)
      | undefined
    authApi.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
    )
    const sessionCoordinator = new SessionCoordinator()
    sessionCoordinator.completeLogin({ access_token: 'existing-access' })

    const refreshPromise = sessionCoordinator.refresh()
    expect(sessionCoordinator.getSnapshot().status).toBe('authenticated')

    resolveRefresh?.({ code: 0, data: { access_token: 'rotated-access' } })
    await expect(refreshPromise).resolves.toBe('rotated-access')
    expect(sessionCoordinator.getSnapshot().status).toBe('authenticated')
  })

  it('does not restore permission state again when a refreshed token keeps the authorization version', async () => {
    const sessionCoordinator = new SessionCoordinator() as any
    const token = [
      'header',
      btoa(
        JSON.stringify({
          data: JSON.stringify({
            data: { userId: 'user-1', updatedAt: '2026-08-14T00:00:00.000Z' },
            expiration: Math.floor(Date.now() / 1000) + 60,
          }),
          type: 'access',
        }),
      ),
      'signature',
    ].join('.')

    const userInfoStore = (await import('@/stores/userInfoStore')).useUserInfoStore()
    const permissionStore = (await import('@/stores/permissionStore')).usePermissionStore()
    const sessionStore = (await import('@/stores/sessionStore')).useSessionStore()
    userInfoStore.setUserInfo({ id: 'user-1', username: 'user-1' })
    sessionStore.setUser(userInfoStore.userInfo)
    sessionStore.setPermissionsStatus('ready')
    permissionService.getAllPermissions.mockResolvedValue({
      data: { permissions: [{ id: 'permission-1', name: 'user:read', category: 'user' }] },
    })
    permissionService.getUserPermissions.mockResolvedValue({
      data: {
        userId: 'user-1',
        groupPermissions: [],
        additionalPermissions: [],
        removedPermissions: [],
        effectivePermissions: ['user:read'],
      },
    })
    await permissionStore.loadAllPermissions()
    await permissionStore.loadCurrentUserPermissions()
    expect(permissionStore.isLoaded).toBe(true)
    const restoreSpy = vi.spyOn(permissionStore, 'restoreCurrentUserPermissionsCache')
    const permissionsReference = permissionStore.currentUserPermissions
    const allPermissionsReference = permissionStore.allPermissions
    sessionCoordinator.projectedUserId = 'user-1'
    sessionCoordinator.projectedUserVersion = '2026-08-14T00:00:00.000Z'

    sessionCoordinator.applyAccessToken(token)

    expect(restoreSpy).not.toHaveBeenCalled()
    expect(permissionStore.currentUserPermissions).toBe(permissionsReference)
    expect(permissionStore.allPermissions).toBe(allPermissionsReference)
  })

  it('loads the independent user profile and permission catalog concurrently during hydration', async () => {
    let resolveUser: ((value: { id: string; username: string }) => void) | undefined
    let resolveAllPermissions:
      | ((value: { data: { permissions: { id: string; name: string; category: string }[] } }) => void)
      | undefined
    userService.getMe.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUser = resolve
        }),
    )
    permissionService.getAllPermissions.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAllPermissions = resolve
        }),
    )
    permissionService.getUserPermissions.mockResolvedValue({
      data: {
        userId: 'user-1',
        groupPermissions: [],
        additionalPermissions: [],
        removedPermissions: [],
        effectivePermissions: ['user:read'],
      },
    })

    const sessionCoordinator = new SessionCoordinator()
    const hydration = sessionCoordinator.hydrateUserAndPermissions()

    await vi.waitFor(() => {
      expect(userService.getMe).toHaveBeenCalledOnce()
      expect(permissionService.getAllPermissions).toHaveBeenCalledOnce()
    })
    expect(permissionService.getUserPermissions).not.toHaveBeenCalled()

    resolveUser?.({ id: 'user-1', username: 'user-1' })
    await vi.waitFor(() => {
      expect(permissionService.getUserPermissions).toHaveBeenCalledWith('user-1')
    })

    resolveAllPermissions?.({
      data: { permissions: [{ id: 'permission-1', name: 'user:read', category: 'user' }] },
    })
    await expect(hydration).resolves.toBeUndefined()
  })
})
