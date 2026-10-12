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
  /** Extra server Actions needed only for documented operation variants, not automatic grants. */
  conditionalActions?: string[]
  conditionKeys: string[]
  sensitive: boolean
  authorizationStage: 'legacy' | 'declared'
  /** Baseline grant restricted to registered authenticated self identity/child ARNs. */
  defaultAuthorizationScope?: 'self'
  /** Registered migration alias only; clients cannot choose the endpoint Action. */
  legacyPermission?: Permission
  /** Multiple former permissions may converge on one fixed native endpoint Action. */
  legacyPermissions?: Permission[]
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
        Array.from({ length: identifierSegments }, (_, index) =>
          index === identifierSegments - 1
            ? '{resourceId}'
            : index === identifierSegments - 2
              ? '{parentId}'
              : '{ancestorId}',
        ).join('/'),
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
  resource('quyan', 'passkey', 2),
  resource('quyan', 'online-session', 2),
  resource('oj', 'api-key', 2),
  resource('json-endpoint', 'endpoint', 2),
  resource('relay', 'channel'),
  resource('relay', 'token', 2),
  resource('developer', 'project'),
  resource('developer', 'kv-item', 2),
  resource('developer', 'secret', 2),
  resource('developer', 'short-link', 2),
  resource('developer', 'project-api-key', 2),
  resource('developer', 'status-monitor', 2),
  resource('developer', 'push-channel', 2),
  resource('developer', 'push-delivery', 2),
  resource('chat', 'conversation'),
  resource('chat', 'message'),
  resource('carpool', 'template'),
  resource('carpool', 'order'),
  resource('script', 'script', 2),
  resource('script', 'execution', 2),
  resource('ticket', 'ticket', 2),
  resource('mcp', 'server', 2),
  resource('agent', 'machine', 2),
  resource('agent', 'workspace', 2),
  resource('agent', 'task', 2),
  resource('agent', 'approval', 3),
  { ...resource('balance', 'gift-code', 2), authenticatedSelfScope: 'children' },
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
  [Permission.AGENT_APPROVAL]: ['agent/task', 'agent/approval'],
  [Permission.AGENT_TASK_RUN]: [
    'agent/task',
    'agent/workspace',
    'chat/conversation',
    'relay/token',
  ],
  [Permission.AGENT_WORKSPACE_READ]: ['agent/machine', 'agent/workspace'],
  [Permission.AGENT_WORKSPACE_WRITE]: ['quyan/user', 'agent/machine', 'agent/workspace'],
  [Permission.MCP_SERVER_READ]: ['mcp/server'],
  [Permission.MCP_SERVER_WRITE]: ['quyan/user', 'mcp/server'],
  [Permission.TICKET_SUBMIT]: ['quyan/user'],
  [Permission.TICKET_SELF_READ]: ['ticket/ticket'],
  [Permission.TICKET_SELF_UPDATE]: ['ticket/ticket'],
  [Permission.TICKET_COMMENT]: ['ticket/ticket'],
  [Permission.SCRIPT_READ]: ['quyan/user', 'script/script', 'script/execution'],
  [Permission.SCRIPT_CREATE]: ['quyan/user', 'script/script'],
  [Permission.SCRIPT_DELETE]: ['script/script'],
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
    {
      service: 'chat',
      operation: 'CreateConversation',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
    },
    {
      service: 'chat',
      operation: 'ListConversations',
      accessLevel: 'List',
      resourceTypes: ['quyan/user'],
    },
    {
      service: 'chat',
      operation: 'GetConversation',
      accessLevel: 'Read',
      resourceTypes: ['chat/conversation'],
    },
    {
      service: 'chat',
      operation: 'UpdateConversation',
      accessLevel: 'Write',
      resourceTypes: ['chat/conversation'],
    },
    {
      service: 'chat',
      operation: 'DeleteConversation',
      accessLevel: 'Write',
      resourceTypes: ['chat/conversation'],
    },
    {
      service: 'chat',
      operation: 'ListMessages',
      accessLevel: 'List',
      resourceTypes: ['chat/conversation'],
    },
    {
      service: 'chat',
      operation: 'DeleteMessage',
      accessLevel: 'Write',
      resourceTypes: ['chat/message'],
    },
    { service: 'chat', operation: 'GetTokens', accessLevel: 'Read', resourceTypes: ['quyan/user'] },
    {
      service: 'chat',
      operation: 'SendMessage',
      accessLevel: 'Write',
      resourceTypes: ['chat/conversation'],
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:chat:' + definition.operation,
      service: 'chat',
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
    }),
  ),
  ...[
    { service: 'support', operation: 'GetAvailability', accessLevel: 'Read' },
    { service: 'support', operation: 'GetConversation', accessLevel: 'Read' },
    { service: 'support', operation: 'ClearConversation', accessLevel: 'Write' },
    { service: 'support', operation: 'SendMessage', accessLevel: 'Write' },
    { service: 'support', operation: 'Handoff', accessLevel: 'Write' },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:support:' + definition.operation,
      service: 'support',
      apiRoutes: [],
      resourceTypes: ['quyan/user'],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
    }),
  ),
  ...[
    {
      service: 'monthly_pass',
      operation: 'ListMyPasses',
      accessLevel: 'List',
      resourceTypes: ['quyan/user'],
    },
    {
      service: 'monthly_pass',
      operation: 'ClaimPublishedTemplate',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
    },
    {
      service: 'monthly_pass',
      operation: 'ListPublishedTemplates',
      accessLevel: 'List',
      resourceTypes: ['quyan/account'],
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:monthly_pass:' + definition.operation,
      service: 'monthly_pass',
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
    }),
  ),
  ...[
    {
      service: 'remote_terminal',
      operation: 'ListPublishedTemplates',
      accessLevel: 'List',
      resourceTypes: ['quyan/account'],
    },
    {
      service: 'remote_terminal',
      operation: 'ListMyEntitlements',
      accessLevel: 'List',
      resourceTypes: ['quyan/user'],
    },
    {
      service: 'remote_terminal',
      operation: 'ClaimPublishedTemplate',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
    },
    {
      service: 'remote_terminal',
      operation: 'RotateMyRegistrationToken',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
    },
    {
      service: 'remote_terminal',
      operation: 'GetMyInstallToken',
      accessLevel: 'Read',
      resourceTypes: ['quyan/user'],
    },
    {
      service: 'remote_terminal',
      operation: 'ListMyDevices',
      accessLevel: 'List',
      resourceTypes: ['quyan/user'],
    },
    {
      service: 'remote_terminal',
      operation: 'GetMyUnbindReminder',
      accessLevel: 'Read',
      resourceTypes: ['quyan/user'],
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:remote_terminal:' + definition.operation,
      service: 'remote_terminal',
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
    }),
  ),
  ...[
    { service: 'content_safety', operation: 'GetUserConfig', accessLevel: 'Read' },
    { service: 'content_safety', operation: 'UpdateUserConfig', accessLevel: 'Write' },
    { service: 'content_safety', operation: 'UpdateRuleOverride', accessLevel: 'Write' },
    { service: 'content_safety', operation: 'DeleteRuleOverride', accessLevel: 'Write' },
    { service: 'content_safety', operation: 'ListUserRules', accessLevel: 'List' },
    { service: 'content_safety', operation: 'CreateUserRule', accessLevel: 'Write' },
    { service: 'content_safety', operation: 'UpdateUserRule', accessLevel: 'Write' },
    { service: 'content_safety', operation: 'DeleteUserRule', accessLevel: 'Write' },
    { service: 'content_safety', operation: 'ImportUserRules', accessLevel: 'Write' },
    { service: 'content_safety', operation: 'BatchUpdateUserRules', accessLevel: 'Write' },
    { service: 'content_safety', operation: 'ExportUserRules', accessLevel: 'Read' },
    { service: 'content_safety', operation: 'ListUserIncidents', accessLevel: 'List' },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:content_safety:' + definition.operation,
      service: 'content_safety',
      apiRoutes: [],
      resourceTypes: ['quyan/user'],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
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
  ...[
    {
      operation: 'GetPasskeyRegistrationOptions',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
    },
    { operation: 'RegisterPasskey', accessLevel: 'Write', resourceTypes: ['quyan/user'] },
    { operation: 'ListPasskeys', accessLevel: 'List', resourceTypes: ['quyan/passkey'] },
    { operation: 'DeletePasskey', accessLevel: 'Write', resourceTypes: ['quyan/passkey'] },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:auth:' + definition.operation,
      service: 'auth',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: true,
      authorizationStage: 'declared',
      legacyPermission: Permission.PASSKEY_MANAGE,
    }),
  ),
  ...[
    {
      operation: 'ListEndpoints',
      accessLevel: 'List',
      resourceTypes: ['json-endpoint/endpoint'],
      legacyPermissions: [Permission.JSON_ENDPOINT_READ, Permission.JSON_ENDPOINT_MANAGE],
    },
    {
      operation: 'GetEndpoint',
      accessLevel: 'Read',
      resourceTypes: ['json-endpoint/endpoint'],
      legacyPermissions: [Permission.JSON_ENDPOINT_READ, Permission.JSON_ENDPOINT_MANAGE],
    },
    {
      operation: 'ListEndpointOwners',
      accessLevel: 'List',
      resourceTypes: ['quyan/user'],
      legacyPermissions: [Permission.JSON_ENDPOINT_MANAGE],
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:json_endpoint:' + definition.operation,
      service: 'json_endpoint',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: true,
      authorizationStage: 'declared',
    }),
  ),
  {
    action: 'quyan:json_endpoint:DeleteEndpoint',
    service: 'json_endpoint',
    operation: 'DeleteEndpoint',
    accessLevel: 'Write',
    resourceTypes: ['json-endpoint/endpoint'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
    legacyPermissions: [Permission.JSON_ENDPOINT_DELETE, Permission.JSON_ENDPOINT_MANAGE],
  },
  {
    action: 'quyan:json_endpoint:UpdateEndpoint',
    service: 'json_endpoint',
    operation: 'UpdateEndpoint',
    accessLevel: 'Write',
    resourceTypes: ['json-endpoint/endpoint'],
    apiRoutes: [],
    conditionalActions: ['quyan:json_endpoint:SetRootSlug'],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
    legacyPermissions: [Permission.JSON_ENDPOINT_UPDATE, Permission.JSON_ENDPOINT_MANAGE],
  },
  {
    action: 'quyan:json_endpoint:SetRootSlug',
    service: 'json_endpoint',
    operation: 'SetRootSlug',
    accessLevel: 'Write',
    resourceTypes: ['json-endpoint/endpoint', 'quyan/user'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
    legacyPermission: Permission.JSON_ENDPOINT_ROOT_SLUG,
  },
  {
    action: 'quyan:json_endpoint:CreateEndpoint',
    service: 'json_endpoint',
    operation: 'CreateEndpoint',
    accessLevel: 'Write',
    resourceTypes: ['quyan/user'],
    apiRoutes: [],
    conditionalActions: ['quyan:json_endpoint:SetRootSlug'],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
    legacyPermissions: [Permission.JSON_ENDPOINT_CREATE, Permission.JSON_ENDPOINT_MANAGE],
  },
  ...[
    {
      operation: 'ListOnlineSessions',
      resourceTypes: ['quyan/online-session'],
      accessLevel: 'List',
    },
    { operation: 'GetOnlineUser', resourceTypes: ['quyan/user'], accessLevel: 'Read' },
    {
      operation: 'GetOnlineUserTimeline',
      resourceTypes: ['quyan/online-session'],
      accessLevel: 'List',
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      action: 'quyan:user:' + definition.operation,
      service: 'user',
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: true,
      authorizationStage: 'declared',
      legacyPermission: Permission.USER_ONLINE_MONITOR_READ,
    }),
  ),
  ...[
    { operation: 'ForceOfflineSession', resourceTypes: ['quyan/online-session'] },
    { operation: 'ForceOfflineUser', resourceTypes: ['quyan/user'] },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:user:' + definition.operation,
      service: 'user',
      accessLevel: 'Write',
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: true,
      authorizationStage: 'declared',
      legacyPermission: Permission.USER_ONLINE_MONITOR_FORCE_OFFLINE,
    }),
  ),
  {
    action: 'quyan:support:GetUserConversation',
    service: 'support',
    operation: 'GetUserConversation',
    accessLevel: 'Read',
    resourceTypes: ['quyan/user'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
    legacyPermission: Permission.SUPPORT_AI_ANALYTICS_READ,
  },
  ...['ListApiKeys', 'GetApiKey', 'GetApiKeyStats', 'RevealApiKey'].map(
    (operation): IamActionDefinition => ({
      action: 'quyan:oj:' + operation,
      service: 'oj',
      operation,
      accessLevel: operation === 'ListApiKeys' ? 'List' : 'Read',
      resourceTypes: ['oj/api-key'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: operation === 'RevealApiKey',
      ...(operation === 'ListApiKeys' || operation === 'GetApiKey'
        ? { conditionalActions: ['quyan:oj:RevealApiKey'] }
        : {}),
      authorizationStage: 'declared',
      legacyPermission: Permission.OJ_APIKEY_READ,
    }),
  ),
  {
    action: 'quyan:oj:DeleteApiKey',
    service: 'oj',
    operation: 'DeleteApiKey',
    accessLevel: 'Write',
    resourceTypes: ['oj/api-key'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
    legacyPermission: Permission.OJ_APIKEY_DELETE,
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
  ...[
    { operation: 'GetAccount', accessLevel: 'Read' },
    { operation: 'GetUsage', accessLevel: 'Read' },
    { operation: 'GetTransferConfig', accessLevel: 'Read' },
    { operation: 'ListGiftCodes', accessLevel: 'List' },
    { operation: 'CreateGiftCode', accessLevel: 'Write' },
    { operation: 'CancelGiftCode', accessLevel: 'Write' },
    { operation: 'CreateTransfer', accessLevel: 'Write' },
    { operation: 'ListTransactions', accessLevel: 'List' },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:balance:' + definition.operation,
      service: 'balance',
      resourceTypes:
        definition.operation === 'CancelGiftCode'
          ? ['balance/gift-code']
          : definition.operation === 'ListGiftCodes'
            ? ['quyan/user', 'balance/gift-code']
            : ['quyan/user'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
      defaultAuthorizationScope: 'self',
    }),
  ),
  ...[
    {
      operation: 'ListTaskApprovals',
      accessLevel: 'List',
      resourceTypes: ['agent/task'],
      legacyPermission: Permission.AGENT_APPROVAL,
    },
    {
      operation: 'GetApproval',
      accessLevel: 'Read',
      resourceTypes: ['agent/approval'],
      legacyPermission: Permission.AGENT_APPROVAL,
    },
    {
      operation: 'DecideApproval',
      accessLevel: 'Write',
      resourceTypes: ['agent/task', 'agent/approval'],
      legacyPermission: Permission.AGENT_APPROVAL,
    },
    {
      operation: 'CreateTask',
      accessLevel: 'Write',
      resourceTypes: ['agent/workspace', 'chat/conversation'],
      legacyPermission: Permission.AGENT_TASK_RUN,
    },
    {
      operation: 'UseRelayToken',
      accessLevel: 'Write',
      resourceTypes: ['relay/token'],
      legacyPermission: Permission.AGENT_TASK_RUN,
    },
    {
      operation: 'GetTaskEvents',
      accessLevel: 'Read',
      resourceTypes: ['agent/task'],
      legacyPermission: Permission.AGENT_TASK_RUN,
    },
    {
      operation: 'CancelTask',
      accessLevel: 'Write',
      resourceTypes: ['agent/task'],
      legacyPermission: Permission.AGENT_TASK_RUN,
    },
    {
      operation: 'ListWorkspaces',
      accessLevel: 'List',
      resourceTypes: ['quyan/user', 'agent/workspace'],
      legacyPermission: Permission.AGENT_WORKSPACE_READ,
    },
    {
      operation: 'ListMachines',
      accessLevel: 'List',
      resourceTypes: ['quyan/user', 'agent/machine'],
      legacyPermission: Permission.AGENT_WORKSPACE_READ,
    },
    {
      operation: 'DeleteWorkspace',
      accessLevel: 'Write',
      resourceTypes: ['agent/workspace'],
      legacyPermission: Permission.AGENT_WORKSPACE_WRITE,
    },
    {
      operation: 'CreateWorkspace',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
      legacyPermission: Permission.AGENT_WORKSPACE_WRITE,
    },
    {
      operation: 'UseMachine',
      accessLevel: 'Write',
      resourceTypes: ['agent/machine'],
      legacyPermission: Permission.AGENT_WORKSPACE_WRITE,
    },
    {
      operation: 'CreateMachine',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
      legacyPermission: Permission.AGENT_WORKSPACE_WRITE,
    },
    {
      operation: 'DeleteMachine',
      accessLevel: 'Write',
      resourceTypes: ['agent/machine'],
      legacyPermission: Permission.AGENT_WORKSPACE_WRITE,
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:agent:' + definition.operation,
      service: 'agent',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
    }),
  ),
  ...[
    {
      operation: 'ListServers',
      accessLevel: 'List',
      resourceTypes: ['quyan/user', 'mcp/server'],
      legacyPermission: Permission.MCP_SERVER_READ,
    },
    {
      operation: 'CreateServer',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
      legacyPermission: Permission.MCP_SERVER_WRITE,
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:mcp:' + definition.operation,
      service: 'mcp',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
    }),
  ),
  ...[
    {
      operation: 'CreateTicket',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
      legacyPermission: Permission.TICKET_SUBMIT,
    },
    {
      operation: 'ListOwnTickets',
      accessLevel: 'List',
      resourceTypes: ['quyan/user', 'ticket/ticket'],
      legacyPermission: Permission.TICKET_SELF_READ,
    },
    {
      operation: 'GetOwnTicket',
      accessLevel: 'Read',
      resourceTypes: ['ticket/ticket'],
      legacyPermission: Permission.TICKET_SELF_READ,
    },
    {
      operation: 'UpdateOwnTicket',
      accessLevel: 'Write',
      resourceTypes: ['ticket/ticket'],
      legacyPermission: Permission.TICKET_SELF_UPDATE,
    },
    {
      operation: 'AddOwnComment',
      accessLevel: 'Write',
      resourceTypes: ['ticket/ticket'],
      legacyPermission: Permission.TICKET_COMMENT,
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:ticket:' + definition.operation,
      service: 'ticket',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
    }),
  ),
  ...[
    {
      operation: 'ListExecutions',
      accessLevel: 'List',
      resourceTypes: ['quyan/user', 'script/script', 'script/execution'],
      legacyPermission: Permission.SCRIPT_READ,
    },
    {
      operation: 'SaveExecution',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user', 'script/script'],
      legacyPermission: Permission.SCRIPT_READ,
    },
    {
      operation: 'ListScripts',
      accessLevel: 'List',
      resourceTypes: ['quyan/user', 'script/script'],
      legacyPermission: Permission.SCRIPT_READ,
    },
    {
      operation: 'CreateScript',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user'],
      legacyPermission: Permission.SCRIPT_CREATE,
    },
    {
      operation: 'UpdateScript',
      accessLevel: 'Write',
      resourceTypes: ['script/script'],
      legacyPermission: Permission.SCRIPT_CREATE,
    },
    {
      operation: 'DeleteScript',
      accessLevel: 'Write',
      resourceTypes: ['script/script'],
      legacyPermission: Permission.SCRIPT_DELETE,
    },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:script:' + definition.operation,
      service: 'script',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
    }),
  ),
  ...[
    { operation: 'ListPublishedTemplates', accessLevel: 'List', resourceTypes: ['quyan/account'] },
    { operation: 'ListPackageCatalog', accessLevel: 'List', resourceTypes: ['quyan/account'] },
    {
      operation: 'ListMyOrders',
      accessLevel: 'List',
      resourceTypes: ['quyan/user', 'carpool/order'],
    },
    {
      operation: 'CreateOrder',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user', 'carpool/template'],
    },
    { operation: 'GetOrder', accessLevel: 'Read', resourceTypes: ['carpool/order'] },
    { operation: 'CreateInvite', accessLevel: 'Write', resourceTypes: ['carpool/order'] },
    {
      operation: 'AcceptInvite',
      accessLevel: 'Write',
      resourceTypes: ['quyan/user', 'carpool/order'],
    },
    { operation: 'AllocateRatios', accessLevel: 'Write', resourceTypes: ['carpool/order'] },
    { operation: 'ConfirmMember', accessLevel: 'Write', resourceTypes: ['carpool/order'] },
    { operation: 'LeaveOrder', accessLevel: 'Write', resourceTypes: ['carpool/order'] },
    { operation: 'CancelOrder', accessLevel: 'Write', resourceTypes: ['carpool/order'] },
    { operation: 'SubmitOrder', accessLevel: 'Write', resourceTypes: ['carpool/order'] },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:carpool:' + definition.operation,
      service: 'carpool',
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
    }),
  ),
  ...[
    { service: 'auth', operation: 'ListExternalIdentities', accessLevel: 'List' },
    { service: 'auth', operation: 'BindExternalIdentity', accessLevel: 'Write' },
    { service: 'auth', operation: 'UnbindExternalIdentity', accessLevel: 'Write' },
    { service: 'auth', operation: 'CreateCentralLoginFlow', accessLevel: 'Write' },
    { service: 'auth', operation: 'ConsumeCentralLoginFlow', accessLevel: 'Write' },
    { service: 'auth', operation: 'ScanQrLogin', accessLevel: 'Write' },
    { service: 'auth', operation: 'ConfirmQrLogin', accessLevel: 'Write' },
    { service: 'oauth', operation: 'ListScopes', accessLevel: 'List' },
    { service: 'oauth', operation: 'GetAuthorizationPreview', accessLevel: 'Read' },
    { service: 'oauth', operation: 'DecideAuthorization', accessLevel: 'Write' },
    { service: 'auth_center', operation: 'GetAuthorizationPreview', accessLevel: 'Read' },
    { service: 'auth_center', operation: 'DecideAuthorization', accessLevel: 'Write' },
  ].map(
    (definition): IamActionDefinition => ({
      ...definition,
      action: 'quyan:' + definition.service + ':' + definition.operation,
      accessLevel: definition.accessLevel as IamActionDefinition['accessLevel'],
      resourceTypes: ['quyan/user'],
      apiRoutes: [],
      conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
      sensitive: definition.accessLevel === 'Write',
      authorizationStage: 'declared',
      defaultAuthorizationScope: 'self',
    }),
  ),
  {
    action: 'quyan:balance:RedeemCode',
    service: 'balance',
    operation: 'RedeemCode',
    accessLevel: 'Write',
    resourceTypes: ['quyan/user'],
    apiRoutes: [],
    conditionKeys: [...IAM_GLOBAL_CONDITION_KEYS],
    sensitive: true,
    authorizationStage: 'declared',
    defaultAuthorizationScope: 'self',
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
      (definition) =>
        definition.legacyPermission === permission ||
        definition.legacyPermissions?.includes(permission),
    ).map((definition) => definition.action),
  ]
}
export function isIamActionForLegacyPermission(action: string, permission: Permission): boolean {
  return iamActionsForLegacyPermission(permission).includes(action)
}
