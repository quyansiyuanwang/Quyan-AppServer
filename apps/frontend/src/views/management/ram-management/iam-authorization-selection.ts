import {
  IAM_ACTION_DEFINITIONS,
  ALL_PERMISSIONS,
  actionForPermission,
  matchIamPattern,
} from '@quyan/shared'
import type { CreateRamAuthorizationDto, RamPolicyDto } from '@/client/types.gen'
export const IAM_AUTHORIZATION_SELECTION_LIMITS = Object.freeze({ requests: 50 })
export interface IamAuthorizationOption {
  id: string
  label: string
  description?: string
  highRisk?: boolean
}
export type IamAuthorizationOptionQuery = { page: number; pageSize: number; keyword?: string }
export type IamAuthorizationScope = Pick<
  CreateRamAuthorizationDto,
  'principalType' | 'scopeType' | 'scopeArn' | 'scopeResourceId'
>
export function buildIamAuthorizationRequests(
  scope: IamAuthorizationScope,
  principalIds: readonly string[],
  policyIds: readonly string[],
): CreateRamAuthorizationDto[] {
  const principals = [...new Set(principalIds)],
    policies = [...new Set(policyIds)]
  if (
    !principals.length ||
    !policies.length ||
    [...principals, ...policies].some((id) => !id.trim()) ||
    principals.length * policies.length > IAM_AUTHORIZATION_SELECTION_LIMITS.requests ||
    (scope.scopeType === 'resource-group' && !scope.scopeResourceId?.trim()) ||
    (scope.scopeType === 'resource' && !scope.scopeArn?.trim())
  )
    throw Error('Incomplete authorization selection')
  const boundary: IamAuthorizationScope = {
    principalType: scope.principalType,
    scopeType: scope.scopeType,
    ...(scope.scopeType === 'resource-group'
      ? { scopeResourceId: scope.scopeResourceId?.trim() }
      : {}),
    ...(scope.scopeType === 'resource' ? { scopeArn: scope.scopeArn?.trim() } : {}),
  }
  return principals.flatMap((principalId) =>
    policies.map((policyId) => ({ ...boundary, principalId, policyId })),
  )
}
/** Display-only warning; all publication and delegation decisions remain on the server. */
export function iamAuthorizationPolicyHighRisk(
  policy: Pick<RamPolicyDto, 'document' | 'permissions'>,
): boolean {
  const sensitive = IAM_ACTION_DEFINITIONS.filter(
    (action) =>
      ['ram', 'iam', 'group', 'permission'].includes(action.service) &&
      action.accessLevel === 'Write',
  )
  const actionsAreSensitive = (patterns: readonly string[]) =>
    patterns.some(
      (pattern) =>
        pattern.includes('*') ||
        sensitive.some((action) => matchIamPattern(pattern, action.action)),
    )
  if (!policy.document) {
    const permissions = new Set<string>(policy.permissions)
    return actionsAreSensitive(
      ALL_PERMISSIONS.filter((permission) => permissions.has(permission)).map(actionForPermission),
    )
  }
  const statements = Array.isArray(policy.document.Statement)
    ? policy.document.Statement
    : [policy.document.Statement]
  return statements.some(
    (statement) =>
      statement.Effect === 'Allow' &&
      ('NotAction' in statement ||
        actionsAreSensitive(
          Array.isArray(statement.Action) ? statement.Action : [statement.Action],
        )),
  )
}
