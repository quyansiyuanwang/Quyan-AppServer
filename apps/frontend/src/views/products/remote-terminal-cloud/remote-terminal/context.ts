import { inject, type InjectionKey } from 'vue'
import type { RemoteTerminalManagementState } from './useRemoteTerminalManagement'

export const remoteTerminalManagementContextKey: InjectionKey<RemoteTerminalManagementState> =
  Symbol('remote-terminal-management')

export const useRemoteTerminalManagementContext = () => {
  const context = inject(remoteTerminalManagementContextKey)

  if (!context) {
    throw new Error('Remote terminal management context is not provided')
  }

  return context
}
