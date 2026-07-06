import {
  NOTIFICATION_EVENT_I18N_KEYS,
  NOTIFICATION_EVENT_THRESHOLD_UNIT_I18N_KEYS,
  type NotificationEvent,
} from '@appserver/shared'
import { i18ns } from '@/locales'

export function getNotificationEventLabel(eventType: string): string {
  const key = NOTIFICATION_EVENT_I18N_KEYS[eventType as NotificationEvent]
  return key ? i18ns.t(key as any) : eventType
}

export function getNotificationThresholdUnit(eventType: string): string {
  const key = NOTIFICATION_EVENT_THRESHOLD_UNIT_I18N_KEYS[eventType as NotificationEvent]
  return key ? i18ns.t(key as any) : ''
}