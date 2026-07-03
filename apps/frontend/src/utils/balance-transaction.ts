import type { BalanceTransactionResponse } from '@/client/types.gen'

export type TransactionCategory =
  | 'redemption'
  | 'chat_usage'
  | 'api_usage'
  | 'monthly_pass_coverage'
  | 'recharge'

const MONTHLY_PASS_COVERAGE_PATTERNS = [/^\s*月卡抵扣\s*[:：]/, /^\s*monthly\s+pass\s+coverage\b/i]
const ZERO_CHARGE_UPSTREAM_ERROR_PATTERNS = [
  /上游错误/,
  /未扣费/,
  /upstream\s+error/i,
  /\bno\s*charge\b/i,
  /not\s+charged/i,
]

export const getBackendCategory = (tx: BalanceTransactionResponse): TransactionCategory | null => {
  const category = (tx as BalanceTransactionResponse & { category?: string }).category

  if (
    category === 'redemption' ||
    category === 'chat_usage' ||
    category === 'api_usage' ||
    category === 'monthly_pass_coverage' ||
    category === 'recharge'
  ) {
    return category
  }

  return null
}

export const isChatDescription = (description?: string) => {
  if (!description) return false
  if (description.startsWith('AI对话 -') || description.startsWith('Web Chat -')) return true

  if (!description.startsWith('API调用:')) return false

  const path = description.slice('API调用:'.length).trim().toLowerCase()
  return path.startsWith('/chat/conversations/') || path.startsWith('/v1/chat/conversations/')
}

export const isMonthlyPassCoverageDescription = (description?: string) => {
  if (!description) return false

  const normalizedDescription = description.trim()
  return MONTHLY_PASS_COVERAGE_PATTERNS.some((pattern) => pattern.test(normalizedDescription))
}

export const isApiUsageRecord = (tx: BalanceTransactionResponse) => {
  if (tx.type === 'api_usage') return true

  if (isMonthlyPassCoverageDescription(tx.description)) return false

  return (
    tx.type === 'recharge' &&
    Number(tx.amount) < 0 &&
    (Boolean(tx.model) || isChatDescription(tx.description))
  )
}

export const getTransactionCategory = (tx: BalanceTransactionResponse): TransactionCategory => {
  const backendCategory = getBackendCategory(tx)
  if (backendCategory) return backendCategory

  if (isMonthlyPassCoverageDescription(tx.description)) return 'monthly_pass_coverage'
  if (tx.type === 'monthly_pass_coverage') return 'monthly_pass_coverage'
  if (tx.type === 'redemption') return 'redemption'
  if (isApiUsageRecord(tx)) return isChatDescription(tx.description) ? 'chat_usage' : 'api_usage'
  return 'recharge'
}

export const isMonthlyPassCoverage = (tx: BalanceTransactionResponse): boolean =>
  getTransactionCategory(tx) === 'monthly_pass_coverage'

export const isZeroChargeUpstreamError = (tx: BalanceTransactionResponse): boolean => {
  if (getTransactionCategory(tx) !== 'api_usage') return false

  const numericAmount = Number(tx.amount)
  if (!Number.isFinite(numericAmount) || numericAmount !== 0) return false

  const description = tx.description?.trim()
  if (!description) return false

  return ZERO_CHARGE_UPSTREAM_ERROR_PATTERNS.some((pattern) => pattern.test(description))
}

export const isChargeableApiUsageRecord = (tx: BalanceTransactionResponse): boolean =>
  isApiUsageRecord(tx) && !isZeroChargeUpstreamError(tx)

export const extractMonthlyPassCoveredAmount = (description?: string): number | null => {
  if (!description) return null

  const match = description.match(/(?:[¥￥曲]\s*([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)\s*曲)/)
  if (!match) return null

  const amount = Number(match[1] ?? match[2])
  return Number.isFinite(amount) ? amount : null
}
