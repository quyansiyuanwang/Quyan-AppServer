export interface IamPrincipal {
  subjectUserId: string
  principalUserId: string
  accountOwnerId: string
  subjectType: 'root' | 'sub_user' | 'access_key' | 'assumed_role' | 'service'
  assumedRoleId?: string
  roleSessionId?: string
}
export const IAM_RESOURCE_KINDS = Object.freeze([
  'account',
  'collection',
  'single-resource',
  'batch',
] as const)
export type IamResourceKind = (typeof IAM_RESOURCE_KINDS)[number]
export interface AcsResourceInput {
  service: string
  region: string
  accountId: string
  path: string
}
export function isValidIamResource(resource: string): boolean {
  return (
    resource === '*' ||
    (resource.length <= 512 &&
      /^acs:[a-z][a-z0-9-]*:(?:\*|[A-Za-z0-9_-]*):[A-Za-z0-9_-]+:[A-Za-z0-9_.+/@-]+$/.test(
        resource,
      ) &&
      !resource.includes('..'))
  )
}
/** Never pass client-controlled account/region values to this constructor. */
export function buildAcsResource(input: AcsResourceInput): string {
  if (
    !/^[a-z][a-z0-9-]*$/.test(input.service) ||
    !/^(?:\*|[A-Za-z0-9_-]+)$/.test(input.region) ||
    !/^[A-Za-z0-9_-]+$/.test(input.accountId) ||
    !/^[A-Za-z0-9_.+/@-]+$/.test(input.path) ||
    input.path.includes('..')
  ) {
    throw new Error('Invalid ACS resource components')
  }
  return `acs:${input.service}:${input.region}:${input.accountId}:${input.path}`
}
