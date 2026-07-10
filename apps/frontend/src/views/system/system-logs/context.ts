import { inject, type InjectionKey } from 'vue'
import type { SystemLogsState } from './useSystemLogs'

export const systemLogsContextKey: InjectionKey<SystemLogsState> = Symbol('systemLogsContext')

export const useSystemLogsContext = () => {
  const context = inject(systemLogsContextKey)
  if (!context) {
    throw new Error('System logs context is not provided')
  }
  return context
}
