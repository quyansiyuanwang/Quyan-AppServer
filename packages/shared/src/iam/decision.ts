export type IamDecision = 'Allow' | 'ExplicitDeny' | 'ImplicitDeny'
export type IamDecisionReason =
  | 'matched-allow'
  | 'explicit-deny'
  | 'no-matching-allow'
  | 'invalid-request'
export interface IamMatchedStatement {
  policyId: string
  versionId?: string
  statementId: string
  effect: 'Allow' | 'Deny'
}
export interface IamEvaluationRequest {
  action: string
  resource: string
}
export interface IamEvaluationResult {
  decision: IamDecision
  reason: IamDecisionReason
  matchedStatements: IamMatchedStatement[]
}
