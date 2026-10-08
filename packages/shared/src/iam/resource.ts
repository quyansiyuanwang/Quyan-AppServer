import { IAM_RESOURCE_TYPE_CATALOG, getIamActionDefinition } from './catalog'
import type { IamResourceTypeDefinition } from './catalog'
import { matchIamPattern } from './pattern'
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
/** Registered concrete targets only; '*' is reserved for operations without a single target. */
export function getIamResourceType(resource: string): IamResourceTypeDefinition | undefined {
  if (
    resource.length > 512 ||
    resource.includes('..') ||
    !/^acs:[a-z][a-z0-9-]*:(?:\*|[A-Za-z0-9_-]*):[A-Za-z0-9_-]+:[A-Za-z0-9_.+/@-]+$/.test(resource)
  )
    return undefined
  const [, service, , , path] = resource.split(':')
  const [type, ...ids] = path!.split('/')
  return IAM_RESOURCE_TYPE_CATALOG.find(
    (definition) =>
      definition.service === service &&
      definition.type === type &&
      ids.length === definition.identifierSegments &&
      ids.every((id) => id.length > 0),
  )
}
export function isValidIamResource(resource: string): boolean {
  return resource === '*' || getIamResourceType(resource) !== undefined
}
/** Resource pattern registration does not prove actual ownership or membership. */
export function getIamResourcePatternTypes(pattern: string): readonly IamResourceTypeDefinition[] {
  if (pattern === '*') return IAM_RESOURCE_TYPE_CATALOG
  if (
    pattern.length > 512 ||
    pattern.includes('..') ||
    !/^acs:[a-z0-9*-]+:[A-Za-z0-9_*-]*:[A-Za-z0-9_*-]+:[A-Za-z0-9_.+/@*-]+$/.test(pattern)
  )
    return []
  const [, service, , , path] = pattern.split(':')
  const [type, ...ids] = path!.split('/')
  if (ids.some((id) => !id)) return []
  return IAM_RESOURCE_TYPE_CATALOG.filter(
    (definition) =>
      matchIamPattern(service!, definition.service) &&
      matchIamPattern(type!, definition.type) &&
      ids.length <= definition.identifierSegments &&
      (ids.length === definition.identifierSegments || (ids[ids.length - 1] ?? type!).includes('*')),
  )
}
export function isIamResourceInAccount(resource: string, accountOwnerId: string): boolean {
  return (
    resource === '*' ||
    (getIamResourceType(resource) !== undefined && resource.split(':')[3] === accountOwnerId)
  )
}
export function isIamActionResourceCompatible(action: string, resource: string): boolean {
  const definition = getIamActionDefinition(action)
  if (!definition) return false
  if (resource === '*') return true
  const type = getIamResourceType(resource)
  return Boolean(type && definition.resourceTypes.includes(type.id))
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
  const resource =
    'acs:' + input.service + ':' + input.region + ':' + input.accountId + ':' + input.path
  if (!getIamResourceType(resource)) throw new Error('Unregistered ACS resource type')
  return resource
}
