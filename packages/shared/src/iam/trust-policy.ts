import type { IamStatement, NormalizedIamStatement } from './policy'
export type IamPolicyKind = 'identity' | 'trust' | 'resource'
/** First release accepts exact current-account RAM user principals only. */
export interface IamPrincipalSelector {
  RAM: string | string[]
}
export interface IamTrustStatement extends IamStatement {
  Principal: IamPrincipalSelector
}
export interface IamTrustPolicyDocument {
  Version: '1'
  Statement: IamTrustStatement | IamTrustStatement[]
}
export interface NormalizedIamTrustStatement extends NormalizedIamStatement {
  Principal: { RAM: string[] }
}
export interface NormalizedIamTrustPolicyDocument {
  Version: '1'
  Statement: NormalizedIamTrustStatement[]
}
