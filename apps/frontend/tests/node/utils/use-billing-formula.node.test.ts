import { describe, expect, it } from 'vitest'
import type { BalanceTransactionResponse } from '@/client/types.gen'
import {
  buildBillingFormula,
  hasPerRequestFormulaFields,
  resolveEffectiveMultiplier,
  shouldShowChannelMultiplier,
  shouldShowGlobalMultiplier,
  shouldShowModelMultiplier,
  shouldShowMultiplier,
} from '@/composables/useBillingFormula'

const createTx = (
  overrides: Partial<BalanceTransactionResponse> = {},
): BalanceTransactionResponse => ({
  id: 'tx_1',
  userId: 'user_1',
  type: 'api_usage',
  category: 'api_usage',
  amount: -1,
  balanceBefore: 100,
  balanceAfter: 99,
  inputTokens: 1,
  outputTokens: 1,
  inputRate: 1,
  outputRate: 1,
  createTime: '2026-04-10T00:00:00.000Z',
  ...overrides,
})

describe('useBillingFormula', () => {
  it('combines model/global/channel multipliers into effective multiplier', () => {
    const tx = createTx({
      multiplier: 1,
      globalMultiplier: 3,
      channelMultiplier: 5,
    })

    expect(resolveEffectiveMultiplier(tx)).toBe(15)
    expect(shouldShowModelMultiplier(tx)).toBe(false)
    expect(shouldShowGlobalMultiplier(tx)).toBe(true)
    expect(shouldShowChannelMultiplier(tx)).toBe(true)
    expect(shouldShowMultiplier(tx)).toBe(true)
  })

  it('includes the context multiplier in the auditable formula', () => {
    const tx = createTx({
      inputTokens: 10,
      outputTokens: 5,
      inputRate: 1,
      outputRate: 1,
      channelMultiplier: 2,
      contextTokens: 128000,
      contextMultiplier: 1.5,
      amount: -45,
    })

    expect(resolveEffectiveMultiplier(tx)).toBe(3)
    expect(buildBillingFormula(tx, '元')).toContain('× 2 × 1.5')
  })

  it('builds formula text with global and channel multipliers', () => {
    const tx = createTx({
      inputTokens: 27,
      outputTokens: 87,
      cacheCreationTokens: 62850,
      cacheReadTokens: 9425,
      inputRate: 0.000021,
      outputRate: 0.000105,
      cacheCreationMultiplier: 1.25,
      cacheReadMultiplier: 0.1,
      multiplier: 1,
      globalMultiplier: 3,
      channelMultiplier: 5,
      amount: -25.1897,
    })

    const formula = buildBillingFormula(tx, '元')

    expect(formula).toContain('× 3 × 5')
    expect(formula).toContain('= 25.1897 元')
  })

  it('keeps old behavior when only model multiplier is configured', () => {
    const tx = createTx({
      inputTokens: 1,
      outputTokens: 0,
      inputRate: 1,
      outputRate: 0,
      multiplier: 2,
      globalMultiplier: 1,
      channelMultiplier: 1,
      amount: -2,
    })

    const formula = buildBillingFormula(tx, '元')

    expect(formula).toContain('× 2')
    expect(formula).toContain('= 2 元')
  })

  it('supports per-request fixed-price formula metadata', () => {
    const tx = createTx({
      pricingType: 'per-request',
      fixedPrice: 0.25,
      inputTokens: undefined,
      outputTokens: undefined,
      inputRate: undefined,
      outputRate: undefined,
      amount: -0.25,
    })

    expect(hasPerRequestFormulaFields(tx)).toBe(true)
    expect(buildBillingFormula(tx, '元')).toBe('0.25 = 0.25 元')
  })
})
