import {
  IAM_ACTION_DEFINITIONS,
  IAM_CONDITION_KEY_CATALOG,
  IAM_RESOURCE_TYPE_CATALOG,
  getIamConditionKey,
  getIamResourcePatternTypes,
  matchIamPattern,
} from '@quyan/shared'
import type {
  IamCondition,
  IamConditionOperator,
  IamConditionScalar,
  IamPolicyDocument,
  IamStatement,
} from '@quyan/shared'
export interface VisualCondition {
  operator: IamConditionOperator
  key: string
  valuesText: string
}
export interface VisualStatement {
  sid: string
  effect: 'Allow' | 'Deny'
  actions: string[]
  resourcesText: string
  conditions: VisualCondition[]
  serviceFilter: string
  accessFilter: 'all' | 'Read' | 'Write' | 'List'
}
export const newVisualStatement = (): VisualStatement => ({
  sid: '',
  effect: 'Allow',
  actions: [],
  resourcesText: '',
  conditions: [],
  serviceFilter: '',
  accessFilter: 'all',
})
const array = <T>(input: T | T[]): T[] => (Array.isArray(input) ? input : [input])
const matchedActions = (actions: string[]) =>
  IAM_ACTION_DEFINITIONS.filter((definition) =>
    actions.some((pattern) => matchIamPattern(pattern, definition.action)),
  )
export function visualResourceTypes(actions: string[]) {
  const types = new Set(matchedActions(actions).flatMap((action) => action.resourceTypes))
  return IAM_RESOURCE_TYPE_CATALOG.filter((type) => types.has(type.id))
}
export function visualConditionKeys(actions: string[]) {
  const definitions = matchedActions(actions)
  return IAM_CONDITION_KEY_CATALOG.filter(
    (key) =>
      key.supported &&
      definitions.length > 0 &&
      definitions.every((action) => action.conditionKeys.includes(key.key)),
  )
}
/** Called only after server diagnosis; reject fields that this editor cannot round-trip. */
export function importVisualPolicy(document: IamPolicyDocument): VisualStatement[] {
  if (
    document.Version !== '1' ||
    Object.keys(document).some((key) => !['Version', 'Statement'].includes(key))
  )
    throw Error('Unsupported policy')
  return array(document.Statement).map((statement) => {
    if (
      Object.keys(statement).some(
        (key) => !['Sid', 'Effect', 'Action', 'Resource', 'Condition'].includes(key),
      )
    )
      throw Error('Unsupported statement')
    if (!('Action' in statement) || 'NotAction' in statement)
      throw Error('Diagnose NotAction before visual import')
    const actions = array(statement.Action)
    const services = new Set(matchedActions(actions).map((action) => action.service))
    const conditions = Object.entries(statement.Condition ?? {}).flatMap(([operator, clause]) =>
      Object.entries(clause).map(([key, value]) => ({
        operator: operator as IamConditionOperator,
        key,
        valuesText: JSON.stringify(value),
      })),
    )
    return {
      ...newVisualStatement(),
      sid: statement.Sid ?? '',
      effect: statement.Effect,
      actions: [...actions],
      resourcesText: array(statement.Resource).join('\n'),
      conditions,
      serviceFilter: services.size === 1 ? [...services][0]! : '',
    }
  })
}
function parseValues(text: string): IamConditionScalar | IamConditionScalar[] {
  const value: unknown = JSON.parse(text)
  const values = array(value)
  if (
    !values.length ||
    !values.every(
      (item) =>
        typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item)),
    )
  )
    throw Error('Invalid condition values')
  return value as IamConditionScalar | IamConditionScalar[]
}
export function exportVisualPolicy(statements: VisualStatement[]): IamPolicyDocument {
  if (!statements.length) throw Error('Empty statements')
  const result: IamStatement[] = statements.map((statement) => {
    const actions = statement.actions.map((action) => action.trim())
    const resources = statement.resourcesText
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
    if (
      !actions.length ||
      !resources.length ||
      !actions.every((pattern) => matchedActions([pattern]).length > 0)
    )
      throw Error('Incomplete statement')
    const condition: IamCondition = {}
    const supported = new Set(visualConditionKeys(actions).map((key) => key.key))
    for (const row of statement.conditions) {
      const key = getIamConditionKey(row.key)
      if (!supported.has(row.key) || !key?.operators.includes(row.operator))
        throw Error('Unsupported condition')
      const block = (condition[row.operator] ??= {})
      if (Object.prototype.hasOwnProperty.call(block, row.key))
        throw Error('Duplicate condition key')
      block[row.key] = parseValues(row.valuesText)
    }
    return {
      ...(statement.sid ? { Sid: statement.sid } : {}),
      Effect: statement.effect,
      Action: [...new Set(actions)],
      Resource: [...new Set(resources)],
      ...(statement.conditions.length ? { Condition: condition } : {}),
    }
  })
  return { Version: '1', Statement: result }
}
/** Identifier fields come from the registered ARN path, including user/pass/subject and ancestor segments. */
export function visualResourceIdentifierFields(typeId: string): string[] {
  const type = IAM_RESOURCE_TYPE_CATALOG.find((type) => type.id === typeId)
  if (!type) return []
  const path = type.arnTemplate.split(':')[4] ?? ''
  return [...new Set([...path.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]!))]
}
export function visualResourceAccountId(
  typeId: string,
  accountOwnerId: string,
): string | undefined {
  const type = IAM_RESOURCE_TYPE_CATALOG.find((type) => type.id === typeId)
  if (!type || !/^[A-Za-z0-9_-]{1,128}$/.test(accountOwnerId)) return undefined
  return type.arnTemplate.split(':')[3]?.replace('{accountId}', accountOwnerId)
}
export function visualResourceTemplate(
  typeId: string,
  accountOwnerId: string,
  identifiers: Readonly<Record<string, string>>,
): string | undefined {
  const type = IAM_RESOURCE_TYPE_CATALOG.find((type) => type.id === typeId)
  if (!type || !visualResourceAccountId(typeId, accountOwnerId)) return undefined
  const fields = visualResourceIdentifierFields(typeId)
  if (
    Object.keys(identifiers).some((key) => !fields.includes(key)) ||
    fields.some(
      (field) =>
        !Object.prototype.hasOwnProperty.call(identifiers, field) ||
        typeof identifiers[field] !== 'string' ||
        !/^[A-Za-z0-9_.*@+-]{1,128}$/.test(identifiers[field]!) ||
        identifiers[field]!.includes('..'),
    )
  )
    return undefined
  const resource = type.arnTemplate
    .replace('{accountId}', accountOwnerId)
    .replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_placeholder, key: string) => identifiers[key] ?? '')
  return getIamResourcePatternTypes(resource).some((definition) => definition.id === typeId)
    ? resource
    : undefined
}
