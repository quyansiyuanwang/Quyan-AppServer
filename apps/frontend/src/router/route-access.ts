import { readonly, ref } from 'vue'

export type RouteAccessStatus = 'idle' | 'redirecting' | 'denied' | 'error'

const status = ref<RouteAccessStatus>('idle')
const targetPath = ref<string | null>(null)
const requiredPermission = ref<string | null>(null)
const accessError = ref<unknown>(null)

export const routeAccessState = {
  status: readonly(status),
  targetPath: readonly(targetPath),
  requiredPermission: readonly(requiredPermission),
  error: readonly(accessError),
}

export const resetRouteAccess = (): void => {
  status.value = 'idle'
  targetPath.value = null
  requiredPermission.value = null
  accessError.value = null
}

export const markRouteRedirecting = (target: string): void => {
  status.value = 'redirecting'
  targetPath.value = target
  requiredPermission.value = null
  accessError.value = null
}

export const denyRouteAccess = (target: string, permission: string): void => {
  status.value = 'denied'
  targetPath.value = target
  requiredPermission.value = permission
  accessError.value = null
}

export const failRouteAccess = (target: string, error: unknown): void => {
  status.value = 'error'
  targetPath.value = target
  requiredPermission.value = null
  accessError.value = error
}
