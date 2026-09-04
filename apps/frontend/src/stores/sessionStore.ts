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
  const identityKey = computed(
    () => `${user.value?.id || 'anonymous'}:${identityProjectionVersion.value}`,
  )

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
  }

  const setFailed = (cause: unknown) => {
    accessToken.value = null
    setUser(null)
    permissionsStatus.value = 'failed'
    status.value = 'failed'
    error.value = cause
  }

  const setUser = (nextUser: Partial<UserDto> | null) => {
    const nextUserId = nextUser?.id || null
    if ((user.value?.id || null) !== nextUserId) identityProjectionVersion.value += 1
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
