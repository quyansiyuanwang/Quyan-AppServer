import type { IamDiagnostic } from './diagnostic'
import type { IamPolicyDocument } from './policy'
import type { IamTrustPolicyDocument } from './trust-policy'

export type IamPolicyDraftKind = 'identity' | 'trust'
export type IamPolicyDraftDelegation = 'not-evaluated' | 'allowed' | 'denied'
export type IamPolicyDraftRiskLevel = 'low' | 'medium' | 'high'

export interface IamPolicyDraftRequest {
  instruction: string
  model: string
  relayTokenId: string
  policyKind?: IamPolicyDraftKind
  currentDocumentText?: string
}

export interface IamPolicyDraftResponse {
  document?: IamPolicyDocument | IamTrustPolicyDocument
  explanation: string[]
  diagnostics: IamDiagnostic[]
  riskLevel: IamPolicyDraftRiskLevel
  missingInformation: string[]
  delegation: IamPolicyDraftDelegation
}

/** Shared limits for policy-draft input; internal generation capacities remain server-owned. */
export const IAM_POLICY_DRAFT_INPUT_LIMITS = Object.freeze({
  instructionCharacters: 4000,
  inputCharacters: 16384,
  modelCharacters: 160,
  tokenIdCharacters: 128,
})
