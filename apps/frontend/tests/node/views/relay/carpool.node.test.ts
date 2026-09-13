import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CarpoolOrderDto } from '@/client/types.gen'
import { i18ns } from '@/locales'
import {
  carpoolEventLabel,
  carpoolNextStep,
  deadlineText,
  formatCarpoolMoney,
  formatCarpoolQuota,
} from '@/views/relay/carpool'

const createOrder = (overrides: Partial<CarpoolOrderDto> = {}): CarpoolOrderDto =>
  ({
    id: 'carpool-1',
    state: 'open',
    allocationMode: 'equal',
    packageName: 'Team plan',
    salePrice: 120,
    totalQuota: 1000,
    quotaUnit: 'credits',
    validityDays: 30,
    maxMembers: 3,
    members: [],
    events: [],
    paymentRatioTotal: 0,
    quotaRatioTotal: 0,
    activeMemberCount: 0,
    allConfirmed: false,
    ...overrides,
  }) as CarpoolOrderDto

describe('carpool view helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats user-facing money and quota values', () => {
    expect(formatCarpoolMoney(12.34567)).toMatch(/12[,.]3457/)
    expect(formatCarpoolQuota(128, 'credits')).toBe('128 credits')
  })

  it('shows a semantic passed, hourly, or daily formation deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T00:00:00.000Z'))

    expect(deadlineText('2026-09-12T23:59:59.000Z')).toBe(i18ns.t('carpool.common.deadlinePassed'))
    expect(deadlineText('2026-09-13T05:00:00.000Z')).toBe(
      i18ns.t('carpool.common.deadlineHours', { hours: 5 }),
    )
    expect(deadlineText('2026-09-15T00:00:00.000Z')).toBe(
      i18ns.t('carpool.common.deadlineDays', { days: 2 }),
    )
  })

  it('prioritizes the member or owner action that can advance an open order', () => {
    expect(carpoolNextStep(createOrder({ viewerActions: { canConfirm: true } }))).toBe(
      i18ns.t('carpool.next.confirm'),
    )
    expect(carpoolNextStep(createOrder({ viewerActions: { canSubmit: true } }))).toBe(
      i18ns.t('carpool.next.submit'),
    )
    expect(carpoolNextStep(createOrder({ viewerActions: { canInvite: true } }))).toBe(
      i18ns.t('carpool.next.invite'),
    )
    expect(carpoolNextStep(createOrder())).toBe(i18ns.t('carpool.next.waiting'))
  })

  it('maps terminal and operations states to their next-step copy', () => {
    expect(carpoolNextStep(createOrder({ state: 'submitted' }))).toBe(
      i18ns.t('carpool.next.operatorReview'),
    )
    expect(carpoolNextStep(createOrder({ state: 'accepted' }))).toBe(
      i18ns.t('carpool.next.operatorDelivery'),
    )
    expect(carpoolNextStep(createOrder({ state: 'fulfilled' }))).toBe(i18ns.t('carpool.next.done'))
    expect(carpoolNextStep(createOrder({ state: 'failed' }))).toBe(i18ns.t('carpool.next.failed'))
    expect(carpoolNextStep(createOrder({ state: 'cancelled' }))).toBe(
      i18ns.t('carpool.next.closed'),
    )
    expect(carpoolNextStep(createOrder({ state: 'expired' }))).toBe(i18ns.t('carpool.next.closed'))
  })

  it('maps every immutable server audit event to localized copy', () => {
    const events = [
      'created',
      'invite_created',
      'member_joined',
      'member_rejoined',
      'allocation_updated',
      'member_confirmed',
      'member_left',
      'cancelled',
      'expired',
      'submitted',
      'accepted',
      'fulfilled',
      'failed',
    ]

    for (const type of events) {
      expect(carpoolEventLabel(type)).toBe(i18ns.t(`carpool.event.${type}`))
    }
    expect(carpoolEventLabel('future_event')).toBe('future_event')
  })
})
