import { inject, type InjectionKey } from 'vue'
import type { AuthCenterClientManagementState } from './useAuthCenterClientManagement'

export const authCenterClientManagementContextKey: InjectionKey<AuthCenterClientManagementState> =
  Symbol('authCenterClientManagementContext')

export const useAuthCenterClientManagementContext = () => {
  const context = inject(authCenterClientManagementContextKey)
  if (!context) {
    throw new Error('Auth center client management context is not provided')
  }
  return context
}
