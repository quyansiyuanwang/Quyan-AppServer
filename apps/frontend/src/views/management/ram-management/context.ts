import { inject, type InjectionKey } from 'vue'
import type { RamManagementState } from './useRamManagement'

export const ramManagementContextKey: InjectionKey<RamManagementState> = Symbol('ramManagement')

export function useRamManagementContext(): RamManagementState {
  const context = inject(ramManagementContextKey)

  if (!context) {
    throw new Error('RamManagement context is not provided')
  }

  return context
}
