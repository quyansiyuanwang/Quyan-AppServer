export type ContentSafetyDirection = 'request' | 'response'
export type ContentSafetyAction = 'unreachable' | 'blackhole' | 'allow'
export type ContentSafetyRuleType = 'literal' | 'regex'

export interface ContentSafetyRuleInput {
  name: string
  type: ContentSafetyRuleType
  pattern: string
  direction: ContentSafetyDirection | 'both'
  action: ContentSafetyAction
  enabled?: boolean
  priority?: number
}

export interface ContentSafetyMatch {
  ruleId?: string
  ruleType: ContentSafetyRuleType | 'ai'
  action: ContentSafetyAction
  direction: ContentSafetyDirection
}
