// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { BalanceTransactionResponse } from '@/client/types.gen'
import {
  extractMonthlyPassCoveredAmount,
  getTransactionCategory,
  isApiUsageRecord,
  isChargeableApiUsageRecord,
  isMonthlyPassCoverage,
  isZeroChargeUpstreamError,
} from '@/utils/balance-transaction'

const createTransaction = (
  overrides: Partial<BalanceTransactionResponse> = {},
): BalanceTransactionResponse =>
  ({
    id: 'tx-1',
    type: 'recharge',
    amount: -1,
    balanceAfter: 99,
    createTime: '2026-04-26T00:00:00.000Z',
    description: 'API调用: /relay/proxy/v1/chat/completions',
    model: 'gpt-4o',
    ...overrides,
  }) as BalanceTransactionResponse

describe('balance-transaction utils', () => {
  it('classifies chat usage from recharge-style legacy records', () => {
    const record = createTransaction({
      description: 'API调用: /chat/conversations/123/messages',
    })

    expect(isApiUsageRecord(record)).toBe(true)
    expect(getTransactionCategory(record)).toBe('chat_usage')
  })

  it('detects monthly pass coverage and extracts covered amount', () => {
    const record = createTransaction({
      type: 'recharge',
      amount: 0,
      description: '月卡抵扣: 已覆盖 ¥12.50',
      model: undefined,
    })

    expect(isMonthlyPassCoverage(record)).toBe(true)
    expect(getTransactionCategory(record)).toBe('monthly_pass_coverage')
    expect(extractMonthlyPassCoveredAmount(record.description)).toBe(12.5)
  })

  it('marks upstream zero-charge failures as non-chargeable api usage', () => {
    const record = createTransaction({
      type: 'api_usage',
      amount: 0,
      description: 'API调用失败(上游错误，未扣费): /relay/proxy/v1/chat/completions',
    })

    expect(getTransactionCategory(record)).toBe('api_usage')
    expect(isZeroChargeUpstreamError(record)).toBe(true)
    expect(isChargeableApiUsageRecord(record)).toBe(false)
  })

  it('keeps ordinary zero-amount api records chargeable when no upstream-error marker exists', () => {
    const record = createTransaction({
      type: 'api_usage',
      amount: 0,
      description: 'API调用: /relay/proxy/v1/chat/completions',
    })

    expect(isZeroChargeUpstreamError(record)).toBe(false)
    expect(isChargeableApiUsageRecord(record)).toBe(true)
  })
})
