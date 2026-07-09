import { inject, type InjectionKey } from 'vue'
import type { RelayTokenManagementState } from './useRelayTokenManagement'

export const relayTokenManagementContextKey: InjectionKey<RelayTokenManagementState> = Symbol(
  'relay-token-management',
)

export const useRelayTokenManagementContext = () => {
  const context = inject(relayTokenManagementContextKey)

  if (!context) {
    throw new Error('Relay token management context is not provided')
  }

  return context
}
