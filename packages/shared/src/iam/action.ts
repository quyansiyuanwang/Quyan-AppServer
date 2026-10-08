import { ALL_PERMISSIONS } from '../permission'
import { actionForPermission } from './legacy-permission-map'
export const ALIDNS_ACTIONS = Object.freeze([
  'alidns:AddDomainRecord',
  'alidns:UpdateDomainRecord',
  'alidns:DeleteDomainRecord',
  'alidns:SetDomainRecordStatus',
  'alidns:DescribeDomainRecords',
  'alidns:DescribeDomainRecordInfo',
  'alidns:DescribeSubDomainRecords',
  'alidns:DescribeDomains',
  'alidns:DescribeDomainInfo',
])
export const IAM_ACTION_CATALOG: readonly string[] = Object.freeze([
  ...ALL_PERMISSIONS.map(actionForPermission),
  ...ALIDNS_ACTIONS,
  'quyan:iam:SimulatePolicy',
])
const actionSet = new Set(IAM_ACTION_CATALOG)
export function isKnownIamAction(action: string): boolean {
  return actionSet.has(action)
}
/** Case-sensitive identifiers. No client-defined action or pattern in requests. */
export function isValidIamAction(action: string): boolean {
  return action.length <= 512 && /^[A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z0-9_.-]+)+$/.test(action)
}
