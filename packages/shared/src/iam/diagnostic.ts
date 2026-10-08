import type { NormalizedIamPolicyDocument } from './policy'
import type { NormalizedIamTrustPolicyDocument } from './trust-policy'
export const IAM_DIAGNOSTIC_CODES = Object.freeze([
  'json-syntax',
  'document-limit',
  'duplicate-key',
  'unsafe-key',
  'unknown-field',
  'invalid-version',
  'invalid-field',
  'unknown-action',
  'invalid-action-selector',
  'invalid-resource',
  'invalid-condition',
  'invalid-principal',
  'cross-account-principal',
  'broad-action',
  'not-action-snapshot',
  'broad-resource',
  'iam-management',
  'duplicate-statement',
  'cross-account-resource',
  'resource-type-mismatch',
  'unreachable-deny',
] as const)
export type IamDiagnosticCode = (typeof IAM_DIAGNOSTIC_CODES)[number]
export interface IamDiagnostic {
  severity: 'error' | 'security-warning' | 'warning' | 'suggestion'
  code: IamDiagnosticCode
  /** RFC 6901 JSON pointer into the original document. */
  path: string
  line: number
  column: number
  messageKey: string
}
export interface IamPolicyDiagnosis {
  valid: boolean
  diagnostics: IamDiagnostic[]
  riskLevel: 'low' | 'medium' | 'high'
  document?: NormalizedIamPolicyDocument | NormalizedIamTrustPolicyDocument
  documentHash?: string
  /** Diagnosis never proves a caller's right to publish or delegate a policy. */
  delegation: 'not-evaluated'
}
