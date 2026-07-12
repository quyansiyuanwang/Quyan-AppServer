import { inject, type InjectionKey } from 'vue'
import type { RelaySettingsManagementState } from './useRelaySettingsManagement'

export const relaySettingsManagementContextKey: InjectionKey<RelaySettingsManagementState> = Symbol(
  'relay-settings-management',
)

export const useRelaySettingsManagementContext = () => {
  const context = inject(relaySettingsManagementContextKey)

  if (!context) {
    throw new Error('Relay settings management context is not provided')
  }

  return context
}
