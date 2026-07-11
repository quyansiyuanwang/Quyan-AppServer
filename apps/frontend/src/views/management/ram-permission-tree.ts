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
type PermissionCategoryTranslationKey =
  (typeof PERMISSION_CATEGORY_TRANSLATIONS)[PermissionCategoryKey]['label'] |
  (typeof PERMISSION_CATEGORY_TRANSLATIONS)[PermissionCategoryKey]['tooltip']

const isPermissionCategoryKey = (value: string): value is PermissionCategoryKey =>
  value in PERMISSION_CATEGORY_TRANSLATIONS

const getPermissionCategoryTranslationKey = (
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
  const grantablePermissions = new Set(effectivePermissions)
  const categories = new Map<string, PermissionTreeNode[]>()

  for (const permission of allPermissions.filter((item) => grantablePermissions.has(item))) {
    const category = getPermissionCategory(permission)
    if (!categories.has(category)) categories.set(category, [])
    categories.get(category)!.push({
      label: getPermissionLabel(permission, locale),
      value: permission,
      tooltip: getPermissionTooltip(permission, locale),
    })
  }

  return Array.from(categories.entries())
    .map(([category, children]) => {
      return {
        label: translateCategory(getPermissionCategoryTranslationKey(category, 'label')),
        value: category,
        tooltip: translateCategory(getPermissionCategoryTranslationKey(category, 'tooltip')),
        children,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}
