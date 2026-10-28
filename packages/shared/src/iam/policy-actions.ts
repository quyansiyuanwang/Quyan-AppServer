import { IAM_ACTION_DEFINITIONS } from './catalog'
import { getIamResourcePatternTypes } from './resource'
import { matchIamPattern } from './pattern'
import type { IamStatement } from './policy'
/** Resolve only the current, registered, resource-compatible universe. Persist the resulting exact Actions. */
export function resolveIamStatementActions(statement: IamStatement): string[] {
  if ('Action' in statement) {
    if ('NotAction' in statement) throw Error('Action and NotAction are mutually exclusive')
    return [statement.Action].flat()
  }
  if (!('NotAction' in statement)) throw Error('Action or NotAction is required')
  const excluded = [statement.NotAction].flat()
  const types = new Set(
    [statement.Resource]
      .flat()
      .flatMap((pattern) => getIamResourcePatternTypes(pattern).map((type) => type.id)),
  )
  return IAM_ACTION_DEFINITIONS.filter(
    (definition) =>
      definition.resourceTypes.some((type) => types.has(type)) &&
      !excluded.some((pattern) => matchIamPattern(pattern, definition.action)),
  )
    .map((definition) => definition.action)
    .sort()
}
