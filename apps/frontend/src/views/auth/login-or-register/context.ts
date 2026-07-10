import type { InjectionKey } from 'vue'
import type { LoginOrRegisterState } from './useLoginOrRegister'
import { inject } from 'vue'

export const loginOrRegisterContextKey: InjectionKey<LoginOrRegisterState> =
  Symbol('loginOrRegisterContext')

export function useLoginOrRegisterContext() {
  const context = inject(loginOrRegisterContextKey)

  if (!context) {
    throw new Error('LoginOrRegister context is not provided')
  }

  return context
}
