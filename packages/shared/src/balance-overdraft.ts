export const BALANCE_OVERDRAFT_CATEGORIES = [
  'relay',
  'chat',
  'developer',
  'oj',
  'monthly_pass',
  'carpool',
  'terminal',
] as const
export type BalanceOverdraftCategory = (typeof BALANCE_OVERDRAFT_CATEGORIES)[number]

export const BALANCE_OVERDRAFT_MODES = [
  'disabled',
  'fixed',
  'percent',
  'sum',
  'max',
  'min',
  'formula',
] as const
export type BalanceOverdraftMode = (typeof BALANCE_OVERDRAFT_MODES)[number]

export interface BalanceOverdraftRule {
  mode: BalanceOverdraftMode
  fixedAmount: number
  percent: number
  minimum: number
  maximum: number | null
  formula: string
}

export const BALANCE_MANAGEMENT_POLICY = Object.freeze({
  batchSize: 200,
  maximumAmount: 999999.9999,
  decimals: 4,
  formulaLength: 512,
  formulaNodes: 128,
  formulaDepth: 16,
  defaultId: 'default',
})

export const DEFAULT_BALANCE_OVERDRAFT_RULE: Readonly<BalanceOverdraftRule> = Object.freeze({
  mode: 'disabled',
  fixedAmount: 0,
  percent: 0,
  minimum: 0,
  maximum: null,
  formula: 'totalRecharged * percent / 100',
})
export const DEFAULT_BALANCE_OVERDRAFT_CATEGORIES: readonly BalanceOverdraftCategory[] =
  Object.freeze(['relay', 'chat'])
