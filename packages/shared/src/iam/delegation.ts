export interface IamDelegationIssue {
  code:
    | 'proof-limit'
    | 'unproven-resource-subset'
    | 'unproven-condition-subset'
    | 'missing-allow-coverage'
    | 'explicit-deny-overlap'
  statementId: string
  action: string
}
export interface IamDelegationResult {
  allowed: boolean
  issues: IamDelegationIssue[]
}
