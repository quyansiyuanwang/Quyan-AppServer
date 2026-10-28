import { IAM_ACTION_DEFINITIONS } from './catalog'

/**
 * The production catalog contains only actions implemented by this platform.
 *
 * Cloud-provider examples such as `alidns:*` belong in documentation and test
 * fixtures, not in the authorization catalog. Registering an example here
 * would make it look executable and would allow it through route and
 * simulation validation without a corresponding Quyan API.
 */
export const IAM_ACTION_CATALOG: readonly string[] = Object.freeze([
  ...IAM_ACTION_DEFINITIONS.map((definition) => definition.action),
])
const actionSet = new Set(IAM_ACTION_CATALOG)
export function isKnownIamAction(action: string): boolean {
  return actionSet.has(action)
}
/** Case-sensitive identifiers. No client-defined action or pattern in requests. */
export function isValidIamAction(action: string): boolean {
  return action.length <= 512 && /^[A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z0-9_.-]+)+$/.test(action)
}
