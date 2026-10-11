import { IAM_GLOBAL_CONDITION_KEYS } from './condition'
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
  /** Baseline grant restricted to registered authenticated self identity/child ARNs. */
  defaultAuthorizationScope?: 'self'
  /** Registered migration alias only; clients cannot choose the endpoint Action. */
  legacyPermission?: Permission
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
  /** Only explicitly registered user identities or their user-parented children receive self-service defaults. */
  authenticatedSelfScope?: 'identity' | 'children'
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
  { ...resource('quyan', 'user'), authenticatedSelfScope: 'identity' },
  resource('quyan', 'group'),
  resource('quyan', 'role'),
  resource('quyan', 'policy'),
  resource('quyan', 'policy-version', 2),
  resource('quyan', 'authorization'),
  resource('quyan', 'resource-group'),
  resource('quyan', 'role-session'),
  resource('quyan', 'access-key', 2),
  resource('relay', 'channel'),
  resource('developer', 'project'),
  resource('developer', 'kv-item', 2),
  resource('developer', 'secret', 2),
  resource('developer', 'short-link', 2),
  resource('developer', 'project-api-key', 2),
  resource('developer', 'status-monitor', 2),
  resource('developer', 'push-channel', 2),
  resource('developer', 'push-delivery', 2),
  resource('article', 'article'),
  { ...resource('notification', 'inbox-item', 2), authenticatedSelfScope: 'children' },
  resource('notification', 'delivery-log', 2),
  resource('notification', 'webhook', 2),
])
// Resource contracts are explicit for the migrated RAM domain. Compatibility
// actions remain marked legacy until each business domain declares its targets.
const ramResources: Partial<Record<Permission, string[]>> = {
  [Permission.GROUP_CREATE]: ['group'],
  [Permission.GROUP_READ]: ['group'],
  [Permission.GROUP_UPDATE]: ['group'],
  [Permission.GROUP_DELETE]: ['group'],
  [Permission.GROUP_PERMISSION_ADD]: ['group'],
  [Permission.GROUP_PERMISSION_REMOVE]: ['group'],
  [Permission.PERMISSION_VIEW]: ['user', 'group'],
  [Permission.PERMISSION_ADD]: ['user', 'group'],
  [Permission.PERMISSION_REMOVE]: ['user', 'group'],
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
  [Permission.RELAY_CHANNEL_HEALTH_READ]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_POOL_METADATA_READ]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_PROBE_READ]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_PROBE_EXECUTE]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_SUBMIT]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_REVIEW]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_PROVIDER_READ]: ['relay/channel'],
  [Permission.RELAY_CHANNEL_PROVIDER_SETTLE]: ['relay/channel'],
  [Permission.USER_CHANGE_SELF_PASSWORD]: ['quyan/user'],
  [Permission.USER_CHANGE_OTHERS_PASSWORD]: ['quyan/user'],
  // Creation authorizes the trusted parent account before an article identity exists.
  [Permission.ARTICLE_CREATE]: [],
  [Permission.ARTICLE_READ]: ['article/article'],
  [Permission.ARTICLE_UPDATE]: ['article/article'],
  [Permission.ARTICLE_DELETE]: ['article/article'],
  [Permission.ARTICLE_PUBLISH]: ['article/article'],
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
      : permission === Permission.PERMISSION_VIEW ||
          /^(Read|Get|Describe|View)$/.test(parts[parts.length - 1] ?? '') ||
          /^Read/.test(operation)
        ? 'Read'
        : 'Write',
    resourceTypes: ['quyan/account', ...(resources ?? [])],
    apiRoutes: [],
    conditionKeys: [
      ...IAM_GLOBAL_CONDITION_KEYS,
      ...(resources?.includes('article/article') ? ['quyan:ResourceOwnerId'] : []),
    ],
    sensitive:
      permission === Permission.ARTICLE_CREATE ||
      permission === Permission.ARTICLE_PUBLISH ||
      permission === Permission.ARTICLE_UPDATE ||
      permission === Permission.ARTICLE_DELETE ||
      /ram:|permission:|impersonate|secret|password|key/i.test(permission),
    authorizationStage: resources ? 'declared' : 'legacy',
    ...(permission === Permission.PERMISSION_VIEW
      ? { defaultAuthorizationScope: 'self' as const }
      : {}),
  }
}
export const IAM_ACTION_DEFINITIONS: readonly IamActionDefinition[] = Object.freeze([
  ...ALL_PERMISSIONS.map(fromPermission),
  ...[
    {
      operation: 'ListProjects',
      accessLevel: 'List',
      resourceTypes: ['quyan/user', 'developer/project'],
    },
    { operation: 'CreateProject', accessLevel: 'Write', resourceTypes: ['quyan/user'] },
    { operation: 'GetProject', accessLevel: 'Read', resourceTypes: ['developer/project'] },
    {
      operation: 'ListKv',
      accessLevel: 'List',
      resourceTypes: ['developer/project', 'developer/kv-item'],
    },
    { operation: 'GetKv', accessLevel: 'Read', resourceTypes: ['developer/kv-item'] },
    { operation: 'SetKv', accessLevel: 'Write', resourceTypes: ['developer/kv-item'] },
    { operation: 'DeleteKv', accessLevel: 'Write', resourceTypes: ['developer/kv-item'] },
    {
      operation: 'ListSecrets',
      accessLevel: 'List',
      resourceTypes: ['developer/project', 'developer/secret'],
    },
    { operation: 'PutSecret', accessLevel: 'Write', resourceTypes: ['developer/secret'] },
    { operation: 'DeleteSecret', accessLevel: 'Write', resourceTypes: ['developer/secret'] },
    {
      operation: 'ListShortLinks',
      accessLevel: 'List',
      resourceTypes: ['developer/project', 'developer/short-link'],
    },
    { operation: 'CreateShortLink', accessLevel: 'Write', resourceTypes: ['developer/project'] },
    { operation: 'UpdateShortLink', accessLevel: 'Write', resourceTypes: ['developer/short-link'] },
    { operation: 'DeleteShortLink', accessLevel: 'Write', resourceTypes: ['developer/short-link'] },
    {
      operation: 'GetShortLinkStats',
      accessLevel: 'Read',
      resourceTypes: ['developer/short-link'],
    },
    {
      operation: 'ListProjectApiKeys',
      accessLevel: 'List',
      resourceTypes: ['developer/project', 'developer/project-api-key'],
    },
    {
      operation: 'CreateProjectApiKey',
      accessLevel: 'Write',
      resourceTypes: ['developer/project'],
    },
    {
      operation: 'RevokeProjectApiKey',
      accessLevel: 'Write',
      resourceTypes: ['developer/project-api-key'],
    },
    {
      operation: 'ListStatusMonitors',
      accessLevel: 'List',
      resourceTypes: ['developer/project', 'developer/status-monitor'],
    },
    {
      operation: 'CreateStatusMonitor',
      accessLevel: 'Write',
      resourceTypes: ['developer/project'],
    },
    {
      operation: 'UpdateStatusMonitor',
      accessLevel: 'Write',
      resourceTypes: ['developer/status-monitor'],
    },
    {
      operation: 'DeleteStatusMonitor',
      accessLevel: 'Write',
      resourceTypes: ['developer/status-monitor'],
    },
    {
      operation: 'CheckStatusMonitor',
      accessLevel: 'Write',
      resourceTypes: ['developer/status-monitor'],
    },
    {
      operation: 'ListPushChannels',
      accessLevel: 'List',
      resourceTypes: ['developer/project', 'developer/push-channel'],
    },
    { operation: 'CreatePushChannel', accessLevel: 'Write', resourceTypes: ['developer/project'] },
    {
      operation: 'UpdatePushChannel',
      accessLevel: 'Write',
      resourceTypes: ['developer/push-channel'],
    },
    {
      operation: 'DeletePushChannel',
      accessLevel: 'Write',
      resourceTypes: ['developer/push-channel'],
    },
    {
      operation: 'ListPushDeliveries',
      accessLevel: 'List',
      resourceTypes: ['developer/project', 'developer/push-delivery'],
    },
    {
      operation: 'GetPushDelivery',
      accessLevel: 'Read',
      resourceTypes: ['developer/push-delivery'],
    },
    { operation: 'UseSecret', accessLevel: 'Write', resourceTypes: ['developer/secret'] },
    { operation: 'GetProjectUsage', accessLevel: 'Read', resourceTypes: ['developer/project'] },
    { operation: 'UpdateStatusPage', accessLevel: 'Write', resourceTypes: ['developer/project'] },
    { operation: 'GetJsonEndpoint', accessLevel: 'Read', resourceTypes: ['developer/project'] },
    { operation: 'UpdateJsonEndpoint', accessLevel: 'Write', resourceTypes: ['developer/project'] },
    { operation: 'GetProductCatalog', accessLevel: 'Read', resourceTypes: ['quyan/account'] },
    { operation: 'ListProductInstances', accessLevel: 'List', resourceTypes: ['quyan/account'] },
    { operation: 'GetProductUsage', accessLevel: 'Read', resourceTypes: ['quyan/account'] },
    { operation: 'ListProductCallLogs', accessLevel: 'List', resourceTypes: ['quyan/account'] },
    { operation: 'CreateProductInstance', accessLevel: 'Write', resourceTypes: ['quyan/account'] },
    {
      operation: 'UpdateProductInstance',
      accessLevel: 'Write',
      resourceTypes: ['developer/project'],
    },
    {
      operation: 'DeleteProductInstance',
      accessLevel: 'Write',
      resourceTypes: ['developer/project'],
    },
    { operation: 'ListProductSubjects', accessLevel: 'List', resourceTypes: ['quyan/account'] },
    {
      operation: 'ListProductInstanceKeys',
      accessLevel: 'List',
      resourceTypes: ['developer/project'],
    },
    {
      operation: 'CreateProductInstanceKey',
      accessLevel: 'Write',
      resourceTypes: ['developer/project'],
    },
    {
      operation: 'RevokeProductInstanceKey',
      accessLevel: 'Write',
      resourceTypes: ['developer/project'],
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:developer:' + definition.operation,
      service: 'developer',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive:
        definition.accessLevel === 'Write' ||
        definition.operation === 'GetShortLinkStats' ||
        definition.operation === 'ListProjectApiKeys' ||
        definition.operation === 'ListPushChannels' ||
        definition.operation === 'ListPushDeliveries' ||
        definition.operation === 'GetPushDelivery',
      authorizationStage: 'declared',
    }),
  ),
  ...[
    { operation: 'GetHeartbeatConfig', accessLevel: 'Read' },
    { operation: 'SendHeartbeat', accessLevel: 'Write' },
    { operation: 'StopHeartbeat', accessLevel: 'Write' },
  ].map(
    (definition): IamActionDefinition => ({
      action: 'quyan:user:' + definition.operation,
      service: 'user',
      operation: definition.operation,
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      resourceTypes: ['quyan/user'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: false,
      authorizationStage: 'declared',
      defaultAuthorizationScope: 'self',
    }),
  ),
  ...[
    { operation: 'ClearTrustedWindow', accessLevel: 'Write' },
    { operation: 'ListTrustedDevices', accessLevel: 'List' },
    { operation: 'DeleteTrustedDevice', accessLevel: 'Write' },
    { operation: 'GetTwoFactorStatus', accessLevel: 'Read' },
    { operation: 'BeginTwoFactorSetup', accessLevel: 'Write' },
    { operation: 'ConfirmTwoFactorSetup', accessLevel: 'Write' },
    { operation: 'DisableTwoFactor', accessLevel: 'Write' },
    { operation: 'RegenerateTwoFactorRecoveryCodes', accessLevel: 'Write' },
    { operation: 'UpdateTwoFactorPasskeyPolicy', accessLevel: 'Write' },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:user:' + definition.operation,
      service: 'user',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      resourceTypes: ['quyan/user'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: true,
      authorizationStage: 'declared',
    }),
  ),
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
    { operation: 'GeneratePolicyDraft', accessLevel: 'Write', resourceTypes: ['quyan/account'] },
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
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: true,
      authorizationStage: 'declared',
    }),
  ),
  ...[
    { operation: 'GetPreferences', accessLevel: 'Read' },
    { operation: 'UpdatePreferences', accessLevel: 'Write' },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:notification:' + definition.operation,
      service: 'notification',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      resourceTypes: ['quyan/user'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: true,
      authorizationStage: 'declared',
      legacyPermission: Permission.NOTIFICATION_MANAGE,
    }),
  ),
  ...[
    { operation: 'ListInbox', accessLevel: 'List' },
    { operation: 'MarkInboxRead', accessLevel: 'Write' },
    { operation: 'ConfirmPixelOpenedInboxRead', accessLevel: 'Write' },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:notification:' + definition.operation,
      service: 'notification',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      resourceTypes: ['notification/inbox-item'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: false,
      authorizationStage: 'declared',
      defaultAuthorizationScope: 'self',
    }),
  ),
  ...[
    { operation: 'ListWebhooks', accessLevel: 'List', resourceTypes: ['notification/webhook'] },
    { operation: 'CreateWebhook', accessLevel: 'Write', resourceTypes: ['quyan/user'] },
    { operation: 'UpdateWebhook', accessLevel: 'Write', resourceTypes: ['notification/webhook'] },
    { operation: 'DeleteWebhook', accessLevel: 'Write', resourceTypes: ['notification/webhook'] },
    { operation: 'TestWebhook', accessLevel: 'Write', resourceTypes: ['notification/webhook'] },
    { operation: 'TestEmail', accessLevel: 'Write', resourceTypes: ['quyan/user'] },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:notification:' + definition.operation,
      service: 'notification',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: true,
      authorizationStage: 'declared',
      legacyPermission: Permission.NOTIFICATION_MANAGE,
    }),
  ),
  ...[
    { service: 'ojqa', operation: 'GetUsage', accessLevel: 'Read' },
    { service: 'system', operation: 'GetClientIp', accessLevel: 'Read' },
    { service: 'reurl', operation: 'Generate', accessLevel: 'Write' },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:' + definition.service + ':' + definition.operation,
      resourceTypes: ['quyan/user'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
    }),
  ),
  {
    action: 'quyan:user:GetCurrentUser',
    service: 'user',
    operation: 'GetCurrentUser',
    accessLevel: 'Read',
    resourceTypes: ['quyan/user'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: false,
    authorizationStage: 'declared',
    defaultAuthorizationScope: 'self',
  },
  {
    action: 'quyan:user:UpdateProfile',
    service: 'user',
    operation: 'UpdateProfile',
    accessLevel: 'Write',
    resourceTypes: ['quyan/user'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: false,
    authorizationStage: 'declared',
    legacyPermission: Permission.USER_UPDATE_SELF_PROFILE,
  },
  ...['CreateAccessKey', 'SendAccessKeyCreationVerificationCode'].map(
    (operation): IamActionDefinition => ({
      action: 'quyan:ram:' + operation,
      service: 'ram',
      operation,
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: true,
      authorizationStage: 'declared',
      legacyPermission: Permission.ACCESSKEY_CREATE,
    }),
  ),
  {
    action: 'quyan:ram:ListAccessKeys',
    service: 'ram',
    operation: 'ListAccessKeys',
    accessLevel: 'List',
    resourceTypes: ['quyan/access-key'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
    legacyPermission: Permission.ACCESSKEY_READ,
  },
  {
    action: 'quyan:ram:DeleteAccessKey',
    service: 'ram',
    operation: 'DeleteAccessKey',
    accessLevel: 'Write',
    resourceTypes: ['quyan/access-key'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
    legacyPermission: Permission.ACCESSKEY_DELETE,
  },
  {
    action: 'quyan:notification:ListDeliveryLogs',
    service: 'notification',
    operation: 'ListDeliveryLogs',
    accessLevel: 'List',
    resourceTypes: ['notification/delivery-log'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
    legacyPermission: Permission.NOTIFICATION_MANAGE,
  },
  {
    action: 'quyan:notification:ListEvents',
    service: 'notification',
    operation: 'ListEvents',
    accessLevel: 'List',
    resourceTypes: ['quyan/user'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: false,
    authorizationStage: 'declared',
    defaultAuthorizationScope: 'self',
  },
  {
    action: 'quyan:article:ListArticles',
    service: 'article',
    operation: 'ListArticles',
    accessLevel: 'List',
    resourceTypes: ['article/article'],
    apiRoutes: [],
    conditionKeys: [
      ...IAM_GLOBAL_CONDITION_KEYS,
      'quyan:ResourceOwnerId',
      'quyan:ArticlePublishStatus',
    ],
    sensitive: false,
    authorizationStage: 'declared',
    legacyPermission: Permission.ARTICLE_READ,
  },
  {
    action: 'quyan:article:ReorderArticles',
    service: 'article',
    operation: 'ReorderArticles',
    accessLevel: 'Write',
    resourceTypes: ['article/article'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS, 'quyan:ResourceOwnerId'],
    sensitive: true,
    authorizationStage: 'declared',
    legacyPermission: Permission.ARTICLE_UPDATE,
  },
  {
    action: 'quyan:iam:SimulatePolicy',
    service: 'iam',
    operation: 'SimulatePolicy',
    accessLevel: 'Read',
    resourceTypes: ['quyan/account'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
  },
])
/** The sole source for authenticated self-service grants; it never grants account scope. */
export const IAM_AUTHENTICATED_SELF_ACTIONS: readonly string[] = Object.freeze(
  IAM_ACTION_DEFINITIONS.filter(
    (definition) => definition.defaultAuthorizationScope === 'self',
  ).map((definition) => definition.action),
)
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

/** Canonical compatibility Action plus explicitly registered native operations; never infer by name. */
export function iamActionsForLegacyPermission(permission: Permission): string[] {
  return [
    actionForPermission(permission),
    ...IAM_ACTION_DEFINITIONS.filter(
      (definition) => definition.legacyPermission === permission,
    ).map((definition) => definition.action),
  ]
}
export function isIamActionForLegacyPermission(action: string, permission: Permission): boolean {
  return iamActionsForLegacyPermission(permission).includes(action)
}
