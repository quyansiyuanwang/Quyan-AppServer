import { readonly, ref } from 'vue'

export type RouteAccessStatus = 'idle' | 'recovering' | 'redirecting' | 'denied' | 'error'

const status = ref<RouteAccessStatus>('idle')
const targetPath = ref<string | null>(null)
const requiredPermission = ref<string | null>(null)
const accessError = ref<unknown>(null)
const preserveView = ref(false)

export const routeAccessState = {
  status: readonly(status),
  targetPath: readonly(targetPath),
  requiredPermission: readonly(requiredPermission),
  error: readonly(accessError),
  preserveView: readonly(preserveView),
}

export const resetRouteAccess = (): void => {
  preserveView.value = false
  status.value = 'idle'
  targetPath.value = null
  requiredPermission.value = null
  accessError.value = null
}

export const markRouteRedirecting = (target: string): void => {
  preserveView.value = false
  status.value = 'redirecting'
  targetPath.value = target
  requiredPermission.value = null
  accessError.value = null
}

export const denyRouteAccess = (target: string, permission: string): void => {
  preserveView.value = false
  status.value = 'denied'
  targetPath.value = target
  requiredPermission.value = permission
  accessError.value = null
}

export const beginRouteRecovery = (target: string, preserve = false): void => {
  status.value = 'recovering'
  targetPath.value = target
  preserveView.value = preserve
  accessError.value = null
}

export const failRouteAccess = (target: string, error: unknown, preserve = false): void => {
  preserveView.value = preserve
  status.value = 'error'
  targetPath.value = target
  requiredPermission.value = null
  accessError.value = error
}
