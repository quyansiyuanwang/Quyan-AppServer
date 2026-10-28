import type { IamConditionContext } from './condition'
export type IamDecision = 'Allow' | 'ExplicitDeny' | 'ImplicitDeny'
export type IamDecisionReason =
  | 'matched-allow'
  | 'explicit-deny'
  | 'no-matching-allow'
  | 'invalid-request'
  | 'missing-condition-context'
export interface IamMatchedStatement {
  authorizationId?: string
  policyId: string
  versionId?: string
  statementId: string
  effect: 'Allow' | 'Deny'
}
export interface IamEvaluationRequest {
  action: string
  resource: string
  context?: IamConditionContext
}
export interface IamEvaluationResult {
  decision: IamDecision
  reason: IamDecisionReason
  matchedStatements: IamMatchedStatement[]
}
