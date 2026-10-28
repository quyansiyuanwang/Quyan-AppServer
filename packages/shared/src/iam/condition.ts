export const IAM_CONDITION_OPERATORS = Object.freeze([
  'StringEquals',
  'StringNotEquals',
  'StringEqualsIgnoreCase',
  'StringNotEqualsIgnoreCase',
  'StringLike',
  'StringNotLike',
  'NumericEquals',
  'NumericNotEquals',
  'NumericLessThan',
  'NumericLessThanEquals',
  'NumericGreaterThan',
  'NumericGreaterThanEquals',
  'DateEquals',
  'DateNotEquals',
  'DateLessThan',
  'DateLessThanEquals',
  'DateGreaterThan',
  'DateGreaterThanEquals',
  'Bool',
  'IpAddress',
  'NotIpAddress',
  'IpAddressIncludeBorder',
  'NotIpAddressIncludeBorder',
  'Null',
] as const)
export type IamConditionOperator = (typeof IAM_CONDITION_OPERATORS)[number]
/** Negative operators exclude every listed value (NOR), rather than offering OR alternatives. */
export function isNegativeIamConditionOperator(operator: string): boolean {
  return (
    operator.startsWith('StringNot') ||
    operator.endsWith('NotEquals') ||
    operator.startsWith('NotIpAddress')
  )
}
export type IamConditionScalar = string | number | boolean
export interface IamCondition {
  [operator: string]: { [key: string]: IamConditionScalar | IamConditionScalar[] }
}
/** Values come from authenticated/server-derived context, never an arbitrary body map. */
export interface IamConditionContext {
  [key: string]: IamConditionScalar | IamConditionScalar[] | undefined
}
export interface IamConditionKeyDefinition {
  key: string
  valueType: 'string' | 'number' | 'date' | 'boolean' | 'ip'
  operators: IamConditionOperator[]
  source: 'request' | 'principal' | 'resource'
  supported: boolean
  /** Only directory-declared keys accept a server-derived collection of context values. */
  multivalued?: boolean
}
const key = (
  key: string,
  valueType: IamConditionKeyDefinition['valueType'],
  source: IamConditionKeyDefinition['source'],
  supported = true,
): IamConditionKeyDefinition => ({
  key,
  valueType,
  source,
  supported,
  operators: IAM_CONDITION_OPERATORS.filter(
    (operator) =>
      operator === 'Null' ||
      (valueType === 'string'
        ? operator.startsWith('String')
        : valueType === 'number'
          ? operator.startsWith('Numeric')
          : valueType === 'date'
            ? operator.startsWith('Date')
            : valueType === 'boolean'
              ? operator === 'Bool'
              : operator.includes('IpAddress')),
  ),
})
export const IAM_CONDITION_KEY_CATALOG: readonly IamConditionKeyDefinition[] = Object.freeze([
  key('acs:SourceIp', 'ip', 'request'),
  key('acs:CurrentTime', 'date', 'request'),
  key('acs:UserAgent', 'string', 'request'),
  key('acs:SecureTransport', 'boolean', 'request'),
  key('quyan:PrincipalId', 'string', 'principal'),
  key('quyan:PrincipalType', 'string', 'principal'),
  key('quyan:PrincipalAccount', 'string', 'principal'),
  key('quyan:EpochTime', 'number', 'request'),
  key('quyan:ResourceOwnerId', 'string', 'resource'),
  key('quyan:ArticlePublishStatus', 'string', 'resource'),
  {
    ...key('quyan:ResourceGroupId', 'string', 'resource'),
    multivalued: true,
    operators: ['StringEquals', 'StringEqualsIgnoreCase', 'StringLike', 'Null'],
  },
  key('quyan:ResourceTag/<key>', 'string', 'resource', false),
  key('acs:MFAPresent', 'boolean', 'principal', false),
])
export function getIamConditionKey(key: string): IamConditionKeyDefinition | undefined {
  return IAM_CONDITION_KEY_CATALOG.find((definition) => definition.key === key)
}
export const IAM_SUPPORTED_CONDITION_KEYS: readonly string[] = Object.freeze(
  IAM_CONDITION_KEY_CATALOG.filter((key) => key.supported).map((key) => key.key),
)

/** Request/principal keys are global; resource keys require an Action-specific provider. */
export const IAM_GLOBAL_CONDITION_KEYS: readonly string[] = Object.freeze(
  IAM_CONDITION_KEY_CATALOG.filter((key) => key.supported && key.source !== 'resource').map(
    (key) => key.key,
  ),
)
