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
  const permissionsStatus = ref<PermissionLoadStatus>('idle')
  const error = ref<unknown>(null)

  const isAuthenticated = computed(() => status.value === 'authenticated')

  const beginRestore = () => {
    status.value = 'restoring'
    error.value = null
  }

  const setAuthenticated = (token: string) => {
    accessToken.value = token
    status.value = 'authenticated'
    error.value = null
  }

  const setAnonymous = (nextStatus: Extract<SessionStatus, 'anonymous' | 'expired'> = 'anonymous') => {
    accessToken.value = null
    user.value = null
    permissionsStatus.value = 'idle'
    status.value = nextStatus
    error.value = null
  }

  const setFailed = (cause: unknown) => {
    accessToken.value = null
    user.value = null
    permissionsStatus.value = 'failed'
    status.value = 'failed'
    error.value = cause
  }

  const setUser = (nextUser: UserDto | null) => {
    user.value = nextUser
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
    beginRestore,
    setAuthenticated,
    setAnonymous,
    setFailed,
    setUser,
    setPermissionsStatus,
  }
})
