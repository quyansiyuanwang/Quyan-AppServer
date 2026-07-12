import { inject, type InjectionKey } from 'vue'
import type { RemoteTerminalProductManagementState } from './useRemoteTerminalProductManagement'

export const remoteTerminalProductManagementContextKey: InjectionKey<RemoteTerminalProductManagementState> =
  Symbol('remoteTerminalProductManagement')

export function useRemoteTerminalProductManagementContext(): RemoteTerminalProductManagementState {
  const context = inject(remoteTerminalProductManagementContextKey)

  if (!context) {
    throw new Error('RemoteTerminalProductManagement context is not provided')
  }

  return context
}
