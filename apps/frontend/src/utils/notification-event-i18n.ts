import {
  ALL_NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_I18N_KEYS,
  NOTIFICATION_EVENT_THRESHOLD_UNIT_I18N_KEYS,
  THRESHOLD_NOTIFICATION_EVENTS,
  type NotificationEvent,
} from '@appserver/shared'
import { i18ns } from '@/locales'

const notificationEventSet = new Set<string>(ALL_NOTIFICATION_EVENTS)
type ThresholdNotificationEvent = (typeof THRESHOLD_NOTIFICATION_EVENTS)[number]
const thresholdNotificationEventSet = new Set<ThresholdNotificationEvent>(THRESHOLD_NOTIFICATION_EVENTS)

const isNotificationEvent = (eventType: string): eventType is NotificationEvent =>
  notificationEventSet.has(eventType)

const isThresholdNotificationEvent = (
  eventType: string,
): eventType is ThresholdNotificationEvent => thresholdNotificationEventSet.has(eventType as ThresholdNotificationEvent)

export function getNotificationEventLabel(eventType: string): string {
  if (!isNotificationEvent(eventType)) return eventType
  return i18ns.t(NOTIFICATION_EVENT_I18N_KEYS[eventType])
}

export function getNotificationThresholdUnit(eventType: string): string {
  if (!isThresholdNotificationEvent(eventType)) return ''
  const key = NOTIFICATION_EVENT_THRESHOLD_UNIT_I18N_KEYS[eventType]
  return key ? i18ns.t(key) : ''
}
