import { inject, type InjectionKey } from 'vue'
import type { NotificationSettingsState } from './useNotificationSettings'

export const notificationSettingsContextKey: InjectionKey<NotificationSettingsState> = Symbol(
  'notificationSettingsContext',
)

export const useNotificationSettingsContext = () => {
  const context = inject(notificationSettingsContextKey)
  if (!context) {
    throw new Error('Notification settings context is not provided')
  }
  return context
}
