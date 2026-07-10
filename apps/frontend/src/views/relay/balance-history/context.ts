import { inject, type InjectionKey } from 'vue'
import type { BalanceHistoryState } from './useBalanceHistory'

export const balanceHistoryContextKey: InjectionKey<BalanceHistoryState> = Symbol('balanceHistory')

export function useBalanceHistoryContext(): BalanceHistoryState {
  const context = inject(balanceHistoryContextKey)

  if (!context) {
    throw new Error('BalanceHistory context is not provided')
  }

  return context
}
