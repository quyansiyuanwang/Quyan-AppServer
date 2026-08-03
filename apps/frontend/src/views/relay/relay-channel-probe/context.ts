import { inject, type InjectionKey } from 'vue'
import type { RelayChannelProbeManagementState } from './useRelayChannelProbeManagement'

export const relayChannelProbeManagementContextKey: InjectionKey<RelayChannelProbeManagementState> =
  Symbol('relay-channel-probe-management')

export const useRelayChannelProbeManagementContext = () => {
  const context = inject(relayChannelProbeManagementContextKey)

  if (!context) throw new Error('Relay channel probe management context is not provided')

  return context
}
