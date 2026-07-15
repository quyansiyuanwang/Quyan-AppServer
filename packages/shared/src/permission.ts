/**
 * 系统权限枚举
 * 定义了系统中所有可用的权限
 *
 * 这是唯一的规范数据源。前后端都从这里 re-export。
 */
export enum Permission {
  // 用户管理权限
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',
  USER_CHANGE_SELF_PASSWORD = 'user:change_self_password',
  USER_CHANGE_OTHERS_PASSWORD = 'user:change_others_password',
  USER_UPDATE_SELF_PROFILE = 'user:update_self_profile',
  USER_UPDATE_SELF_EMAIL = 'user:update_self_email',
  USER_IMPERSONATE_VIEW = 'user:impersonate:view',
  USER_IMPERSONATE_ACT = 'user:impersonate:act',

  // 用户组管理权限
  GROUP_CREATE = 'group:create',
  GROUP_READ = 'group:read',
  GROUP_UPDATE = 'group:update',
  GROUP_DELETE = 'group:delete',
  GROUP_PERMISSION_ADD = 'group:permission:add',
  GROUP_PERMISSION_REMOVE = 'group:permission:remove',

  // 权限管理权限
  PERMISSION_VIEW = 'permission:manage',
  PERMISSION_ADD = 'permission:add',
  PERMISSION_REMOVE = 'permission:remove',

  // RAM 访问控制权限
  RAM_USER_CREATE = 'ram:user:create',
  RAM_USER_READ = 'ram:user:read',
  RAM_USER_UPDATE = 'ram:user:update',
  RAM_USER_DELETE = 'ram:user:delete',
  RAM_ROLE_CREATE = 'ram:role:create',
  RAM_ROLE_READ = 'ram:role:read',
  RAM_ROLE_UPDATE = 'ram:role:update',
  RAM_ROLE_DELETE = 'ram:role:delete',
  RAM_BINDING_CREATE = 'ram:binding:create',
  RAM_BINDING_READ = 'ram:binding:read',
  RAM_BINDING_DELETE = 'ram:binding:delete',
  RAM_ASSUME_ROLE = 'ram:assume_role',
  RAM_SESSION_READ = 'ram:session:read',
  RAM_SESSION_REVOKE = 'ram:session:revoke',

  // RAM 权限策略权限
  RAM_POLICY_CREATE = 'ram:policy:create',
  RAM_POLICY_READ = 'ram:policy:read',
  RAM_POLICY_UPDATE = 'ram:policy:update',
  RAM_POLICY_DELETE = 'ram:policy:delete',
  RAM_POLICY_ATTACH = 'ram:policy:attach',
  RAM_POLICY_DETACH = 'ram:policy:detach',

  // 系统管理权限
  SYSTEM_CONFIG = 'system:config',
  SYSTEM_STATS_READ = 'system:stats:read',
  SYSTEM_CONSUMPTION_STATS_READ = 'system:consumption:read',
  SYSTEM_LOG_READ = 'system:log:read',
  SYSTEM_SERVER_LOG_READ = 'system:server_log:read',
  SYSTEM_BUSINESS_LOG_READ = 'system:business_log:read',
  USER_ONLINE_MONITOR_READ = 'user_online_monitor:read',
  USER_ONLINE_MONITOR_FORCE_OFFLINE = 'user_online_monitor:force_offline',

  // API日志权限
  API_LOG_READ = 'api_log:read',

  // IP黑名单权限
  IP_BLACKLIST_CREATE = 'ip_blacklist:create',
  IP_BLACKLIST_READ = 'ip_blacklist:read',
  IP_BLACKLIST_UPDATE = 'ip_blacklist:update',
  IP_BLACKLIST_DELETE = 'ip_blacklist:delete',

  // IP白名单权限
  IP_WHITELIST_CREATE = 'ip_whitelist:create',
  IP_WHITELIST_READ = 'ip_whitelist:read',
  IP_WHITELIST_DELETE = 'ip_whitelist:delete',

  // 中转令牌权限
  RELAY_TOKEN_CREATE = 'relay:token:create',
  RELAY_TOKEN_READ = 'relay:token:read',
  RELAY_TOKEN_UPDATE = 'relay:token:update',
  RELAY_TOKEN_DELETE = 'relay:token:delete',
  RELAY_TOKEN_CUSTOM_KEY = 'relay:token:custom_key',
  RELAY_TOKEN_CUSTOM_KEY_FREE = 'relay:token:custom_key:free',
  RELAY_TOKEN_MANAGE_OTHERS_READ = 'relay:token:manage_others:read',
  RELAY_TOKEN_MANAGE_OTHERS_UPDATE = 'relay:token:manage_others:update',

  // 中转渠道权限
  RELAY_CHANNEL_CREATE = 'relay:channel:create',
  RELAY_CHANNEL_READ = 'relay:channel:read',
  RELAY_CHANNEL_UPDATE = 'relay:channel:update',
  RELAY_CHANNEL_DELETE = 'relay:channel:delete',
  RELAY_CHANNEL_EXPORT = 'relay:channel:export',

  // AccessKey权限
  ACCESSKEY_CREATE = 'accesskey:create',
  ACCESSKEY_READ = 'accesskey:read',
  ACCESSKEY_DELETE = 'accesskey:delete',

  // OAuth 应用权限
  OAUTH_CLIENT_CREATE = 'oauth:client:create',
  OAUTH_CLIENT_READ = 'oauth:client:read',
  OAUTH_CLIENT_UPDATE = 'oauth:client:update',
  OAUTH_CLIENT_DELETE = 'oauth:client:delete',
  OAUTH_CLIENT_REVIEW_READ = 'oauth:client:review:read',
  OAUTH_CLIENT_REVIEW_UPDATE = 'oauth:client:review:update',

  // Auth Center 应用权限
  AUTH_CENTER_CLIENT_CREATE = 'auth_center:client:create',
  AUTH_CENTER_CLIENT_READ = 'auth_center:client:read',
  AUTH_CENTER_CLIENT_UPDATE = 'auth_center:client:update',
  AUTH_CENTER_CLIENT_DELETE = 'auth_center:client:delete',
  AUTH_CENTER_CLIENT_REVIEW_READ = 'auth_center:client:review:read',
  AUTH_CENTER_CLIENT_REVIEW_UPDATE = 'auth_center:client:review:update',

  // 兑换码权限
  REDEMPTION_CODE_DELETE = 'redemption:code:delete',
  REDEMPTION_CODE_CREATE = 'redemption:code:create',
  REDEMPTION_CODE_READ = 'redemption:code:read',

  // 余额管理权限
  BALANCE_READ = 'balance:read',
  BALANCE_RECHARGE = 'balance:recharge',

  // 月卡管理权限
  MONTHLY_PASS_TEMPLATE_READ = 'monthly_pass:template:read',
  MONTHLY_PASS_TEMPLATE_WRITE = 'monthly_pass:template:write',
  MONTHLY_PASS_ASSIGNMENT_READ = 'monthly_pass:assignment:read',
  MONTHLY_PASS_ASSIGNMENT_WRITE = 'monthly_pass:assignment:write',
  MONTHLY_PASS_USAGE_READ = 'monthly_pass:usage:read',

  // 工单管理权限
  TICKET_SUBMIT = 'ticket:submit',
  TICKET_SELF_READ = 'ticket:self:read',
  TICKET_SELF_UPDATE = 'ticket:self:update',
  TICKET_COMMENT = 'ticket:comment',
  TICKET_REVIEW_READ = 'ticket:review:read',
  TICKET_REVIEW_UPDATE = 'ticket:review:update',

  // 模型价格权限
  MODEL_PRICING_READ = 'model:pricing:read',
  MODEL_PRICING_UPDATE = 'model:pricing:update',

  // 上游状态权限
  UPSTREAM_STATUS_READ = 'upstream:status:read',

  // 远程终端权限
  REMOTE_TERMINAL_PRODUCT_READ = 'remote_terminal:product:read',
  REMOTE_TERMINAL_PRODUCT_WRITE = 'remote_terminal:product:write',
  REMOTE_TERMINAL_ASSIGNMENT_READ = 'remote_terminal:assignment:read',
  REMOTE_TERMINAL_ASSIGNMENT_WRITE = 'remote_terminal:assignment:write',
  REMOTE_TERMINAL_REGISTRATION_TOKEN_READ = 'remote_terminal:registration_token:read',
  REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE = 'remote_terminal:registration_token:write',
  REMOTE_TERMINAL_DEVICE_READ = 'remote_terminal:device:read',
  REMOTE_TERMINAL_DEVICE_MANAGE_READ = 'remote_terminal:device:manage:read',
  REMOTE_TERMINAL_DEVICE_WRITE = 'remote_terminal:device:write',
  REMOTE_TERMINAL_SESSION_CREATE = 'remote_terminal:session:create',
  REMOTE_TERMINAL_SESSION_READ = 'remote_terminal:session:read',

  // OJSubmitter AI问答权限
  OJ_APIKEY_CREATE = 'oj:apikey:create',
  OJ_APIKEY_READ = 'oj:apikey:read',
  OJ_APIKEY_UPDATE = 'oj:apikey:update',
  OJ_APIKEY_DELETE = 'oj:apikey:delete',
  OJ_USAGE_READ = 'oj:usage:read',
  OJ_PRICING_READ = 'oj:pricing:read',
  OJ_PRICING_UPDATE = 'oj:pricing:update',

  // JSON端点权限
  JSON_ENDPOINT_CREATE = 'json_endpoint:create',
  JSON_ENDPOINT_READ = 'json_endpoint:read',
  JSON_ENDPOINT_UPDATE = 'json_endpoint:update',
  JSON_ENDPOINT_DELETE = 'json_endpoint:delete',

  // 文章管理权限
  ARTICLE_CREATE = 'article:create',
  ARTICLE_READ = 'article:read',
  ARTICLE_UPDATE = 'article:update',
  ARTICLE_DELETE = 'article:delete',
  ARTICLE_PUBLISH = 'article:publish',

  // 法律协议管理权限
  LEGAL_POLICY_CREATE = 'legal_policy:create',
  LEGAL_POLICY_READ = 'legal_policy:read',
  LEGAL_POLICY_UPDATE = 'legal_policy:update',
  LEGAL_POLICY_DELETE = 'legal_policy:delete',
  LEGAL_POLICY_PUBLISH = 'legal_policy:publish',

  // JS脚本管理权限
  SCRIPT_CREATE = 'script:create',
  SCRIPT_READ = 'script:read',
  SCRIPT_DELETE = 'script:delete',

  // Analytics Permissions
  ANALYTICS_READ = 'analytics:read',
  ANALYTICS_MANAGE = 'analytics:manage',

  // Notification Permissions
  NOTIFICATION_MANAGE = 'notification:manage',

  // Passkey Permissions
  PASSKEY_MANAGE = 'passkey:manage',

  // Special Permissions
  DEBUG_ACCESS = 'debug:access',
  DEBUG_OPENAPI_READ = 'debug:openapi:read',
}

/**
 * 获取所有权限列表
 */
export const ALL_PERMISSIONS = Object.values(Permission);

/**
 * 获取权限所属分类
 * @param permission 权限值
 * @returns 权限分类名称
 */
export function getPermissionCategory(permission: Permission | string): string {
  const prefix = permission.split(':')[0] ?? '';
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}
