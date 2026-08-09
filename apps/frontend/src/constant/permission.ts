import { Permission, ALL_PERMISSIONS } from '@appserver/shared'
export { Permission, ALL_PERMISSIONS }

/**
 * 权限元数据接口
 * 每个权限的中英文显示名、描述和分类
 * 新增权限枚举成员时，必须同时在 PERMISSION_META 中添加对应条目
 */
export interface PermissionMeta {
  label: string
  labelEn: string
  tooltip: string
  tooltipEn: string
  category: string
}

type PermissionMetaMap = {
  [K in Permission]: PermissionMeta
}

/**
 * 权限元数据映射表
 * 所有权限的中英文翻译和分类信息集中管理
 * TypeScript mapped type 约束：Permission 枚举的每个成员都必须有对应条目
 */
export const PERMISSION_META: PermissionMetaMap = {
  [Permission.USER_CREATE]: {
    label: '创建用户',
    labelEn: 'Create User',
    tooltip: '允许创建新的用户账户',
    tooltipEn: 'Allows creating new user accounts',
    category: 'user',
  },
  [Permission.USER_READ]: {
    label: '查看用户',
    labelEn: 'View User',
    tooltip: '允许查看用户账户详情和列表',
    tooltipEn: 'Allows viewing user account details and lists',
    category: 'user',
  },
  [Permission.USER_UPDATE]: {
    label: '修改用户',
    labelEn: 'Update User',
    tooltip: '允许修改用户账户信息',
    tooltipEn: 'Allows modifying user account information',
    category: 'user',
  },
  [Permission.USER_DELETE]: {
    label: '删除用户',
    labelEn: 'Delete User',
    tooltip: '允许删除用户账户',
    tooltipEn: 'Allows deleting user accounts',
    category: 'user',
  },
  [Permission.USER_CHANGE_SELF_PASSWORD]: {
    label: '修改自己的密码',
    labelEn: 'Change Own Password',
    tooltip: '允许用户修改自己的密码',
    tooltipEn: 'Allows the user to change their own password',
    category: 'user',
  },
  [Permission.USER_CHANGE_OTHERS_PASSWORD]: {
    label: '修改他人密码',
    labelEn: 'Change Others Password',
    tooltip: '允许修改其他用户的密码',
    tooltipEn: 'Allows changing passwords for other users',
    category: 'user',
  },
  [Permission.USER_UPDATE_SELF_PROFILE]: {
    label: '更新自己的资料',
    labelEn: 'Update Own Profile',
    tooltip: '允许用户更新自己的个人资料',
    tooltipEn: 'Allows the user to update their own profile information',
    category: 'user',
  },
  [Permission.USER_UPDATE_SELF_EMAIL]: {
    label: '更新自己的邮箱',
    labelEn: 'Update Own Email',
    tooltip: '允许用户更新自己的邮箱地址',
    tooltipEn: 'Allows the user to update their own email address',
    category: 'user',
  },
  [Permission.USER_IMPERSONATE_VIEW]: {
    label: '查看用户模拟',
    labelEn: 'View Impersonation',
    tooltip: '允许查看用户模拟功能',
    tooltipEn: 'Allows viewing user impersonation capabilities',
    category: 'user',
  },
  [Permission.USER_IMPERSONATE_ACT]: {
    label: '模拟用户登录',
    labelEn: 'Impersonate User',
    tooltip: '允许模拟其他用户账户登录',
    tooltipEn: 'Allows impersonating other user accounts',
    category: 'user',
  },

  [Permission.GROUP_CREATE]: {
    label: '创建用户组',
    labelEn: 'Create Group',
    tooltip: '允许创建新的用户组',
    tooltipEn: 'Allows creating new user groups',
    category: 'group',
  },
  [Permission.GROUP_READ]: {
    label: '查看用户组',
    labelEn: 'View Group',
    tooltip: '允许查看用户组详情和成员列表',
    tooltipEn: 'Allows viewing group details and member lists',
    category: 'group',
  },
  [Permission.GROUP_UPDATE]: {
    label: '修改用户组',
    labelEn: 'Update Group',
    tooltip: '允许修改用户组信息',
    tooltipEn: 'Allows modifying group information',
    category: 'group',
  },
  [Permission.GROUP_DELETE]: {
    label: '删除用户组',
    labelEn: 'Delete Group',
    tooltip: '允许删除用户组',
    tooltipEn: 'Allows deleting user groups',
    category: 'group',
  },
  [Permission.GROUP_PERMISSION_ADD]: {
    label: '添加组权限',
    labelEn: 'Add Group Permission',
    tooltip: '允许向用户组添加权限',
    tooltipEn: 'Allows adding permissions to a group',
    category: 'group',
  },
  [Permission.GROUP_PERMISSION_REMOVE]: {
    label: '移除组权限',
    labelEn: 'Remove Group Permission',
    tooltip: '允许从用户组移除权限',
    tooltipEn: 'Allows removing permissions from a group',
    category: 'group',
  },

  [Permission.PERMISSION_VIEW]: {
    label: '查看权限列表',
    labelEn: 'View Permissions',
    tooltip: '允许查看系统中所有可用的权限',
    tooltipEn: 'Allows viewing all available permissions in the system',
    category: 'permission',
  },
  [Permission.PERMISSION_ADD]: {
    label: '添加权限',
    labelEn: 'Add Permission',
    tooltip: '允许为用户授予额外权限',
    tooltipEn: 'Allows granting additional permissions to users',
    category: 'permission',
  },
  [Permission.PERMISSION_REMOVE]: {
    label: '移除权限',
    labelEn: 'Remove Permission',
    tooltip: '允许移除用户的权限',
    tooltipEn: 'Allows removing permissions from users',
    category: 'permission',
  },

  [Permission.RAM_USER_CREATE]: {
    label: '创建 RAM 用户',
    labelEn: 'Create RAM User',
    tooltip: '允许创建 RAM（资源访问管理）用户',
    tooltipEn: 'Allows creating RAM (Resource Access Management) users',
    category: 'ram',
  },
  [Permission.RAM_USER_READ]: {
    label: '查看 RAM 用户',
    labelEn: 'View RAM User',
    tooltip: '允许查看 RAM 用户详情',
    tooltipEn: 'Allows viewing RAM user details',
    category: 'ram',
  },
  [Permission.RAM_USER_UPDATE]: {
    label: '修改 RAM 用户',
    labelEn: 'Update RAM User',
    tooltip: '允许修改 RAM 用户信息',
    tooltipEn: 'Allows modifying RAM user information',
    category: 'ram',
  },
  [Permission.RAM_USER_DELETE]: {
    label: '删除 RAM 用户',
    labelEn: 'Delete RAM User',
    tooltip: '允许删除 RAM 用户',
    tooltipEn: 'Allows deleting RAM users',
    category: 'ram',
  },
  [Permission.RAM_ROLE_CREATE]: {
    label: '创建 RAM 角色',
    labelEn: 'Create RAM Role',
    tooltip: '允许创建新的 RAM 角色',
    tooltipEn: 'Allows creating new RAM roles',
    category: 'ram',
  },
  [Permission.RAM_ROLE_READ]: {
    label: '查看 RAM 角色',
    labelEn: 'View RAM Role',
    tooltip: '允许查看 RAM 角色详情',
    tooltipEn: 'Allows viewing RAM role details',
    category: 'ram',
  },
  [Permission.RAM_ROLE_UPDATE]: {
    label: '修改 RAM 角色',
    labelEn: 'Update RAM Role',
    tooltip: '允许修改 RAM 角色配置',
    tooltipEn: 'Allows modifying RAM role configuration',
    category: 'ram',
  },
  [Permission.RAM_ROLE_DELETE]: {
    label: '删除 RAM 角色',
    labelEn: 'Delete RAM Role',
    tooltip: '允许删除 RAM 角色',
    tooltipEn: 'Allows deleting RAM roles',
    category: 'ram',
  },
  [Permission.RAM_BINDING_CREATE]: {
    label: '创建 RAM 绑定',
    labelEn: 'Create RAM Binding',
    tooltip: '允许将角色绑定到用户',
    tooltipEn: 'Allows binding roles to users',
    category: 'ram',
  },
  [Permission.RAM_BINDING_READ]: {
    label: '查看 RAM 绑定',
    labelEn: 'View RAM Binding',
    tooltip: '允许查看角色-用户绑定关系',
    tooltipEn: 'Allows viewing role-user bindings',
    category: 'ram',
  },
  [Permission.RAM_BINDING_DELETE]: {
    label: '删除 RAM 绑定',
    labelEn: 'Delete RAM Binding',
    tooltip: '允许解除角色-用户绑定',
    tooltipEn: 'Allows removing role-user bindings',
    category: 'ram',
  },
  [Permission.RAM_ASSUME_ROLE]: {
    label: '扮演 RAM 角色',
    labelEn: 'Assume RAM Role',
    tooltip: '允许临时扮演一个 RAM 角色',
    tooltipEn: 'Allows assuming a RAM role temporarily',
    category: 'ram',
  },
  [Permission.RAM_SESSION_READ]: {
    label: '查看 RAM 会话',
    labelEn: 'View RAM Session',
    tooltip: '允许查看活跃的 RAM 角色会话',
    tooltipEn: 'Allows viewing active RAM role sessions',
    category: 'ram',
  },
  [Permission.RAM_SESSION_REVOKE]: {
    label: '撤销 RAM 会话',
    labelEn: 'Revoke RAM Session',
    tooltip: '允许撤销活跃的 RAM 角色会话',
    tooltipEn: 'Allows revoking active RAM role sessions',
    category: 'ram',
  },

  [Permission.RAM_POLICY_CREATE]: {
    label: '创建策略',
    labelEn: 'Create Policy',
    tooltip: '允许创建新的 RAM 策略',
    tooltipEn: 'Allows creating new RAM policies',
    category: 'ram',
  },
  [Permission.RAM_POLICY_READ]: {
    label: '查看策略',
    labelEn: 'View Policy',
    tooltip: '允许查看 RAM 策略详情',
    tooltipEn: 'Allows viewing RAM policy details',
    category: 'ram',
  },
  [Permission.RAM_POLICY_UPDATE]: {
    label: '修改策略',
    labelEn: 'Update Policy',
    tooltip: '允许修改 RAM 策略配置',
    tooltipEn: 'Allows modifying RAM policy configurations',
    category: 'ram',
  },
  [Permission.RAM_POLICY_DELETE]: {
    label: '删除策略',
    labelEn: 'Delete Policy',
    tooltip: '允许删除 RAM 策略',
    tooltipEn: 'Allows deleting RAM policies',
    category: 'ram',
  },
  [Permission.RAM_POLICY_ATTACH]: {
    label: '附加策略',
    labelEn: 'Attach Policy',
    tooltip: '允许将策略附加到角色或用户',
    tooltipEn: 'Allows attaching policies to roles or users',
    category: 'ram',
  },
  [Permission.RAM_POLICY_DETACH]: {
    label: '分离策略',
    labelEn: 'Detach Policy',
    tooltip: '允许从角色或用户分离策略',
    tooltipEn: 'Allows detaching policies from roles or users',
    category: 'ram',
  },

  [Permission.SYSTEM_CONFIG]: {
    label: '系统配置',
    labelEn: 'System Config',
    tooltip: '允许查看和修改系统配置',
    tooltipEn: 'Allows viewing and modifying system configuration',
    category: 'system',
  },
  [Permission.SYSTEM_STATS_READ]: {
    label: '查看系统统计',
    labelEn: 'View System Stats',
    tooltip: '允许查看系统统计数据',
    tooltipEn: 'Allows viewing system statistics',
    category: 'system',
  },
  [Permission.SYSTEM_CONSUMPTION_STATS_READ]: {
    label: '查看消费统计',
    labelEn: 'View Consumption Stats',
    tooltip: '允许查看资源消耗统计数据',
    tooltipEn: 'Allows viewing resource consumption statistics',
    category: 'system',
  },
  [Permission.SYSTEM_LOG_READ]: {
    label: '查看系统日志',
    labelEn: 'View System Logs',
    tooltip: '允许查看系统操作日志',
    tooltipEn: 'Allows viewing system operation logs',
    category: 'system',
  },
  [Permission.SYSTEM_SERVER_LOG_READ]: {
    label: '查看服务端日志',
    labelEn: 'View Server Logs',
    tooltip: '允许查看服务端运行日志',
    tooltipEn: 'Allows viewing server runtime logs',
    category: 'system',
  },
  [Permission.SYSTEM_BUSINESS_LOG_READ]: {
    label: '查看业务日志',
    labelEn: 'View Business Logs',
    tooltip: '允许查看业务操作日志',
    tooltipEn: 'Allows viewing business operation logs',
    category: 'system',
  },
  [Permission.SYSTEM_ERROR_REPORT_READ]: {
    label: '查看错误报告',
    labelEn: 'View Error Reports',
    tooltip: '允许查看聚合错误和发生记录',
    tooltipEn: 'Allows viewing aggregated errors and occurrences',
    category: 'system',
  },
  [Permission.SYSTEM_ERROR_REPORT_UPDATE]: {
    label: '处置错误报告',
    labelEn: 'Update Error Reports',
    tooltip: '允许更新错误报告状态',
    tooltipEn: 'Allows updating error report status',
    category: 'system',
  },
  [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE]: {
    label: '管理数据归档',
    labelEn: 'Manage Data Lifecycle',
    tooltip: '允许修改保留策略、执行归档和下载归档文件',
    tooltipEn: 'Allows changing retention, running archives, and downloading archive files',
    category: 'system',
  },
  [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE]: {
    label: '危险数据维护',
    labelEn: 'Dangerous Data Maintenance',
    tooltip: '允许执行白名单表优化和归档导入',
    tooltipEn: 'Allows optimizing allowlisted tables and importing archives',
    category: 'system',
  },
  [Permission.USER_ONLINE_MONITOR_READ]: {
    label: '查看在线监控',
    labelEn: 'View Online Monitor',
    tooltip: '允许查看在线用户监控数据',
    tooltipEn: 'Allows viewing online user monitoring data',
    category: 'user_online_monitor',
  },
  [Permission.USER_ONLINE_MONITOR_FORCE_OFFLINE]: {
    label: '强制下线',
    labelEn: 'Force Offline',
    tooltip: '允许强制断开在线用户',
    tooltipEn: 'Allows forcibly disconnecting online users',
    category: 'user_online_monitor',
  },

  [Permission.API_LOG_READ]: {
    label: '查看 API 日志',
    labelEn: 'View API Logs',
    tooltip: '允许查看 API 请求日志',
    tooltipEn: 'Allows viewing API request logs',
    category: 'api_log',
  },

  [Permission.IP_BLACKLIST_CREATE]: {
    label: '添加黑名单',
    labelEn: 'Add Blacklist Entry',
    tooltip: '允许将 IP 地址加入黑名单',
    tooltipEn: 'Allows adding IP addresses to the blacklist',
    category: 'ip_blacklist',
  },
  [Permission.IP_BLACKLIST_READ]: {
    label: '查看黑名单',
    labelEn: 'View Blacklist',
    tooltip: '允许查看 IP 黑名单',
    tooltipEn: 'Allows viewing the IP blacklist',
    category: 'ip_blacklist',
  },
  [Permission.IP_BLACKLIST_UPDATE]: {
    label: '修改黑名单',
    labelEn: 'Update Blacklist Entry',
    tooltip: '允许修改黑名单条目',
    tooltipEn: 'Allows modifying blacklist entries',
    category: 'ip_blacklist',
  },
  [Permission.IP_BLACKLIST_DELETE]: {
    label: '删除黑名单',
    labelEn: 'Delete Blacklist Entry',
    tooltip: '允许从黑名单移除 IP 地址',
    tooltipEn: 'Allows removing IP addresses from the blacklist',
    category: 'ip_blacklist',
  },

  [Permission.IP_WHITELIST_CREATE]: {
    label: '添加白名单',
    labelEn: 'Add Whitelist Entry',
    tooltip: '允许将 IP 地址加入白名单',
    tooltipEn: 'Allows adding IP addresses to the whitelist',
    category: 'ip_whitelist',
  },
  [Permission.IP_WHITELIST_READ]: {
    label: '查看白名单',
    labelEn: 'View Whitelist',
    tooltip: '允许查看 IP 白名单',
    tooltipEn: 'Allows viewing the IP whitelist',
    category: 'ip_whitelist',
  },
  [Permission.IP_WHITELIST_DELETE]: {
    label: '删除白名单',
    labelEn: 'Delete Whitelist Entry',
    tooltip: '允许从白名单移除 IP 地址',
    tooltipEn: 'Allows removing IP addresses from the whitelist',
    category: 'ip_whitelist',
  },

  [Permission.RELAY_TOKEN_CREATE]: {
    label: '创建中转令牌',
    labelEn: 'Create Relay Token',
    tooltip: '允许创建中转访问令牌',
    tooltipEn: 'Allows creating relay access tokens',
    category: 'relay',
  },
  [Permission.RELAY_TOKEN_READ]: {
    label: '查看中转令牌',
    labelEn: 'View Relay Token',
    tooltip: '允许查看中转令牌详情',
    tooltipEn: 'Allows viewing relay token details',
    category: 'relay',
  },
  [Permission.RELAY_TOKEN_UPDATE]: {
    label: '修改中转令牌',
    labelEn: 'Update Relay Token',
    tooltip: '允许修改中转令牌配置',
    tooltipEn: 'Allows modifying relay token configuration',
    category: 'relay',
  },
  [Permission.RELAY_TOKEN_DELETE]: {
    label: '删除中转令牌',
    labelEn: 'Delete Relay Token',
    tooltip: '允许删除中转令牌',
    tooltipEn: 'Allows deleting relay tokens',
    category: 'relay',
  },

  [Permission.RELAY_TOKEN_CUSTOM_KEY]: {
    label: '自定义中转令牌',
    labelEn: 'Custom Relay Token Key',
    tooltip: '允许创建和更新时自定义令牌值（受速率限制）',
    tooltipEn:
      'Allows setting custom token values when creating or updating (subject to rate limits)',
    category: 'relay',
  },

  [Permission.RELAY_TOKEN_CUSTOM_KEY_FREE]: {
    label: '不受限自定义中转令牌',
    labelEn: 'Unlimited Custom Relay Token Key',
    tooltip: '允许不受限制地自定义令牌值（不受速率限制）',
    tooltipEn: 'Allows setting custom token values without any rate limits',
    category: 'relay',
  },

  [Permission.RELAY_TOKEN_MANAGE_OTHERS_READ]: {
    label: '查看他人令牌',
    labelEn: "View Others' Relay Tokens",
    tooltip: '允许查看其他用户的中转令牌（只读操作）',
    tooltipEn: 'Allows viewing relay tokens belonging to other users (read-only)',
    category: 'relay',
  },

  [Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE]: {
    label: '管理他人令牌',
    labelEn: "Manage Others' Relay Tokens",
    tooltip: '允许修改、删除、复制、刷新其他用户的中转令牌（写入操作）',
    tooltipEn:
      'Allows modifying, deleting, duplicating, and refreshing relay tokens of other users (write operations)',
    category: 'relay',
  },

  [Permission.RELAY_CHANNEL_CREATE]: {
    label: '创建中转渠道',
    labelEn: 'Create Relay Channel',
    tooltip: '允许创建新的中转渠道',
    tooltipEn: 'Allows creating new relay channels',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_READ]: {
    label: '查看中转渠道',
    labelEn: 'View Relay Channel',
    tooltip: '允许查看中转渠道详情',
    tooltipEn: 'Allows viewing relay channel details',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_SUBMIT]: {
    label: '提交中转渠道',
    labelEn: 'Submit Relay Channel',
    tooltip: '允许提交独立中转渠道供平台审核',
    tooltipEn: 'Allows submitting standalone relay channels for review',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_REVIEW]: {
    label: '审核中转渠道',
    labelEn: 'Review Relay Channels',
    tooltip: '允许审核、上架或下架渠道提交',
    tooltipEn: 'Allows reviewing, listing, and offboarding channel submissions',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_PROVIDER_READ]: {
    label: '查看渠道收益',
    labelEn: 'View Channel Earnings',
    tooltip: '允许查看自己的渠道提交和收益',
    tooltipEn: 'Allows viewing own channel submissions and earnings',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_PROVIDER_SETTLE]: {
    label: '结算渠道收益',
    labelEn: 'Settle Channel Earnings',
    tooltip: '允许将手动结算收益转入可消费余额',
    tooltipEn: 'Allows transferring manual earnings into spendable balance',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_HEALTH_READ]: {
    label: '查看渠道健康',
    labelEn: 'View Channel Health',
    tooltip: '允许查看中转渠道健康概览和详情',
    tooltipEn: 'Allows viewing relay channel health overview and details',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_POOL_METADATA_READ]: {
    label: '查看混池元数据',
    labelEn: 'View Relay Pool Metadata',
    tooltip: '允许查看混池成员、路由和定价元数据',
    tooltipEn: 'Allows viewing relay pool members, routing, and pricing metadata',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_UPDATE]: {
    label: '修改中转渠道',
    labelEn: 'Update Relay Channel',
    tooltip: '允许修改中转渠道配置',
    tooltipEn: 'Allows modifying relay channel configuration',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_DELETE]: {
    label: '删除中转渠道',
    labelEn: 'Delete Relay Channel',
    tooltip: '允许删除中转渠道',
    tooltipEn: 'Allows deleting relay channels',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_EXPORT]: {
    label: '导出中转渠道',
    labelEn: 'Export Relay Channels',
    tooltip: '允许导出包含上游密钥的中转渠道配置',
    tooltipEn: 'Allows exporting relay channel configuration including upstream keys',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_PROBE_READ]: {
    label: '查看渠道余额探针',
    labelEn: 'View Channel Balance Probes',
    tooltip: '允许查看独立渠道的余额探针配置和执行记录',
    tooltipEn: 'Allows viewing standalone channel probe profiles and runs',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_PROBE_EXECUTE]: {
    label: '执行渠道余额探针',
    labelEn: 'Execute Channel Balance Probes',
    tooltip: '允许配置凭据和执行独立渠道余额探针',
    tooltipEn: 'Allows configuring credentials and executing standalone channel probes',
    category: 'relay',
  },
  [Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST]: {
    label: '调整渠道倍率',
    labelEn: 'Adjust Channel Multipliers',
    tooltip: '允许应用余额探针计算的渠道价格倍率',
    tooltipEn: 'Allows applying channel price multipliers calculated by probes',
    category: 'relay',
  },
  [Permission.RELAY_REQUEST_DIAGNOSTICS_READ]: {
    label: '查看请求诊断',
    labelEn: 'View Request Diagnostics',
    tooltip: '允许查看中转请求诊断记录',
    tooltipEn: 'Allows viewing relay request diagnostics',
    category: 'relay',
  },
  [Permission.RELAY_REQUEST_ROUTE_TRACE_READ]: {
    label: '查看请求路由追踪',
    labelEn: 'View Request Route Trace',
    tooltip: '允许查看请求实际执行渠道和重试路径，仍需混池元数据权限',
    tooltipEn:
      'Allows viewing execution channels and retry paths; pool metadata access is also required',
    category: 'relay',
  },

  [Permission.ACCESSKEY_CREATE]: {
    label: '创建 AccessKey',
    labelEn: 'Create AccessKey',
    tooltip: '允许创建 API 访问密钥',
    tooltipEn: 'Allows creating API access keys',
    category: 'accesskey',
  },
  [Permission.ACCESSKEY_READ]: {
    label: '查看 AccessKey',
    labelEn: 'View AccessKey',
    tooltip: '允许查看访问密钥详情',
    tooltipEn: 'Allows viewing access key details',
    category: 'accesskey',
  },
  [Permission.ACCESSKEY_DELETE]: {
    label: '删除 AccessKey',
    labelEn: 'Delete AccessKey',
    tooltip: '允许删除 API 访问密钥',
    tooltipEn: 'Allows deleting API access keys',
    category: 'accesskey',
  },

  [Permission.OAUTH_CLIENT_CREATE]: {
    label: '创建 OAuth 应用',
    labelEn: 'Create OAuth App',
    tooltip: '允许创建 OAuth 应用注册',
    tooltipEn: 'Allows creating OAuth application registrations',
    category: 'oauth',
  },
  [Permission.OAUTH_CLIENT_READ]: {
    label: '查看 OAuth 应用',
    labelEn: 'View OAuth App',
    tooltip: '允许查看 OAuth 应用详情',
    tooltipEn: 'Allows viewing OAuth application details',
    category: 'oauth',
  },
  [Permission.OAUTH_CLIENT_UPDATE]: {
    label: '修改 OAuth 应用',
    labelEn: 'Update OAuth App',
    tooltip: '允许修改 OAuth 应用配置',
    tooltipEn: 'Allows modifying OAuth application configuration',
    category: 'oauth',
  },
  [Permission.OAUTH_CLIENT_DELETE]: {
    label: '删除 OAuth 应用',
    labelEn: 'Delete OAuth App',
    tooltip: '允许删除 OAuth 应用注册',
    tooltipEn: 'Allows deleting OAuth application registrations',
    category: 'oauth',
  },
  [Permission.OAUTH_CLIENT_REVIEW_READ]: {
    label: '审核 OAuth 应用',
    labelEn: 'Review OAuth Apps',
    tooltip: '允许查看待审核的 OAuth 应用',
    tooltipEn: 'Allows viewing pending OAuth application reviews',
    category: 'oauth',
  },
  [Permission.OAUTH_CLIENT_REVIEW_UPDATE]: {
    label: '审批 OAuth 应用',
    labelEn: 'Approve OAuth App',
    tooltip: '允许批准或驳回 OAuth 应用',
    tooltipEn: 'Allows approving or rejecting OAuth applications',
    category: 'oauth',
  },

  [Permission.AUTH_CENTER_CLIENT_CREATE]: {
    label: '创建 Auth Center 应用',
    labelEn: 'Create Auth Center App',
    tooltip: '允许创建 Auth Center 客户端应用',
    tooltipEn: 'Allows creating Auth Center client applications',
    category: 'auth_center',
  },
  [Permission.AUTH_CENTER_CLIENT_READ]: {
    label: '查看 Auth Center 应用',
    labelEn: 'View Auth Center App',
    tooltip: '允许查看 Auth Center 客户端详情',
    tooltipEn: 'Allows viewing Auth Center client details',
    category: 'auth_center',
  },
  [Permission.AUTH_CENTER_CLIENT_UPDATE]: {
    label: '修改 Auth Center 应用',
    labelEn: 'Update Auth Center App',
    tooltip: '允许修改 Auth Center 客户端配置',
    tooltipEn: 'Allows modifying Auth Center client configuration',
    category: 'auth_center',
  },
  [Permission.AUTH_CENTER_CLIENT_DELETE]: {
    label: '删除 Auth Center 应用',
    labelEn: 'Delete Auth Center App',
    tooltip: '允许删除 Auth Center 客户端应用',
    tooltipEn: 'Allows deleting Auth Center client applications',
    category: 'auth_center',
  },
  [Permission.AUTH_CENTER_CLIENT_REVIEW_READ]: {
    label: '审核 Auth Center 应用',
    labelEn: 'Review Auth Center Apps',
    tooltip: '允许查看待审核的 Auth Center 应用',
    tooltipEn: 'Allows viewing pending Auth Center application reviews',
    category: 'auth_center',
  },
  [Permission.AUTH_CENTER_CLIENT_REVIEW_UPDATE]: {
    label: '审批 Auth Center 应用',
    labelEn: 'Approve Auth Center App',
    tooltip: '允许批准或驳回 Auth Center 应用',
    tooltipEn: 'Allows approving or rejecting Auth Center applications',
    category: 'auth_center',
  },

  [Permission.REDEMPTION_CODE_CREATE]: {
    label: '创建兑换码',
    labelEn: 'Create Redemption Code',
    tooltip: '允许创建新的兑换码',
    tooltipEn: 'Allows creating new redemption codes',
    category: 'redemption',
  },
  [Permission.REDEMPTION_CODE_READ]: {
    label: '查看兑换码',
    labelEn: 'View Redemption Code',
    tooltip: '允许查看兑换码详情',
    tooltipEn: 'Allows viewing redemption code details',
    category: 'redemption',
  },
  [Permission.REDEMPTION_CODE_DELETE]: {
    label: '删除兑换码',
    labelEn: 'Delete Redemption Code',
    tooltip: '允许删除兑换码',
    tooltipEn: 'Allows deleting redemption codes',
    category: 'redemption',
  },

  [Permission.BALANCE_READ]: {
    label: '查看余额',
    labelEn: 'View Balance',
    tooltip: '允许查看账户余额信息',
    tooltipEn: 'Allows viewing account balance information',
    category: 'balance',
  },
  [Permission.BALANCE_RECHARGE]: {
    label: '充值余额',
    labelEn: 'Recharge Balance',
    tooltip: '允许充值账户余额',
    tooltipEn: 'Allows recharging account balance',
    category: 'balance',
  },
  [Permission.DEVELOPER_QUOTA_MANAGE]: {
    label: '管理开发者额度',
    labelEn: 'Manage Developer Quotas',
    tooltip: '允许为用户或项目配置开发者服务的每日免费额度',
    tooltipEn: 'Allows configuring daily free quotas for developer services by user or project',
    category: 'developer',
  },
  [Permission.DEVELOPER_PRODUCT_CATALOG_MANAGE]: {
    label: '管理产品目录',
    labelEn: 'Manage Product Catalog',
    tooltip: '允许管理开发者产品目录',
    tooltipEn: 'Allows managing the developer product catalog',
    category: 'developer',
  },
  [Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE]: {
    label: '管理产品运营',
    labelEn: 'Manage Product Operations',
    tooltip: '允许查看产品账号、用量、调用审计及执行运营操作',
    tooltipEn: 'Allows viewing product accounts, usage, call audits, and operational controls',
    category: 'developer',
  },
  [Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE]: {
    label: '配置产品',
    labelEn: 'Configure Products',
    tooltip: '允许配置开发者产品价格、限制和供应商',
    tooltipEn: 'Allows configuring developer product pricing, limits, and providers',
    category: 'developer',
  },
  [Permission.PRODUCT_KV_READ]: {
    label: '读取 KV',
    labelEn: 'Read KV',
    tooltip: '允许读取 KV 产品数据',
    tooltipEn: 'Allows reading KV product data',
    category: 'product',
  },
  [Permission.PRODUCT_KV_WRITE]: {
    label: '写入 KV',
    labelEn: 'Write KV',
    tooltip: '允许写入或删除 KV 产品数据',
    tooltipEn: 'Allows writing or deleting KV product data',
    category: 'product',
  },
  [Permission.PRODUCT_KV_MANAGE]: {
    label: '管理 KV',
    labelEn: 'Manage KV',
    tooltip: '允许管理 KV 产品实例与密钥',
    tooltipEn: 'Allows managing KV instances and keys',
    category: 'product',
  },
  [Permission.PRODUCT_SHORT_LINK_READ]: {
    label: '查看短链接',
    labelEn: 'Read Short Links',
    tooltip: '允许查看短链接与统计',
    tooltipEn: 'Allows viewing short links and statistics',
    category: 'product',
  },
  [Permission.PRODUCT_SHORT_LINK_WRITE]: {
    label: '编辑短链接',
    labelEn: 'Write Short Links',
    tooltip: '允许创建和修改短链接',
    tooltipEn: 'Allows creating and editing short links',
    category: 'product',
  },
  [Permission.PRODUCT_SHORT_LINK_MANAGE]: {
    label: '管理短链接',
    labelEn: 'Manage Short Links',
    tooltip: '允许管理短链接产品实例与密钥',
    tooltipEn: 'Allows managing short link instances and keys',
    category: 'product',
  },
  [Permission.PRODUCT_SECRET_READ]: {
    label: '查看密钥元数据',
    labelEn: 'Read Secret Metadata',
    tooltip: '允许查看密钥别名和状态',
    tooltipEn: 'Allows viewing secret aliases and status',
    category: 'product',
  },
  [Permission.PRODUCT_SECRET_WRITE]: {
    label: '写入密钥',
    labelEn: 'Write Secrets',
    tooltip: '允许写入或删除托管密钥',
    tooltipEn: 'Allows writing or deleting managed secrets',
    category: 'product',
  },
  [Permission.PRODUCT_SECRET_USE]: {
    label: '使用密钥',
    labelEn: 'Use Secrets',
    tooltip: '允许在受控出站请求中使用托管密钥',
    tooltipEn: 'Allows using secrets in controlled outbound requests',
    category: 'product',
  },
  [Permission.PRODUCT_SECRET_MANAGE]: {
    label: '管理密钥托管',
    labelEn: 'Manage Secret Vault',
    tooltip: '允许管理密钥托管实例与密钥',
    tooltipEn: 'Allows managing secret vault instances and keys',
    category: 'product',
  },
  [Permission.PRODUCT_STATUS_READ]: {
    label: '查看状态监控',
    labelEn: 'Read Status Monitoring',
    tooltip: '允许查看监控目标和检查记录',
    tooltipEn: 'Allows viewing monitors and check history',
    category: 'product',
  },
  [Permission.PRODUCT_STATUS_WRITE]: {
    label: '编辑状态监控',
    labelEn: 'Write Status Monitoring',
    tooltip: '允许管理监控目标',
    tooltipEn: 'Allows managing monitoring targets',
    category: 'product',
  },
  [Permission.PRODUCT_STATUS_PUBLISH]: {
    label: '发布状态页',
    labelEn: 'Publish Status Page',
    tooltip: '允许发布公开状态页',
    tooltipEn: 'Allows publishing a public status page',
    category: 'product',
  },
  [Permission.PRODUCT_STATUS_MANAGE]: {
    label: '管理状态监控',
    labelEn: 'Manage Status Monitoring',
    tooltip: '允许管理状态监控实例与密钥',
    tooltipEn: 'Allows managing status monitoring instances and keys',
    category: 'product',
  },
  [Permission.PRODUCT_VERIFICATION_SEND]: {
    label: '发送验证码',
    labelEn: 'Send Verification Codes',
    tooltip: '允许调用验证码发送 API',
    tooltipEn: 'Allows calling the verification send API',
    category: 'product',
  },
  [Permission.PRODUCT_VERIFICATION_VERIFY]: {
    label: '校验验证码',
    labelEn: 'Verify Codes',
    tooltip: '允许调用验证码校验 API',
    tooltipEn: 'Allows calling the verification API',
    category: 'product',
  },
  [Permission.PRODUCT_VERIFICATION_MANAGE]: {
    label: '管理验证码产品',
    labelEn: 'Manage Verification Product',
    tooltip: '允许管理验证码实例与密钥',
    tooltipEn: 'Allows managing verification instances and keys',
    category: 'product',
  },
  [Permission.PRODUCT_IP_GEOLOCATION_LOOKUP]: {
    label: '查询 IP 定位',
    labelEn: 'Lookup IP Geolocation',
    tooltip: '允许调用 IP 定位 API',
    tooltipEn: 'Allows calling the IP geolocation API',
    category: 'product',
  },
  [Permission.PRODUCT_IP_GEOLOCATION_MANAGE]: {
    label: '管理 IP 定位产品',
    labelEn: 'Manage IP Geolocation Product',
    tooltip: '允许管理 IP 定位实例与密钥',
    tooltipEn: 'Allows managing IP geolocation instances and keys',
    category: 'product',
  },
  [Permission.PRODUCT_PUSH_SEND]: {
    label: '发送推送',
    labelEn: 'Send Push',
    tooltip: '允许调用推送 API',
    tooltipEn: 'Allows calling the push API',
    category: 'product',
  },
  [Permission.PRODUCT_PUSH_CHANNEL_MANAGE]: {
    label: '管理推送渠道',
    labelEn: 'Manage Push Channels',
    tooltip: '允许管理推送渠道',
    tooltipEn: 'Allows managing push channels',
    category: 'product',
  },
  [Permission.PRODUCT_PUSH_DELIVERY_READ]: {
    label: '查看推送日志',
    labelEn: 'Read Push Deliveries',
    tooltip: '允许查看推送投递日志',
    tooltipEn: 'Allows viewing push delivery logs',
    category: 'product',
  },
  [Permission.PRODUCT_PUSH_MANAGE]: {
    label: '管理推送产品',
    labelEn: 'Manage Push Product',
    tooltip: '允许管理推送实例与密钥',
    tooltipEn: 'Allows managing push instances and keys',
    category: 'product',
  },

  [Permission.MONTHLY_PASS_TEMPLATE_READ]: {
    label: '查看月卡模板',
    labelEn: 'View Pass Template',
    tooltip: '允许查看月卡模板详情',
    tooltipEn: 'Allows viewing monthly pass template details',
    category: 'monthly_pass',
  },
  [Permission.MONTHLY_PASS_TEMPLATE_WRITE]: {
    label: '管理月卡模板',
    labelEn: 'Manage Pass Template',
    tooltip: '允许创建和修改月卡模板',
    tooltipEn: 'Allows creating and modifying monthly pass templates',
    category: 'monthly_pass',
  },
  [Permission.MONTHLY_PASS_ASSIGNMENT_READ]: {
    label: '查看月卡分配',
    labelEn: 'View Pass Assignment',
    tooltip: '允许查看月卡分配记录',
    tooltipEn: 'Allows viewing monthly pass assignment records',
    category: 'monthly_pass',
  },
  [Permission.MONTHLY_PASS_ASSIGNMENT_WRITE]: {
    label: '管理月卡分配',
    labelEn: 'Manage Pass Assignment',
    tooltip: '允许为用户分配月卡',
    tooltipEn: 'Allows assigning monthly passes to users',
    category: 'monthly_pass',
  },
  [Permission.MONTHLY_PASS_USAGE_READ]: {
    label: '查看月卡使用',
    labelEn: 'View Pass Usage',
    tooltip: '允许查看月卡使用统计',
    tooltipEn: 'Allows viewing monthly pass usage statistics',
    category: 'monthly_pass',
  },

  [Permission.TICKET_SUBMIT]: {
    label: '提交工单',
    labelEn: 'Submit Ticket',
    tooltip: '允许提交新的工单',
    tooltipEn: 'Allows submitting new tickets',
    category: 'ticket',
  },
  [Permission.TICKET_SELF_READ]: {
    label: '查看自己的工单',
    labelEn: 'View Own Tickets',
    tooltip: '允许查看自己提交的工单',
    tooltipEn: 'Allows viewing own submitted tickets',
    category: 'ticket',
  },
  [Permission.TICKET_SELF_UPDATE]: {
    label: '更新自己的工单',
    labelEn: 'Update Own Ticket',
    tooltip: '允许更新自己提交的工单',
    tooltipEn: 'Allows updating own submitted tickets',
    category: 'ticket',
  },
  [Permission.TICKET_COMMENT]: {
    label: '评论工单',
    labelEn: 'Comment on Tickets',
    tooltip: '允许对工单条目进行评论',
    tooltipEn: 'Allows commenting on ticket entries',
    category: 'ticket',
  },
  [Permission.TICKET_REVIEW_READ]: {
    label: '审核工单',
    labelEn: 'Review Tickets',
    tooltip: '允许查看所有工单条目进行审核',
    tooltipEn: 'Allows viewing all ticket entries for review',
    category: 'ticket',
  },
  [Permission.TICKET_REVIEW_UPDATE]: {
    label: '处理工单',
    labelEn: 'Process Tickets',
    tooltip: '允许更新工单审核状态',
    tooltipEn: 'Allows updating ticket review status',
    category: 'ticket',
  },

  [Permission.MODEL_PRICING_READ]: {
    label: '查看模型定价',
    labelEn: 'View Model Pricing',
    tooltip: '允许查看 AI 模型定价信息',
    tooltipEn: 'Allows viewing AI model pricing information',
    category: 'model',
  },
  [Permission.MODEL_PRICING_UPDATE]: {
    label: '修改模型定价',
    labelEn: 'Update Model Pricing',
    tooltip: '允许修改 AI 模型定价',
    tooltipEn: 'Allows modifying AI model pricing',
    category: 'model',
  },

  [Permission.UPSTREAM_STATUS_READ]: {
    label: '查看上游状态',
    labelEn: 'View Upstream Status',
    tooltip: '允许查看上游服务状态',
    tooltipEn: 'Allows viewing upstream service status',
    category: 'upstream',
  },

  [Permission.REMOTE_TERMINAL_DEVICE_READ]: {
    label: '查看设备',
    labelEn: 'View Device',
    tooltip: '允许查看已注册的远程终端设备',
    tooltipEn: 'Allows viewing registered remote terminal devices',
    category: 'remote_terminal',
  },
  [Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ]: {
    label: '查看设备管理',
    labelEn: 'View Device Manage',
    tooltip: '允许查看设备管理信息',
    tooltipEn: 'Allows viewing device management information',
    category: 'remote_terminal',
  },
  [Permission.REMOTE_TERMINAL_DEVICE_WRITE]: {
    label: '管理设备',
    labelEn: 'Manage Device',
    tooltip: '允许添加、更新和删除远程终端设备',
    tooltipEn: 'Allows adding, updating, and removing remote terminal devices',
    category: 'remote_terminal',
  },
  [Permission.REMOTE_TERMINAL_SESSION_CREATE]: {
    label: '创建终端会话',
    labelEn: 'Create Terminal Session',
    tooltip: '允许创建新的远程终端会话',
    tooltipEn: 'Allows creating new remote terminal sessions',
    category: 'remote_terminal',
  },
  [Permission.REMOTE_TERMINAL_SESSION_READ]: {
    label: '查看终端会话',
    labelEn: 'View Terminal Sessions',
    tooltip: '允许查看远程终端会话',
    tooltipEn: 'Allows viewing remote terminal sessions',
    category: 'remote_terminal',
  },
  [Permission.REMOTE_TERMINAL_PRODUCT_READ]: {
    label: '查看终端产品',
    labelEn: 'View Terminal Product',
    tooltip: '允许查看远程终端产品详情',
    tooltipEn: 'Allows viewing remote terminal product details',
    category: 'remote_terminal',
  },
  [Permission.REMOTE_TERMINAL_PRODUCT_WRITE]: {
    label: '管理终端产品',
    labelEn: 'Manage Terminal Product',
    tooltip: '允许创建和修改终端产品配置',
    tooltipEn: 'Allows creating and modifying terminal product configurations',
    category: 'remote_terminal',
  },
  [Permission.REMOTE_TERMINAL_ASSIGNMENT_READ]: {
    label: '查看终端分配',
    labelEn: 'View Terminal Assignment',
    tooltip: '允许查看终端产品分配记录',
    tooltipEn: 'Allows viewing terminal product assignment records',
    category: 'remote_terminal',
  },
  [Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE]: {
    label: '管理终端分配',
    labelEn: 'Manage Terminal Assignment',
    tooltip: '允许将终端产品分配给用户',
    tooltipEn: 'Allows assigning terminal products to users',
    category: 'remote_terminal',
  },
  [Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_READ]: {
    label: '查看注册令牌',
    labelEn: 'View Reg. Token',
    tooltip: '允许查看设备注册令牌',
    tooltipEn: 'Allows viewing device registration tokens',
    category: 'remote_terminal',
  },
  [Permission.REMOTE_TERMINAL_REGISTRATION_TOKEN_WRITE]: {
    label: '管理注册令牌',
    labelEn: 'Manage Reg. Token',
    tooltip: '允许创建和撤销设备注册令牌',
    tooltipEn: 'Allows creating and revoking device registration tokens',
    category: 'remote_terminal',
  },

  [Permission.OJ_APIKEY_CREATE]: {
    label: '创建 API 密钥',
    labelEn: 'Create API Key',
    tooltip: '允许创建 OJ API 密钥',
    tooltipEn: 'Allows creating OJ API keys',
    category: 'oj',
  },
  [Permission.OJ_APIKEY_READ]: {
    label: '查看 API 密钥',
    labelEn: 'View API Key',
    tooltip: '允许查看 OJ API 密钥详情',
    tooltipEn: 'Allows viewing OJ API key details',
    category: 'oj',
  },
  [Permission.OJ_APIKEY_DELETE]: {
    label: '删除 API 密钥',
    labelEn: 'Delete API Key',
    tooltip: '允许删除 OJ API 密钥',
    tooltipEn: 'Allows deleting OJ API keys',
    category: 'oj',
  },
  [Permission.OJ_APIKEY_UPDATE]: {
    label: '修改 API 密钥',
    labelEn: 'Update API Key',
    tooltip: '允许修改 OJ API 密钥配置',
    tooltipEn: 'Allows modifying OJ API key configuration',
    category: 'oj',
  },
  [Permission.OJ_USAGE_READ]: {
    label: '查看 OJ 用量',
    labelEn: 'View OJ Usage',
    tooltip: '允许查看 OJ 提交用量统计',
    tooltipEn: 'Allows viewing OJ submission usage statistics',
    category: 'oj',
  },
  [Permission.OJ_PRICING_READ]: {
    label: '查看 OJ 定价',
    labelEn: 'View OJ Pricing',
    tooltip: '允许查看 OJ 服务定价',
    tooltipEn: 'Allows viewing OJ service pricing',
    category: 'oj',
  },
  [Permission.OJ_PRICING_UPDATE]: {
    label: '修改 OJ 定价',
    labelEn: 'Update OJ Pricing',
    tooltip: '允许修改 OJ 服务定价',
    tooltipEn: 'Allows modifying OJ service pricing',
    category: 'oj',
  },

  [Permission.JSON_ENDPOINT_CREATE]: {
    label: '创建 JSON 端点',
    labelEn: 'Create JSON Endpoint',
    tooltip: '允许创建新的 JSON 端点',
    tooltipEn: 'Allows creating new JSON endpoints',
    category: 'json_endpoint',
  },
  [Permission.JSON_ENDPOINT_READ]: {
    label: '查看 JSON 端点',
    labelEn: 'View JSON Endpoint',
    tooltip: '允许查看 JSON 端点详情',
    tooltipEn: 'Allows viewing JSON endpoint details',
    category: 'json_endpoint',
  },
  [Permission.JSON_ENDPOINT_UPDATE]: {
    label: '修改 JSON 端点',
    labelEn: 'Update JSON Endpoint',
    tooltip: '允许修改 JSON 端点配置',
    tooltipEn: 'Allows modifying JSON endpoint configuration',
    category: 'json_endpoint',
  },
  [Permission.JSON_ENDPOINT_DELETE]: {
    label: '删除 JSON 端点',
    labelEn: 'Delete JSON Endpoint',
    tooltip: '允许删除 JSON 端点',
    tooltipEn: 'Allows deleting JSON endpoints',
    category: 'json_endpoint',
  },
  [Permission.JSON_ENDPOINT_ROOT_SLUG]: {
    label: '管理 JSON 根 Slug',
    labelEn: 'Manage JSON Root Slugs',
    tooltip: '允许将 JSON 端点发布到全局根路径',
    tooltipEn: 'Allows publishing JSON endpoints on the global root path',
    category: 'json_endpoint',
  },
  [Permission.JSON_ENDPOINT_MANAGE]: {
    label: '代管 JSON 端点',
    labelEn: 'Manage All JSON Endpoints',
    tooltip: '允许管理其他用户的 JSON 端点并代为创建',
    tooltipEn: 'Allows managing and creating JSON endpoints for other users',
    category: 'json_endpoint',
  },

  [Permission.ARTICLE_CREATE]: {
    label: '创建文章',
    labelEn: 'Create Article',
    tooltip: '允许创建新的文章',
    tooltipEn: 'Allows creating new articles',
    category: 'article',
  },
  [Permission.ARTICLE_READ]: {
    label: '查看文章',
    labelEn: 'View Article',
    tooltip: '允许查看文章详情和列表',
    tooltipEn: 'Allows viewing article details and lists',
    category: 'article',
  },
  [Permission.ARTICLE_UPDATE]: {
    label: '修改文章',
    labelEn: 'Update Article',
    tooltip: '允许修改文章内容',
    tooltipEn: 'Allows modifying article content',
    category: 'article',
  },
  [Permission.ARTICLE_DELETE]: {
    label: '删除文章',
    labelEn: 'Delete Article',
    tooltip: '允许删除文章',
    tooltipEn: 'Allows deleting articles',
    category: 'article',
  },
  [Permission.ARTICLE_PUBLISH]: {
    label: '发布文章',
    labelEn: 'Publish Article',
    tooltip: '允许发布或下架文章',
    tooltipEn: 'Allows publishing or unpublishing articles',
    category: 'article',
  },

  [Permission.LEGAL_POLICY_CREATE]: {
    label: '创建法律协议',
    labelEn: 'Create Policy',
    tooltip: '允许创建新的法律协议',
    tooltipEn: 'Allows creating new legal policies',
    category: 'legal_policy',
  },
  [Permission.LEGAL_POLICY_READ]: {
    label: '查看法律协议',
    labelEn: 'View Policy',
    tooltip: '允许查看法律协议详情',
    tooltipEn: 'Allows viewing legal policy details',
    category: 'legal_policy',
  },
  [Permission.LEGAL_POLICY_UPDATE]: {
    label: '修改法律协议',
    labelEn: 'Update Policy',
    tooltip: '允许修改法律协议内容',
    tooltipEn: 'Allows modifying legal policy content',
    category: 'legal_policy',
  },
  [Permission.LEGAL_POLICY_DELETE]: {
    label: '删除法律协议',
    labelEn: 'Delete Policy',
    tooltip: '允许删除法律协议',
    tooltipEn: 'Allows deleting legal policies',
    category: 'legal_policy',
  },
  [Permission.LEGAL_POLICY_PUBLISH]: {
    label: '发布法律协议',
    labelEn: 'Publish Policy',
    tooltip: '允许发布或下架法律协议',
    tooltipEn: 'Allows publishing or unpublishing legal policies',
    category: 'legal_policy',
  },

  [Permission.SCRIPT_CREATE]: {
    label: '创建脚本',
    labelEn: 'Create Script',
    tooltip: '允许创建新的 JavaScript 脚本',
    tooltipEn: 'Allows creating new JavaScript scripts',
    category: 'script',
  },
  [Permission.SCRIPT_READ]: {
    label: '查看脚本',
    labelEn: 'View Script',
    tooltip: '允许查看脚本详情和代码',
    tooltipEn: 'Allows viewing script details and code',
    category: 'script',
  },
  [Permission.SCRIPT_DELETE]: {
    label: '删除脚本',
    labelEn: 'Delete Script',
    tooltip: '允许删除 JavaScript 脚本',
    tooltipEn: 'Allows deleting JavaScript scripts',
    category: 'script',
  },

  [Permission.ANALYTICS_READ]: {
    label: '查看统计分析',
    labelEn: 'View Analytics',
    tooltip: '允许查看数据分析和统计报表',
    tooltipEn: 'Allows viewing analytics data and statistical reports',
    category: 'analytics',
  },
  [Permission.ANALYTICS_MANAGE]: {
    label: '管理统计分析',
    labelEn: 'Manage Analytics',
    tooltip: '允许管理数据分析配置和埋点管理',
    tooltipEn: 'Allows managing analytics configuration and tracking settings',
    category: 'analytics',
  },

  [Permission.NOTIFICATION_MANAGE]: {
    label: '管理通知',
    labelEn: 'Manage Notifications',
    tooltip: '允许管理通知渠道和通知发送配置',
    tooltipEn: 'Allows managing notification channels and delivery settings',
    category: 'notification',
  },

  [Permission.PASSKEY_MANAGE]: {
    label: '管理通行密钥',
    labelEn: 'Manage Passkeys',
    tooltip: '允许管理 WebAuthn 通行密钥和设备',
    tooltipEn: 'Allows managing WebAuthn passkeys and devices',
    category: 'passkey',
  },

  [Permission.DEBUG_ACCESS]: {
    label: '调试访问',
    labelEn: 'Debug Access',
    tooltip: '允许访问调试端点和工具',
    tooltipEn: 'Allows accessing debug endpoints and tools',
    category: 'debug',
  },
  [Permission.DEBUG_OPENAPI_READ]: {
    label: '查看 OpenAPI 文档',
    labelEn: 'View OpenAPI Spec',
    tooltip: '允许查看原始 OpenAPI 规范文档',
    tooltipEn: 'Allows viewing the raw OpenAPI specification',
    category: 'debug',
  },
}

/**
 * 获取权限所属分类的键名
 * @param permission 权限值
 * @returns 权限分类名称（首字母大写）
 */
export function getPermissionCategory(permission: Permission | string): string {
  const meta = PERMISSION_META[permission as Permission]
  if (meta) return meta.category.charAt(0).toUpperCase() + meta.category.slice(1)
  const prefix = permission.split(':')[0] ?? ''
  return prefix.charAt(0).toUpperCase() + prefix.slice(1)
}

/**
 * 获取权限的英文友好显示名称
 * 优先从 PERMISSION_META 读取，如果没有则自动生成
 * @param permission 权限值
 * @returns 权限的英文友好名称
 */
export function getPermissionDisplayName(permission: Permission | string): string {
  const meta = PERMISSION_META[permission as Permission]
  if (meta) return meta.labelEn
  const parts = permission.split(':')
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/_/g, ' '))
    .join(' ')
}

/**
 * 根据语言环境获取权限的中文或英文显示名
 */
export function getPermissionLabel(permission: Permission | string, locale?: string): string {
  const meta = PERMISSION_META[permission as Permission]
  if (!meta) return permission
  return locale === 'en' ? meta.labelEn : meta.label
}

/**
 * 根据语言环境获取权限的中文或英文描述
 */
export function getPermissionTooltip(permission: Permission | string, locale?: string): string {
  const meta = PERMISSION_META[permission as Permission]
  if (!meta) return ''
  return locale === 'en' ? meta.tooltipEn : meta.tooltip
}

/**
 * Permission value → enum key 的反向映射表
 * 用于根据权限值（如 "user:create"）查找枚举 key（如 "USER_CREATE"）
 */
export const PERMISSION_KEY_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(Permission).map(([key, value]) => [value, key]),
)
