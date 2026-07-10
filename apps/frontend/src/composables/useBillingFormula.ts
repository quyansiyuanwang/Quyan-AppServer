import type { BalanceTransactionResponse } from '@/client/types.gen'

export const CACHE_CREATION_MULTIPLIER = 1.25
export const CACHE_READ_MULTIPLIER = 0.1

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isPositiveFiniteNumber = (value: number | null | undefined): value is number =>
  isFiniteNumber(value) && value > 0

const isNonDefaultMultiplier = (value: number): boolean => Math.abs(value - 1) > 1e-12

const normalizeMultiplierValue = (value: number | null | undefined): number =>
  isPositiveFiniteNumber(value) ? value : 1

export const hasFormulaFields = (tx: BalanceTransactionResponse): boolean =>
  isFiniteNumber(tx.inputTokens) &&
  isFiniteNumber(tx.outputTokens) &&
  isFiniteNumber(tx.inputRate) &&
  isFiniteNumber(tx.outputRate)

export const hasPerRequestFormulaFields = (tx: BalanceTransactionResponse): boolean =>
  tx.pricingType === 'per-request' && isFiniteNumber(tx.fixedPrice)

export const resolveModelMultiplier = (tx: BalanceTransactionResponse): number =>
  normalizeMultiplierValue(tx.multiplier)

export const resolveGlobalMultiplier = (tx: BalanceTransactionResponse): number =>
  normalizeMultiplierValue(tx.globalMultiplier)

export const resolveChannelMultiplier = (tx: BalanceTransactionResponse): number =>
  normalizeMultiplierValue(tx.channelMultiplier)

export const resolveTimeMultiplier = (tx: BalanceTransactionResponse): number =>
  normalizeMultiplierValue(tx.timeMultiplier)

export const resolveEffectiveMultiplier = (tx: BalanceTransactionResponse): number =>
  resolveModelMultiplier(tx) *
  resolveGlobalMultiplier(tx) *
  resolveChannelMultiplier(tx) *
  resolveTimeMultiplier(tx)

export const shouldShowModelMultiplier = (tx: BalanceTransactionResponse): boolean =>
  isNonDefaultMultiplier(resolveModelMultiplier(tx))

export const shouldShowGlobalMultiplier = (tx: BalanceTransactionResponse): boolean =>
  isNonDefaultMultiplier(resolveGlobalMultiplier(tx))

export const shouldShowChannelMultiplier = (tx: BalanceTransactionResponse): boolean =>
  isNonDefaultMultiplier(resolveChannelMultiplier(tx))

export const shouldShowTimeMultiplier = (tx: BalanceTransactionResponse): boolean =>
  isNonDefaultMultiplier(resolveTimeMultiplier(tx))

export const shouldShowMultiplier = (tx: BalanceTransactionResponse): boolean =>
  isNonDefaultMultiplier(resolveEffectiveMultiplier(tx))

export const shouldShowCacheCreationMultiplier = (tx: BalanceTransactionResponse): boolean =>
  isPositiveFiniteNumber(tx.cacheCreationTokens) &&
  resolveCacheCreationMultiplier(tx) !== CACHE_CREATION_MULTIPLIER

export const shouldShowCacheReadMultiplier = (tx: BalanceTransactionResponse): boolean =>
  isPositiveFiniteNumber(tx.cacheReadTokens) &&
  resolveCacheReadMultiplier(tx) !== CACHE_READ_MULTIPLIER

export const resolveCacheCreationMultiplier = (tx: BalanceTransactionResponse): number =>
  tx.cacheCreationMultiplier ?? CACHE_CREATION_MULTIPLIER

export const resolveCacheReadMultiplier = (tx: BalanceTransactionResponse): number =>
  tx.cacheReadMultiplier ?? CACHE_READ_MULTIPLIER

const extractMonthlyPassCoveredAmount = (description?: string): number | null => {
  if (!description) return null

  const match = description.match(/(?:[¥￥曲]\s*([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)\s*曲)/)
  if (!match) return null

  const coveredAmount = Number(match[1] ?? match[2])
  return Number.isFinite(coveredAmount) ? coveredAmount : null
}

const resolveFormulaTotalAmount = (tx: BalanceTransactionResponse): number | null => {
  if (tx.type !== 'monthly_pass_coverage') return Math.abs(tx.amount)

  const coveredAmount = extractMonthlyPassCoveredAmount(tx.description)
  return coveredAmount == null ? null : Math.abs(coveredAmount)
}

export const buildBillingFormula = (tx: BalanceTransactionResponse, unitLabel: string): string => {
  // 按次计费模型：显示固定价格公式
  if (tx.pricingType === 'per-request') {
    const fixedPrice = tx.fixedPrice ?? 0
    const formulaTotalAmount = resolveFormulaTotalAmount(tx)
    const effectiveMultiplier = resolveEffectiveMultiplier(tx)

    if (formulaTotalAmount == null) return `${fixedPrice}`

    if (shouldShowMultiplier(tx)) {
      const multiplierFactors = [
        shouldShowGlobalMultiplier(tx) ? resolveGlobalMultiplier(tx) : null,
        shouldShowChannelMultiplier(tx) ? resolveChannelMultiplier(tx) : null,
        shouldShowTimeMultiplier(tx) ? resolveTimeMultiplier(tx) : null,
      ]
        .filter((value): value is number => value !== null)
        .map((value) => `${value}`)

      if (multiplierFactors.length === 0) multiplierFactors.push(`${effectiveMultiplier}`)

      return `${fixedPrice} × ${multiplierFactors.join(' × ')} = ${formulaTotalAmount} ${unitLabel}`
    }

    return `${fixedPrice} = ${formulaTotalAmount} ${unitLabel}`
  }

  // 按 token 计费模型：显示 token 计算公式
  if (!hasFormulaFields(tx)) return ''

  const inputTokens = tx.inputTokens ?? 0
  const outputTokens = tx.outputTokens ?? 0
  const inputRate = tx.inputRate ?? 0
  const outputRate = tx.outputRate ?? 0

  const terms = [
    `${inputTokens} × ${inputRate}`,
    isPositiveFiniteNumber(tx.cacheCreationTokens) && resolveCacheCreationMultiplier(tx) !== 0
      ? `${tx.cacheCreationTokens} × ${inputRate} × ${resolveCacheCreationMultiplier(tx)}`
      : '',
    isPositiveFiniteNumber(tx.cacheReadTokens) && resolveCacheReadMultiplier(tx) !== 0
      ? `${tx.cacheReadTokens} × ${inputRate} × ${resolveCacheReadMultiplier(tx)}`
      : '',
    `${outputTokens} × ${outputRate}`,
  ].filter(Boolean)

  const baseExpression = terms.join(' + ')
  const formulaTotalAmount = resolveFormulaTotalAmount(tx)
  const effectiveMultiplier = resolveEffectiveMultiplier(tx)

  if (formulaTotalAmount == null) return baseExpression

  if (shouldShowMultiplier(tx)) {
    const multiplierFactors = [
      shouldShowModelMultiplier(tx) ? resolveModelMultiplier(tx) : null,
      shouldShowGlobalMultiplier(tx) ? resolveGlobalMultiplier(tx) : null,
      shouldShowChannelMultiplier(tx) ? resolveChannelMultiplier(tx) : null,
      shouldShowTimeMultiplier(tx) ? resolveTimeMultiplier(tx) : null,
    ]
      .filter((value): value is number => value !== null)
      .map((value) => `${value}`)

    if (multiplierFactors.length === 0) multiplierFactors.push(`${effectiveMultiplier}`)

    return `(${baseExpression}) × ${multiplierFactors.join(' × ')} = ${formulaTotalAmount} ${unitLabel}`
  }

  return `${baseExpression} = ${formulaTotalAmount} ${unitLabel}`
}
