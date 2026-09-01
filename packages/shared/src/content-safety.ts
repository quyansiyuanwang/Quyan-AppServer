export type ContentSafetyDirection = 'request' | 'response'
export type ContentSafetyAction = 'unreachable' | 'blackhole' | 'allow'
export type ContentSafetyRuleType = 'literal' | 'regex'

export interface ContentSafetyPolicyOverride {
  requestEnabled?: boolean | null
  requestAction?: ContentSafetyAction | null
  /** Caps the strongest request-side disposition allowed by this scope. */
  requestMaxAction?: ContentSafetyAction | null
  requestAiEnabled?: boolean | null
  requestAiAction?: ContentSafetyAction | null
  responseEnabled?: boolean | null
  responseAction?: ContentSafetyAction | null
  /** Caps the strongest response-side disposition allowed by this scope. */
  responseMaxAction?: ContentSafetyAction | null
  responseAiEnabled?: boolean | null
  responseAiAction?: ContentSafetyAction | null
}

export interface ContentSafetyUserConfig extends ContentSafetyPolicyOverride {
  requestEnabled: boolean | null
  requestAction: ContentSafetyAction | null
  requestMaxAction: ContentSafetyAction | null
  requestAiEnabled: boolean | null
  requestAiAction: ContentSafetyAction | null
  responseEnabled: boolean | null
  responseAction: ContentSafetyAction | null
  responseMaxAction: ContentSafetyAction | null
  responseAiEnabled: boolean | null
  responseAiAction: ContentSafetyAction | null
}

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
