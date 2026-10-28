import type { IamCondition } from './condition'
/** Strict identity-policy subset. Unsupported IAM fields must be rejected. */
export type IamEffect = 'Allow' | 'Deny'
export interface IamStatementFields {
  Sid?: string
  Effect: IamEffect
  Resource: string | string[]
  Condition?: IamCondition
}
export interface IamActionStatement extends IamStatementFields {
  Action: string | string[]
}
export interface IamNotActionStatement extends IamStatementFields {
  NotAction: string | string[]
}
/** Exactly one selector; NotAction is compiled to a finite catalog snapshot before persistence. */
export type IamStatement = IamActionStatement | IamNotActionStatement
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
