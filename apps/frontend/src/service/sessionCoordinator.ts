import { createAuthControllerApi } from '@/client/services/auth-controller.gen'
import type { UserDto } from '@/client/types.gen'
import { CustomCode } from '@/constant/custom-code'
import { heartbeatService } from '@/service/heartbeatService'
import { ReplaySigningService } from '@/service/replaySigningService'
import { usePermissionStore } from '@/stores/permissionStore'
import {
  clearAccessToken,
  getAccessToken,
  isTokenExpired,
  saveTokenExpiration,
  setAccessToken,
  useRequestStore,
} from '@/stores/request'
import { useSessionStore, type SessionStatus } from '@/stores/sessionStore'
import { useTopLoadingProgressStore } from '@/stores/topLoadingProgressStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { useWaterMarkTextStore } from '@/stores/waterMarkTextStore'
import {
  getUserIdFromToken,
  getUserUpdatedAtFromToken,
  resetCurrentStorageScope,
  setCurrentStorageScopeForUserId,
} from '@/utils/storageScope'
import { cache } from '@/utils/common'

export class SessionExpiredError extends Error {
  constructor() {
    super('Session has expired')
    this.name = 'SessionExpiredError'
  }
}

const getAuthApi = cache(() => createAuthControllerApi(useRequestStore().getAxios()))

export class SessionCoordinator {
  private static instance: SessionCoordinator | null = null
  private restorePromise: Promise<string | null> | null = null
  private hydratePromise: Promise<void> | null = null
  private logoutPromise: Promise<void> | null = null
  // This projection version is intentionally kept in memory. The access token
  // refreshes frequently, while user identity and permissions only need to be
  // restored again when the token says that the authorization version changed.
  private projectedUserId: string | null = null
  private projectedUserVersion: string | null = null

  static getInstance() {
    if (!this.instance) this.instance = new SessionCoordinator()
    return this.instance
  }

  getSnapshot() {
    const session = useSessionStore()
    return {
      status: session.status,
      accessToken: session.accessToken,
      user: session.user,
      permissions: session.permissionsStatus,
      error: session.error,
    }
  }

  private applyAccessToken(token: string, user?: Partial<UserDto>) {
    setAccessToken(token)
    saveTokenExpiration(token)
    const userId = getUserIdFromToken(token) || user?.id
    const userUpdatedAt = getUserUpdatedAtFromToken(token)
    if (userId) {
      const userInfoStore = useUserInfoStore()
      const permissionStore = usePermissionStore()
      if (userInfoStore.userInfo.id && userInfoStore.userInfo.id !== userId) {
        userInfoStore.clear()
        permissionStore.clearCurrentUserPermissions()
        useSessionStore().setPermissionsStatus('idle')
        this.projectedUserId = null
        this.projectedUserVersion = null
      }
      setCurrentStorageScopeForUserId(userId)
      const session = useSessionStore()
      const hasCurrentSessionProjection =
        this.projectedUserId === userId &&
        this.projectedUserVersion === userUpdatedAt &&
        session.user?.id === userId &&
        session.permissionsStatus === 'ready' &&
        permissionStore.isLoaded

      // Restore the per-user local cache only for a cold start. Reassigning
      // the permission arrays during every short-lived token refresh makes
      // all menu visibility computed values re-run and visibly flashes the
      // sidebar while the route view is changing.
      if (!hasCurrentSessionProjection) {
        const cachedUser = userInfoStore.loadFromStorage()
        const restoredPermissions = permissionStore.restoreCurrentUserPermissionsCache(
          userId,
          userUpdatedAt,
        )
        if (!restoredPermissions) {
          permissionStore.clearCurrentUserPermissions()
        }

        // A refreshed access token is valid only while the user's update
        // version is unchanged, so the cached profile and permissions remain
        // valid for this user until a later hydration invalidates them.
        if (cachedUser?.id === userId && restoredPermissions) {
          session.setUser(cachedUser)
          session.setPermissionsStatus('ready')
          this.projectedUserId = userId
          this.projectedUserVersion = userUpdatedAt
        }
      }
    }
    useSessionStore().setAuthenticated(token)
  }

  completeLogin(auth: { access_token: string; user?: Partial<UserDto> }) {
    this.applyAccessToken(auth.access_token, auth.user)
    void ReplaySigningService.getInstance()
      .refreshSigningMaterial()
      .catch(() => undefined)
    void heartbeatService.start().catch(() => undefined)
  }

  async ensureSession(): Promise<string | null> {
    const token = getAccessToken()
    if (token && !isTokenExpired({ bufferSeconds: 2 })) {
      useSessionStore().setAuthenticated(token)
      return token
    }
    return this.refresh()
  }

  async refresh(): Promise<string | null> {
    if (this.restorePromise) return this.restorePromise

    this.restorePromise = (async () => {
      const session = useSessionStore()
      // Do not transiently turn an established application shell anonymous
      // while refreshing an expired in-memory access token. In particular,
      // HomeFrameLayout mounts the sidebar from this state; changing it to
      // `restoring` destroys and recreates the menu on every token rotation.
      session.beginRestore(Boolean(getAccessToken()) && session.isAuthenticated)
      try {
        const result = await getAuthApi().refresh(
          { body: {} as never },
          { retry: false, requestWrapper: async (promise: any) => promise },
        )
        if (result.code !== CustomCode.OK || !result.data?.access_token) {
          throw new SessionExpiredError()
        }
        this.applyAccessToken(result.data.access_token)
        void ReplaySigningService.getInstance()
          .refreshSigningMaterial()
          .catch(() => undefined)
        void heartbeatService.start().catch(() => undefined)
        return result.data.access_token
      } catch (error) {
        this.clearLocalSession(error instanceof SessionExpiredError ? 'expired' : 'anonymous')
        return null
      } finally {
        this.restorePromise = null
      }
    })()
    return this.restorePromise
  }

  async hydrateUserAndPermissions(user?: Partial<UserDto>): Promise<void> {
    if (this.hydratePromise) return this.hydratePromise

    this.hydratePromise = (async () => {
      const session = useSessionStore()
      const userInfoStore = useUserInfoStore()
      const permissionStore = usePermissionStore()

      if (
        session.permissionsStatus === 'ready' &&
        permissionStore.isLoaded &&
        userInfoStore.isUserInfoFetched
      ) {
        return
      }

      session.setPermissionsStatus('loading')
      try {
        if (user) userInfoStore.setUserInfo(user)
        await userInfoStore.fetchUserInfo()
        session.setUser(userInfoStore.userInfo)
        setCurrentStorageScopeForUserId(userInfoStore.userInfo.id)
        if (permissionStore.allPermissions.length === 0) {
          await permissionStore.loadAllPermissions()
        }
        await permissionStore.loadCurrentUserPermissions()
        permissionStore.saveCurrentUserPermissionsCache(
          userInfoStore.userInfo.id,
          getUserUpdatedAtFromToken(getAccessToken()),
        )
        this.projectedUserId = userInfoStore.userInfo.id
        this.projectedUserVersion = getUserUpdatedAtFromToken(getAccessToken())
        session.setPermissionsStatus('ready')
      } catch (error) {
        session.setPermissionsStatus('failed')
        throw error
      } finally {
        this.hydratePromise = null
      }
    })()
    return this.hydratePromise
  }

  async activateAuthenticatedSession(auth: { access_token: string; user?: Partial<UserDto> }) {
    this.completeLogin(auth)
    await this.hydrateUserAndPermissions(auth.user)
  }

  private clearLocalSession(status: Extract<SessionStatus, 'anonymous' | 'expired'>) {
    clearAccessToken()
    ReplaySigningService.getInstance().clearSigningMaterial()
    heartbeatService.stop()
    useTopLoadingProgressStore().reset()
    useUserInfoStore().clear()
    usePermissionStore().clearCurrentUserPermissions()
    useWaterMarkTextStore().clearText()
    useSessionStore().setAnonymous(status)
    resetCurrentStorageScope()
    this.projectedUserId = null
    this.projectedUserVersion = null
  }

  async logout(): Promise<void> {
    if (this.logoutPromise) return this.logoutPromise
    this.logoutPromise = (async () => {
      const accessToken = getAccessToken()
      try {
        if (accessToken) {
          await getAuthApi().logout(
            { body: { access_token: accessToken } },
            { retry: false, requestWrapper: async (promise: any) => promise },
          )
        }
      } catch (error) {
        console.warn('[session] Logout request failed; completing local logout:', error)
      } finally {
        this.clearLocalSession('anonymous')
      }
    })().finally(() => {
      this.logoutPromise = null
    })
    return this.logoutPromise
  }
}

export const sessionCoordinator = SessionCoordinator.getInstance()
