import { inject, type InjectionKey } from 'vue'
import type { GroupManagementState } from './useGroupManagement'

export const groupManagementContextKey: InjectionKey<GroupManagementState> =
  Symbol('groupManagementContext')

export const useGroupManagementContext = () => {
  const context = inject(groupManagementContextKey)
  if (!context) {
    throw new Error('Group management context is not provided')
  }
  return context
}
