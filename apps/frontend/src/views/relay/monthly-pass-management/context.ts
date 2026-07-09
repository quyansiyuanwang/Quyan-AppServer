import { inject, type InjectionKey } from 'vue'
import type { MonthlyPassManagementState } from './useMonthlyPassManagement'

export const monthlyPassManagementContextKey: InjectionKey<MonthlyPassManagementState> = Symbol(
  'monthly-pass-management',
)

export const useMonthlyPassManagementContext = () => {
  const context = inject(monthlyPassManagementContextKey)

  if (!context) {
    throw new Error('Monthly pass management context is not provided')
  }

  return context
}
