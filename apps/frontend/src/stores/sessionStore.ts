import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { UserDto } from '@/client/types.gen'

export type SessionStatus =
  | 'unknown'
  | 'restoring'
  | 'authenticated'
  | 'anonymous'
  | 'expired'
  | 'failed'

export type PermissionLoadStatus = 'idle' | 'loading' | 'ready' | 'failed'

export const useSessionStore = defineStore('session', () => {
  const status = ref<SessionStatus>('unknown')
  const accessToken = ref<string | null>(null)
  const user = ref<UserDto | null>(null)
  const identityProjectionVersion = ref(0)
  const permissionsStatus = ref<PermissionLoadStatus>('idle')
  const error = ref<unknown>(null)

  const isAuthenticated = computed(() => status.value === 'authenticated')
  // This is a remount token, not an identity label. The first projection after
  // a cold start keeps the same token so restoring a cookie session does not
  // remount the current route. Later user changes bump it.
  const identityKey = computed(() => String(identityProjectionVersion.value))
  let initialIdentityResolved = false

  /**
   * A cold Cookie restore has no trusted UI state yet. A token rotation during
   * an established session does, so keep that projection mounted until the
   * refresh either succeeds or conclusively expires.
   */
  const beginRestore = (preserveAuthenticatedState = false) => {
    if (!preserveAuthenticatedState || status.value !== 'authenticated') {
      status.value = 'restoring'
    }
    error.value = null
  }

  const setAuthenticated = (token: string) => {
    accessToken.value = token
    status.value = 'authenticated'
    error.value = null
  }

  const setAnonymous = (
    nextStatus: Extract<SessionStatus, 'anonymous' | 'expired'> = 'anonymous',
  ) => {
    accessToken.value = null
    setUser(null)
    permissionsStatus.value = 'idle'
    status.value = nextStatus
    error.value = null
    initialIdentityResolved = true
  }

  const setFailed = (cause: unknown) => {
    accessToken.value = null
    setUser(null)
    permissionsStatus.value = 'failed'
    status.value = 'failed'
    error.value = cause
    initialIdentityResolved = true
  }

  const setUser = (nextUser: Partial<UserDto> | null) => {
    const nextUserId = nextUser?.id || null
    const previousUserId = user.value?.id || null
    if (previousUserId !== nextUserId) {
      const isInitialIdentityProjection =
        !initialIdentityResolved && previousUserId === null && nextUserId !== null
      if (!isInitialIdentityProjection) identityProjectionVersion.value += 1
      initialIdentityResolved = true
    }
    user.value = nextUser ? (nextUser as UserDto) : null
  }

  const setPermissionsStatus = (nextStatus: PermissionLoadStatus) => {
    permissionsStatus.value = nextStatus
  }

  return {
    status,
    accessToken,
    user,
    permissionsStatus,
    error,
    isAuthenticated,
    identityProjectionVersion,
    identityKey,
    beginRestore,
    setAuthenticated,
    setAnonymous,
    setFailed,
    setUser,
    setPermissionsStatus,
  }
})
