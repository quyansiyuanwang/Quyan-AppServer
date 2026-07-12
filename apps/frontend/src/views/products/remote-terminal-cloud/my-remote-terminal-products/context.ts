import { inject, type InjectionKey } from 'vue'
import type { MyRemoteTerminalProductsState } from './useMyRemoteTerminalProducts'

export const myRemoteTerminalProductsContextKey: InjectionKey<MyRemoteTerminalProductsState> =
  Symbol('my-remote-terminal-products')

export const useMyRemoteTerminalProductsContext = () => {
  const context = inject(myRemoteTerminalProductsContextKey)

  if (!context) {
    throw new Error('My remote terminal products context is not provided')
  }

  return context
}
