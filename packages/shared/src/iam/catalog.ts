import { IAM_SUPPORTED_CONDITION_KEYS } from './condition'
import { ALL_PERMISSIONS, Permission } from '../permission'
import { actionForPermission } from './legacy-permission-map'

export interface IamActionDefinition {
  action: string
  service: string
  operation: string
  accessLevel: 'Read' | 'Write' | 'List'
  resourceTypes: string[]
  apiRoutes: string[]
  conditionKeys: string[]
  sensitive: boolean
  authorizationStage: 'legacy' | 'declared'
}
export interface IamServiceDefinition {
  code: string
  name: string
  actions: IamActionDefinition[]
}
export interface IamResourceTypeDefinition {
  id: string
  service: string
  type: string
  arnTemplate: string
  identifierSegments: number
}
const resource = (
  service: string,
  type: string,
  identifierSegments = 1,
): IamResourceTypeDefinition => ({
  id: service + '/' + type,
  service,
  type,
  identifierSegments,
  arnTemplate:
    type === 'account'
      ? 'acs:quyan:*:{accountId}:account'
      : 'acs:' +
        service +
        ':*:{accountId}:' +
        type +
        '/' +
        (identifierSegments === 2 ? '{parentId}/{resourceId}' : '{resourceId}'),
})
export const IAM_RESOURCE_TYPE_CATALOG: readonly IamResourceTypeDefinition[] = Object.freeze([
  resource('quyan', 'account', 0),
  resource('quyan', 'user'),
  resource('quyan', 'group'),
  resource('quyan', 'role'),
  resource('quyan', 'policy'),
  resource('quyan', 'policy-version', 2),
  resource('quyan', 'authorization'),
  resource('quyan', 'resource-group'),
  resource('quyan', 'role-session'),
  resource('relay', 'channel'),
  resource('developer', 'project'),
  resource('article', 'article'),
])
// Resource contracts are explicit for the migrated RAM domain. Compatibility
// actions remain marked legacy until each business domain declares its targets.
const ramResources: Partial<Record<Permission, string[]>> = {
  [Permission.RAM_USER_CREATE]: ['user', 'group'],
  [Permission.RAM_USER_READ]: ['user'],
  [Permission.RAM_USER_UPDATE]: ['user', 'group'],
  [Permission.RAM_USER_DELETE]: ['user'],
  [Permission.RAM_ROLE_CREATE]: ['role'],
  [Permission.RAM_ROLE_READ]: ['role'],
  [Permission.RAM_ROLE_UPDATE]: ['role'],
  [Permission.RAM_ROLE_DELETE]: ['role'],
  [Permission.RAM_ASSUME_ROLE]: ['role'],
  [Permission.RAM_BINDING_CREATE]: ['user', 'group', 'role', 'authorization'],
  [Permission.RAM_BINDING_READ]: ['user', 'group', 'role', 'authorization'],
  [Permission.RAM_BINDING_DELETE]: ['user', 'group', 'role', 'authorization'],
  [Permission.RAM_SESSION_READ]: ['role-session'],
  [Permission.RAM_SESSION_REVOKE]: ['role-session'],
  [Permission.RAM_POLICY_CREATE]: ['policy'],
  [Permission.RAM_POLICY_READ]: ['policy', 'policy-version'],
  [Permission.RAM_POLICY_UPDATE]: ['policy', 'policy-version'],
  [Permission.RAM_POLICY_DELETE]: ['policy'],
  [Permission.RAM_POLICY_ATTACH]: ['policy', 'user', 'group', 'role', 'authorization'],
  [Permission.RAM_POLICY_DETACH]: ['policy', 'user', 'group', 'role', 'authorization'],
}
const businessResources: Partial<Record<Permission, string[]>> = {
  [Permission.RELAY_CHANNEL_CREATE]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_READ]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_UPDATE]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_DELETE]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_EXPORT]: ['relay/channel'],
  [Permission.ARTICLE_READ]: ['article/article'],
  [Permission.ARTICLE_UPDATE]: ['article/article'],
  [Permission.ARTICLE_DELETE]: ['article/article'],
}
const fromPermission = (permission: Permission): IamActionDefinition => {
  const action = actionForPermission(permission)
  const parts = action.split(':')
  const service = parts[1]
  if (!service) throw new Error('Invalid registered IAM Action')
  const operation = parts.slice(2).join(':')
  const resources =
    ramResources[permission]?.map((type) => 'quyan/' + type) ?? businessResources[permission]
  return {
    action,
    service,
    operation,
    accessLevel: /^(List|Search)/.test(parts[parts.length - 1] ?? '')
      ? 'List'
      : /^(Read|Get|Describe|View)$/.test(parts[parts.length - 1] ?? '') || /^Read/.test(operation)
        ? 'Read'
        : 'Write',
    resourceTypes: ['quyan/account', ...(resources ?? [])],
    apiRoutes: [],
    conditionKeys: [...IAM_SUPPORTED_CONDITION_KEYS],
    sensitive: /ram:|permission:|impersonate|secret|password|key/i.test(permission),
    authorizationStage: resources ? 'declared' : 'legacy',
  }
}
export const IAM_ACTION_DEFINITIONS: readonly IamActionDefinition[] = Object.freeze([
  ...ALL_PERMISSIONS.map(fromPermission),
  ...[
    {
      operation: 'ListAuthorizations',
      accessLevel: 'List',
      resourceTypes: ['quyan/account', 'quyan/authorization'],
    },
    {
      operation: 'CreateAuthorization',
      accessLevel: 'Write',
      resourceTypes: [
        'quyan/account',
        'quyan/policy',
        'quyan/user',
        'quyan/group',
        'quyan/role',
        'quyan/resource-group',
      ],
    },
    {
      operation: 'DeleteAuthorization',
      accessLevel: 'Write',
      resourceTypes: ['quyan/authorization'],
    },
    {
      operation: 'ListResourceGroups',
      accessLevel: 'List',
      resourceTypes: ['quyan/account', 'quyan/resource-group'],
    },
    { operation: 'CreateResourceGroup', accessLevel: 'Write', resourceTypes: ['quyan/account'] },
    {
      operation: 'UpdateRoleTrustPolicy',
      accessLevel: 'Write',
      resourceTypes: ['quyan/account', 'quyan/role'],
    },
    {
      operation: 'AddResourceGroupMember',
      accessLevel: 'Write',
      resourceTypes: ['quyan/resource-group'],
    },
    {
      operation: 'RemoveResourceGroupMember',
      accessLevel: 'Write',
      resourceTypes: ['quyan/resource-group'],
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:ram:' + definition.operation,
      service: 'ram',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      apiRoutes: [],
      conditionKeys: [...IAM_SUPPORTED_CONDITION_KEYS],
      sensitive: true,
      authorizationStage: 'declared',
    }),
  ),
  {
    action: 'quyan:iam:SimulatePolicy',
    service: 'iam',
    operation: 'SimulatePolicy',
    accessLevel: 'Read',
    resourceTypes: ['quyan/account'],
    apiRoutes: [],
    conditionKeys: [...IAM_SUPPORTED_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
  },
])
const actionDefinitions = new Map(
  IAM_ACTION_DEFINITIONS.map((definition) => [definition.action, definition]),
)
export function getIamActionDefinition(action: string): IamActionDefinition | undefined {
  return actionDefinitions.get(action)
}
export function iamServiceDefinitions(
  definitions: readonly IamActionDefinition[] = IAM_ACTION_DEFINITIONS,
): IamServiceDefinition[] {
  const services = new Map<string, IamServiceDefinition>()
  for (const definition of definitions) {
    const service = services.get(definition.service) ?? {
      code: definition.service,
      name: definition.service,
      actions: [],
    }
    service.actions.push(definition)
    services.set(service.code, service)
  }
  return [...services.values()].sort((a, b) => a.code.localeCompare(b.code))
}
