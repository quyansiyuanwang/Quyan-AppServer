import type { CarpoolOrderDto, CarpoolOrderState } from '@/client/types.gen'
import { i18ns } from '@/locales'

export const carpoolStates: CarpoolOrderState[] = [
  'open',
  'submitted',
  'accepted',
  'fulfilled',
  'failed',
  'cancelled',
  'expired',
]

export const formatCarpoolMoney = (value: number) =>
  new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(
    value,
  )

export const formatCarpoolQuota = (value: number, unit: string) => `${value} ${unit}`

export const formatCarpoolDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '-'

export const deadlineText = (deadline?: string) => {
  if (!deadline) return '-'
  const remaining = new Date(deadline).getTime() - Date.now()
  if (remaining <= 0) return i18ns.t('carpool.common.deadlinePassed')
  const hours = Math.ceil(remaining / 3_600_000)
  return hours >= 24
    ? i18ns.t('carpool.common.deadlineDays', { days: Math.ceil(hours / 24) })
    : i18ns.t('carpool.common.deadlineHours', { hours })
}

export const carpoolNextStep = (order: CarpoolOrderDto) => {
  if (order.state === 'open') {
    if (order.viewerActions?.canConfirm) return i18ns.t('carpool.next.confirm')
    if (order.viewerActions?.canSubmit) return i18ns.t('carpool.next.submit')
    if (order.viewerActions?.canInvite) return i18ns.t('carpool.next.invite')
    return i18ns.t('carpool.next.waiting')
  }
  const keys: Record<string, string> = {
    submitted: 'carpool.next.operatorReview',
    accepted: 'carpool.next.operatorDelivery',
    fulfilled: 'carpool.next.done',
    failed: 'carpool.next.failed',
    cancelled: 'carpool.next.closed',
    expired: 'carpool.next.closed',
  }
  const key = keys[order.state]
  return key
    ? ({
        'carpool.next.operatorReview': i18ns.t('carpool.next.operatorReview'),
        'carpool.next.operatorDelivery': i18ns.t('carpool.next.operatorDelivery'),
        'carpool.next.done': i18ns.t('carpool.next.done'),
        'carpool.next.failed': i18ns.t('carpool.next.failed'),
        'carpool.next.closed': i18ns.t('carpool.next.closed'),
      }[key] ?? i18ns.t('carpool.next.waiting'))
    : i18ns.t('carpool.next.waiting')
}

/** Maps immutable server audit-event types to localized, user-safe labels. */
export const carpoolEventLabel = (type: string) => {
  const labels: Record<string, string> = {
    created: i18ns.t('carpool.event.created'),
    invite_created: i18ns.t('carpool.event.invite_created'),
    member_joined: i18ns.t('carpool.event.member_joined'),
    member_rejoined: i18ns.t('carpool.event.member_rejoined'),
    allocation_updated: i18ns.t('carpool.event.allocation_updated'),
    member_confirmed: i18ns.t('carpool.event.member_confirmed'),
    member_left: i18ns.t('carpool.event.member_left'),
    cancelled: i18ns.t('carpool.event.cancelled'),
    expired: i18ns.t('carpool.event.expired'),
    submitted: i18ns.t('carpool.event.submitted'),
    accepted: i18ns.t('carpool.event.accepted'),
    fulfilled: i18ns.t('carpool.event.fulfilled'),
    failed: i18ns.t('carpool.event.failed'),
  }
  return labels[type] ?? type
}
