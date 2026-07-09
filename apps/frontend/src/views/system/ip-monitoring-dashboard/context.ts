import { inject, type InjectionKey } from 'vue'
import type { IpMonitoringDashboardState } from './useIpMonitoringDashboard'

export const ipMonitoringDashboardContextKey: InjectionKey<IpMonitoringDashboardState> =
  Symbol('ip-monitoring-dashboard')

export const useIpMonitoringDashboardContext = () => {
  const context = inject(ipMonitoringDashboardContextKey)

  if (!context) {
    throw new Error('IP monitoring dashboard context is not provided')
  }

  return context
}
