import type { IamCondition } from './condition'
/** Strict identity-policy subset. Unsupported IAM fields must be rejected. */
export type IamEffect = 'Allow' | 'Deny'
export interface IamStatement {
  Sid?: string
  Effect: IamEffect
  Action: string | string[]
  Resource: string | string[]
  Condition?: IamCondition
}
export interface IamPolicyDocument {
  Version: '1'
  Statement: IamStatement | IamStatement[]
}
export interface NormalizedIamStatement {
  Sid?: string
  Effect: IamEffect
  Action: string[]
  Resource: string[]
  Condition?: IamCondition
}
export interface NormalizedIamPolicyDocument {
  Version: '1'
  Statement: NormalizedIamStatement[]
}
export type IamAuthorizationMode = 'legacy' | 'shadow' | 'enforce'
