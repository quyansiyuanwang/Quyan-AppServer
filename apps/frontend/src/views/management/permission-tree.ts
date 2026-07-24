import {
  ALL_PERMISSIONS,
  getPermissionCategory,
  getPermissionLabel,
  getPermissionTooltip,
} from '@/constant/permission'

const PERMISSION_CATEGORY_TRANSLATIONS = {
  user: {
    label: 'RamManagement.permissionCategoryLabels.user',
    tooltip: 'RamManagement.permissionCategoryTooltips.user',
  },
  group: {
    label: 'RamManagement.permissionCategoryLabels.group',
    tooltip: 'RamManagement.permissionCategoryTooltips.group',
  },
  permission: {
    label: 'RamManagement.permissionCategoryLabels.permission',
    tooltip: 'RamManagement.permissionCategoryTooltips.permission',
  },
  ram: {
    label: 'RamManagement.permissionCategoryLabels.ram',
    tooltip: 'RamManagement.permissionCategoryTooltips.ram',
  },
  product: {
    label: 'RamManagement.permissionCategoryLabels.product',
    tooltip: 'RamManagement.permissionCategoryTooltips.product',
  },
  system: {
    label: 'RamManagement.permissionCategoryLabels.system',
    tooltip: 'RamManagement.permissionCategoryTooltips.system',
  },
  user_online_monitor: {
    label: 'RamManagement.permissionCategoryLabels.user_online_monitor',
    tooltip: 'RamManagement.permissionCategoryTooltips.user_online_monitor',
  },
  api_log: {
    label: 'RamManagement.permissionCategoryLabels.api_log',
    tooltip: 'RamManagement.permissionCategoryTooltips.api_log',
  },
  ip_blacklist: {
    label: 'RamManagement.permissionCategoryLabels.ip_blacklist',
    tooltip: 'RamManagement.permissionCategoryTooltips.ip_blacklist',
  },
  ip_whitelist: {
    label: 'RamManagement.permissionCategoryLabels.ip_whitelist',
    tooltip: 'RamManagement.permissionCategoryTooltips.ip_whitelist',
  },
  relay: {
    label: 'RamManagement.permissionCategoryLabels.relay',
    tooltip: 'RamManagement.permissionCategoryTooltips.relay',
  },
  accesskey: {
    label: 'RamManagement.permissionCategoryLabels.accesskey',
    tooltip: 'RamManagement.permissionCategoryTooltips.accesskey',
  },
  oauth: {
    label: 'RamManagement.permissionCategoryLabels.oauth',
    tooltip: 'RamManagement.permissionCategoryTooltips.oauth',
  },
  auth_center: {
    label: 'RamManagement.permissionCategoryLabels.auth_center',
    tooltip: 'RamManagement.permissionCategoryTooltips.auth_center',
  },
  redemption: {
    label: 'RamManagement.permissionCategoryLabels.redemption',
    tooltip: 'RamManagement.permissionCategoryTooltips.redemption',
  },
  balance: {
    label: 'RamManagement.permissionCategoryLabels.balance',
    tooltip: 'RamManagement.permissionCategoryTooltips.balance',
  },
  monthly_pass: {
    label: 'RamManagement.permissionCategoryLabels.monthly_pass',
    tooltip: 'RamManagement.permissionCategoryTooltips.monthly_pass',
  },
  ticket: {
    label: 'RamManagement.permissionCategoryLabels.ticket',
    tooltip: 'RamManagement.permissionCategoryTooltips.ticket',
  },
  model: {
    label: 'RamManagement.permissionCategoryLabels.model',
    tooltip: 'RamManagement.permissionCategoryTooltips.model',
  },
  upstream: {
    label: 'RamManagement.permissionCategoryLabels.upstream',
    tooltip: 'RamManagement.permissionCategoryTooltips.upstream',
  },
  remote_terminal: {
    label: 'RamManagement.permissionCategoryLabels.remote_terminal',
    tooltip: 'RamManagement.permissionCategoryTooltips.remote_terminal',
  },
  oj: {
    label: 'RamManagement.permissionCategoryLabels.oj',
    tooltip: 'RamManagement.permissionCategoryTooltips.oj',
  },
  json_endpoint: {
    label: 'RamManagement.permissionCategoryLabels.json_endpoint',
    tooltip: 'RamManagement.permissionCategoryTooltips.json_endpoint',
  },
  article: {
    label: 'RamManagement.permissionCategoryLabels.article',
    tooltip: 'RamManagement.permissionCategoryTooltips.article',
  },
  legal_policy: {
    label: 'RamManagement.permissionCategoryLabels.legal_policy',
    tooltip: 'RamManagement.permissionCategoryTooltips.legal_policy',
  },
  script: {
    label: 'RamManagement.permissionCategoryLabels.script',
    tooltip: 'RamManagement.permissionCategoryTooltips.script',
  },
  analytics: {
    label: 'RamManagement.permissionCategoryLabels.analytics',
    tooltip: 'RamManagement.permissionCategoryTooltips.analytics',
  },
  notification: {
    label: 'RamManagement.permissionCategoryLabels.notification',
    tooltip: 'RamManagement.permissionCategoryTooltips.notification',
  },
  passkey: {
    label: 'RamManagement.permissionCategoryLabels.passkey',
    tooltip: 'RamManagement.permissionCategoryTooltips.passkey',
  },
  debug: {
    label: 'RamManagement.permissionCategoryLabels.debug',
    tooltip: 'RamManagement.permissionCategoryTooltips.debug',
  },
} as const

type PermissionCategoryKey = keyof typeof PERMISSION_CATEGORY_TRANSLATIONS
export type PermissionCategoryTranslationKey =
  | (typeof PERMISSION_CATEGORY_TRANSLATIONS)[PermissionCategoryKey]['label']
  | (typeof PERMISSION_CATEGORY_TRANSLATIONS)[PermissionCategoryKey]['tooltip']

const isPermissionCategoryKey = (value: string): value is PermissionCategoryKey =>
  value in PERMISSION_CATEGORY_TRANSLATIONS

export const getPermissionCategoryTranslationKey = (
  category: string,
  kind: 'label' | 'tooltip',
): PermissionCategoryTranslationKey => {
  if (!isPermissionCategoryKey(category)) {
    return kind === 'label'
      ? PERMISSION_CATEGORY_TRANSLATIONS.user.label
      : PERMISSION_CATEGORY_TRANSLATIONS.user.tooltip
  }
  return PERMISSION_CATEGORY_TRANSLATIONS[category][kind]
}

const RESOURCE_LABELS: Record<string, Record<string, [string, string, string]>> = {
  ram: {
    user: ['RAM 用户', 'RAM Users', '👤'],
    role: ['RAM 角色', 'RAM Roles', '🎭'],
    binding: ['角色绑定', 'Role Bindings', '🔗'],
    policy: ['权限策略', 'Permission Policies', '📜'],
    session: ['角色会话', 'Role Sessions', '⏱️'],
  },
  product: {
    kv: ['KV 存储', 'KV Storage', '🗃️'],
    short_link: ['短链接', 'Short Links', '🔗'],
    secret: ['密钥托管', 'Secret Vault', '🔐'],
    status: ['状态监控', 'Status Monitoring', '📈'],
    verification: ['验证码服务', 'Verification', '🔢'],
    ip_geolocation: ['IP 定位', 'IP Geolocation', '📍'],
    push: ['推送聚合', 'Push Delivery', '🔔'],
  },
  relay: {
    token: ['中转令牌', 'Relay Tokens', '🎫'],
    channel: ['中转渠道', 'Relay Channels', '🔀'],
  },
  remote_terminal: {
    product: ['终端产品', 'Terminal Products', '🖥️'],
    assignment: ['终端分配', 'Terminal Assignments', '📦'],
    registration_token: ['注册令牌', 'Registration Tokens', '🎟️'],
    device: ['终端设备', 'Terminal Devices', '💻'],
    session: ['终端会话', 'Terminal Sessions', '⌨️'],
  },
  system: {
    stats: ['系统统计', 'System Statistics', '📊'],
    consumption: ['资源消耗', 'Resource Consumption', '📉'],
    log: ['系统日志', 'System Logs', '📜'],
    server_log: ['服务器日志', 'Server Logs', '🖥️'],
    business_log: ['业务日志', 'Business Logs', '🧾'],
  },
  monthly_pass: {
    template: ['月卡模板', 'Pass Templates', '🪪'],
    assignment: ['月卡分配', 'Pass Assignments', '📦'],
    usage: ['月卡用量', 'Pass Usage', '📊'],
  },
  ticket: {
    self: ['我的工单', 'Own Tickets', '🎫'],
    review: ['工单审核', 'Ticket Reviews', '🧐'],
  },
  developer: {
    quota: ['开发者额度', 'Developer Quotas', '📏'],
    product: ['开发者产品', 'Developer Products', '🧰'],
  },
  oj: {
    apikey: ['OJ API 密钥', 'OJ API Keys', '🔑'],
    usage: ['OJ 用量', 'OJ Usage', '📊'],
    pricing: ['OJ 定价', 'OJ Pricing', '💳'],
  },
}

const RESOURCE_GROUPED_CATEGORIES = new Set([
  'ram',
  'product',
  'relay',
  'remote_terminal',
  'system',
  'monthly_pass',
  'ticket',
  'developer',
  'oj',
])

const humanize = (value: string) =>
  value
    .split('_')
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ')

export const getPermissionCategoryId = (permission: string) =>
  getPermissionCategory(permission).toLowerCase()

export const getPermissionResourceId = (permission: string, category = getPermissionCategoryId(permission)) => {
  const [, resource] = permission.split(':')
  if (!resource) return 'general'
  if (!RESOURCE_GROUPED_CATEGORIES.has(category)) return 'general'
  if (category === 'ram' && resource === 'assume_role') return 'role'
  // Only introduce a resource level when it has a localized resource label. Actions such as
  // `ticket:submit` belong directly under their category rather than becoming an untranslated
  // intermediate node named "submit".
  return RESOURCE_LABELS[category]?.[resource] ? resource : 'general'
}

export const getPermissionResourceLabel = (category: string, resource: string, locale: string) => {
  if (resource === 'general') return ''
  const labels = RESOURCE_LABELS[category]?.[resource]
  if (!labels) return locale === 'en' ? humanize(resource) : resource.replace(/_/g, ' ')
  if (locale === 'emoji') return labels[2]
  return locale === 'en' ? labels[1] : labels[0]
}

export interface PermissionResourceGroup {
  id: string
  category: string
  resource: string
  permissions: string[]
}

export const buildPermissionResourceGroups = <T extends string>(
  permissions: readonly T[],
  effectivePermissions?: Iterable<string>,
): PermissionResourceGroup[] => {
  const effective = effectivePermissions ? new Set(effectivePermissions) : undefined
  const groups = new Map<string, PermissionResourceGroup>()

  for (const permission of permissions) {
    if (effective && !effective.has(permission)) continue
    const category = getPermissionCategoryId(permission)
    const resource = getPermissionResourceId(permission, category)
    const id = `${category}:${resource}`
    const group = groups.get(id) ?? { id, category, resource, permissions: [] }
    group.permissions.push(permission)
    groups.set(id, group)
  }

  return Array.from(groups.values()).sort((a, b) => a.id.localeCompare(b.id))
}

export interface PermissionTreeNode {
  label: string
  value: string
  tooltip: string
  children?: PermissionTreeNode[]
}

interface BuildGrantablePermissionTreeOptions {
  allPermissions?: readonly string[]
  effectivePermissions: Iterable<string>
  locale: string
  translateCategory: (key: PermissionCategoryTranslationKey) => string
}

export const filterGrantablePermissions = <T extends string>(
  permissions: readonly T[],
  effectivePermissions: Iterable<string>,
): T[] => {
  const grantablePermissions = new Set(effectivePermissions)
  return permissions.filter((permission) => grantablePermissions.has(permission))
}

export const buildGrantablePermissionTree = ({
  allPermissions = ALL_PERMISSIONS,
  effectivePermissions,
  locale,
  translateCategory,
}: BuildGrantablePermissionTreeOptions): PermissionTreeNode[] => {
  const categories = new Map<string, PermissionResourceGroup[]>()

  for (const group of buildPermissionResourceGroups(allPermissions, effectivePermissions)) {
    const categoryGroups = categories.get(group.category) ?? []
    categoryGroups.push(group)
    categories.set(group.category, categoryGroups)
  }

  return Array.from(categories.entries())
    .map(([category, groups]) => ({
      label: translateCategory(getPermissionCategoryTranslationKey(category, 'label')),
      value: `category:${category}`,
      tooltip: translateCategory(getPermissionCategoryTranslationKey(category, 'tooltip')),
      children: groups.flatMap((group) => {
        const permissions = group.permissions.map((permission) => ({
          label: getPermissionLabel(permission, locale),
          value: permission,
          tooltip: getPermissionTooltip(permission, locale),
        }))

        // A generic group has no meaningful resource label. Putting it directly below the
        // category prevents redundant nodes such as "Redemption Codes > Redemption Codes".
        if (group.resource === 'general') return permissions

        return [
          {
            label: getPermissionResourceLabel(category, group.resource, locale),
            value: `resource:${group.id}`,
            tooltip: translateCategory(getPermissionCategoryTranslationKey(category, 'tooltip')),
            children: permissions,
          },
        ]
      }),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
