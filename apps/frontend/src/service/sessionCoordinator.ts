import { HttpStatusCode } from 'axios'
import { REQUEST_POLICY } from '@/constant/request'
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
import { useImpersonationStore } from '@/stores/impersonationStore'
import {
  getUserIdFromToken,
  getUserUpdatedAtFromToken,
  resetCurrentStorageScope,
  setCurrentStorageScopeForUserId,
} from '@/utils/storageScope'
import { cache } from '@/utils/common'
import { permissionService } from '@/service/permissionService'
import {
  canceledRecovery,
  createSessionRecoveryDeadline,
  recoverSessionOperation,
  SessionRestoreError,
} from '@/utils/session-recovery'
import { isRequestCanceled } from '@/utils/error-utils'
export { SessionRestoreError } from '@/utils/session-recovery'

export class SessionExpiredError extends Error {
  constructor() {
    super('Session has expired')
    this.name = 'SessionExpiredError'
  }
}

const DEFINITIVE_AUTH_FAILURE_CODES = new Set<number>([
  CustomCode.AUTH_FAILED,
  CustomCode.ACCOUNT_DISABLED,
  CustomCode.TOKEN_EXPIRED_DUE_TO_UPDATE,
  CustomCode.TOKEN_EXPIRED,
  CustomCode.TOKEN_INVALID,
])

const isDefinitiveAuthFailure = (error: unknown): boolean => {
  if (error instanceof SessionRestoreError) return isDefinitiveAuthFailure(error.originalError)
  const candidate = error as {
    code?: unknown
    data?: { code?: unknown }
    response?: { data?: { code?: unknown }; status?: unknown }
    status?: unknown
  }
  const status = Number(candidate?.response?.status ?? candidate?.status)
  const code = Number(candidate?.response?.data?.code ?? candidate?.data?.code ?? candidate?.code)
  if (
    [
      CustomCode.TWO_FACTOR_REQUIRED,
      CustomCode.POLICY_CONSENT_REQUIRED,
      CustomCode.REPLAY_PROTECTION_FAILED,
    ].includes(code)
  )
    return false
  if (status === HttpStatusCode.Unauthorized) return true

  return Number.isFinite(code) && DEFINITIVE_AUTH_FAILURE_CODES.has(code)
}

const getAuthApi = cache(() => createAuthControllerApi(useRequestStore().getAxios()))

export class SessionCoordinator {
  private static instance: SessionCoordinator | null = null
  private restorePromise: Promise<string | null> | null = null
  private protectedSessionPromise: Promise<string | null> | null = null
  private hydratePromise: Promise<void> | null = null
  private generation = 0
  private recoveryController = new AbortController()
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
    const session = useSessionStore()
    const userId = getUserIdFromToken(token) || user?.id
    const userUpdatedAt = getUserUpdatedAtFromToken(token)
    if (userId) {
      const userInfoStore = useUserInfoStore()
      const permissionStore = usePermissionStore()
      if (userInfoStore.userInfo.id && userInfoStore.userInfo.id !== userId) {
        userInfoStore.clear()
        permissionStore.clearCurrentUserPermissions()
        session.setPermissionsStatus('idle')
        session.setUser(null)
        this.projectedUserId = null
        this.projectedUserVersion = null
      }
      setCurrentStorageScopeForUserId(userId)
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
        // Keep the last known projection while the same user's authorization
        // version is being rehydrated. Clearing it here makes every computed
        // menu/route briefly fall back to its unauthenticated/loading state,
        // which is visible as a flash during ordinary token rotation. A user
        // switch is cleared above, so this is safe for identity changes.
        const hasSameUserPermissionProjection =
          permissionStore.currentUserPermissions?.userId === userId
        if (!restoredPermissions && !hasSameUserPermissionProjection) {
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
    session.setAuthenticated(token)
    if (user?.id) session.setUser(user)
  }

  private invalidatePendingRecovery() {
    this.generation += 1
    this.recoveryController.abort()
    this.recoveryController = new AbortController()
    this.restorePromise = null
    this.protectedSessionPromise = null
    this.hydratePromise = null
  }

  getAuthorizationIdentity(): string {
    return `${this.generation}:${getUserIdFromToken(getAccessToken()) ?? ''}:${getUserUpdatedAtFromToken(getAccessToken()) ?? ''}`
  }

  completeLogin(auth: { access_token: string; user?: Partial<UserDto> }) {
    this.invalidatePendingRecovery()
    this.applyAccessToken(auth.access_token, auth.user)
    void ReplaySigningService.getInstance()
      .refreshSigningMaterial()
      .catch(() => undefined)
    void heartbeatService.start().catch(() => undefined)
  }

  async ensureSession(deadline = createSessionRecoveryDeadline()): Promise<string | null> {
    const token = getAccessToken()
    if (token && !isTokenExpired({ bufferSeconds: REQUEST_POLICY.proactiveRefreshBufferSeconds })) {
      useSessionStore().setAuthenticated(token)
      return token
    }

    // The backend resolves a possible HttpOnly impersonation handoff before
    // the normal refresh-cookie session. Keeping this as one request avoids
    // an unavoidable client-side probe for ordinary users on every cold load.
    return this.refresh({ deadline })
  }

  /**
   * Restore the access token and authorization projection as one shared
   * startup operation. App bootstrap can start this before the router is
   * ready, while the navigation guard awaits the exact same promise.
   */
  restoreProtectedSession(): Promise<string | null> {
    if (this.protectedSessionPromise) return this.protectedSessionPromise
    const generation = this.generation
    const deadline = createSessionRecoveryDeadline()
    const restoring = (async () => {
      try {
        const token = await this.ensureSession(deadline)
        if (!token) return null
        if (generation !== this.generation) throw canceledRecovery()
        await this.hydrateUserAndPermissions(undefined, deadline)
        return getAccessToken()
      } catch (error) {
        if (generation === this.generation && isDefinitiveAuthFailure(error)) {
          this.clearLocalSession('expired')
          return null
        }
        throw error
      }
    })().finally(() => {
      if (this.protectedSessionPromise === restoring) this.protectedSessionPromise = null
    })
    this.protectedSessionPromise = restoring
    return restoring
  }

  /**
   * Wait for a protected-navigation restore that is already in flight.
   * Request transport calls this before sending without a memory token so a
   * page mounted immediately after the navigation guard cannot race the
   * cookie refresh and issue an unauthenticated request.
   */
  waitForPendingRestore(): Promise<string | null> {
    return this.restorePromise ?? Promise.resolve(getAccessToken())
  }

  async refresh(
    options: { skipImpersonationHandoff?: boolean; deadline?: number } = {},
  ): Promise<string | null> {
    if (this.restorePromise) return this.restorePromise

    const generation = this.generation
    const signal = this.recoveryController.signal
    const restoring = (async () => {
      const session = useSessionStore()
      // Do not transiently turn an established application shell anonymous
      // while refreshing an expired in-memory access token. In particular,
      // HomeFrameLayout mounts the sidebar from this state; changing it to
      // `restoring` destroys and recreates the menu on every token rotation.
      session.beginRestore(Boolean(getAccessToken()) && session.isAuthenticated)
      try {
        const result = await recoverSessionOperation(
          'refresh',
          (requestOptions) =>
            getAuthApi().refresh(
              { body: { skipImpersonationHandoff: options.skipImpersonationHandoff } },
              { ...requestOptions, retry: false, requestWrapper: async (promise) => promise },
            ),
          { signal, deadline: options.deadline ?? createSessionRecoveryDeadline() },
        )
        if (generation !== this.generation) throw canceledRecovery()
        if (result.code !== CustomCode.OK) {
          throw Object.assign(new Error(result.message || 'Session refresh rejected'), {
            code: result.code,
          })
        }
        if (!result.data?.access_token) throw new SessionExpiredError()
        const { impersonation } = result.data
        if (impersonation) {
          useImpersonationStore().setSession({
            targetUserId: impersonation.targetUser.id,
            targetUsername: impersonation.targetUser.username ?? '',
            targetName: impersonation.targetUser.name ?? null,
            mode: impersonation.mode,
            startedAt: Date.now(),
          })
        } else {
          useImpersonationStore().clearSession()
        }
        this.applyAccessToken(result.data.access_token)
        void ReplaySigningService.getInstance()
          .refreshSigningMaterial()
          .catch(() => undefined)
        void heartbeatService.start().catch(() => undefined)
        return result.data.access_token
      } catch (error) {
        if (generation !== this.generation || isRequestCanceled(error)) throw canceledRecovery()
        if (!(error instanceof SessionExpiredError) && !isDefinitiveAuthFailure(error)) {
          throw error instanceof SessionRestoreError ? error : new SessionRestoreError(error)
        }

        this.clearLocalSession('expired')
        return null
      }
    })().finally(() => {
      if (this.restorePromise === restoring) this.restorePromise = null
    })
    this.restorePromise = restoring
    return restoring
  }

  async hydrateUserAndPermissions(
    user?: Partial<UserDto>,
    deadline = createSessionRecoveryDeadline(),
  ): Promise<void> {
    if (this.hydratePromise) return this.hydratePromise
    const generation = this.generation
    const identity = this.getAuthorizationIdentity()
    const signal = this.recoveryController.signal
    const hydration = (async () => {
      const session = useSessionStore()
      const userInfoStore = useUserInfoStore()
      const permissionStore = usePermissionStore()
      const userId = getUserIdFromToken(getAccessToken()) || user?.id || userInfoStore.userInfo.id
      const version = getUserUpdatedAtFromToken(getAccessToken())
      if (!userId) throw new SessionRestoreError(new Error('Missing session identity'), 'profile')
      if (
        session.permissionsStatus === 'ready' &&
        permissionStore.isLoaded &&
        userInfoStore.isUserInfoFetched &&
        this.projectedUserId === userId &&
        this.projectedUserVersion === version
      )
        return

      session.setPermissionsStatus('loading')
      try {
        // Fetch without mutating stores. Only a complete, current projection may commit.
        const [profile, permissions] = await Promise.all([
          recoverSessionOperation(
            'profile',
            async (options) => {
              const { userService } = await import('@/service/userService')
              return userService.getMe(options)
            },
            { signal, deadline },
          ),
          recoverSessionOperation(
            'permissions',
            (options) => permissionService.getUserPermissions(userId, options),
            { signal, deadline },
          ),
        ])
        if (generation !== this.generation || identity !== this.getAuthorizationIdentity())
          throw canceledRecovery()
        if (
          profile.id !== userId ||
          permissions.code !== CustomCode.OK ||
          permissions.data?.userId !== userId ||
          !Array.isArray(permissions.data.effectivePermissions)
        ) {
          throw new SessionRestoreError(
            new Error('Invalid authorization projection'),
            'permissions',
          )
        }
        userInfoStore.setUserInfo(profile)
        userInfoStore.isUserInfoFetched = true
        permissionStore.applyCurrentUserPermissions(userId, permissions.data)
        session.setUser(userInfoStore.userInfo)
        setCurrentStorageScopeForUserId(userId)
        permissionStore.saveCurrentUserPermissionsCache(userId, version)
        this.projectedUserId = userId
        this.projectedUserVersion = version
        session.setPermissionsStatus('ready')
      } catch (error) {
        if (generation === this.generation) session.setPermissionsStatus('failed')
        throw error
      }
    })().finally(() => {
      if (this.hydratePromise === hydration) this.hydratePromise = null
    })
    this.hydratePromise = hydration
    return hydration
  }

  async activateAuthenticatedSession(auth: { access_token: string; user?: Partial<UserDto> }) {
    this.completeLogin(auth)
    await this.hydrateUserAndPermissions(auth.user)
  }

  private clearLocalSession(status: Extract<SessionStatus, 'anonymous' | 'expired'>) {
    this.invalidatePendingRecovery()
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
    const accessToken = getAccessToken()
    this.clearLocalSession('anonymous')
    const generation = this.generation
    this.logoutPromise = (async () => {
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
        if (generation === this.generation) this.clearLocalSession('anonymous')
      }
    })().finally(() => {
      this.logoutPromise = null
    })
    return this.logoutPromise
  }
}

export const sessionCoordinator = SessionCoordinator.getInstance()
