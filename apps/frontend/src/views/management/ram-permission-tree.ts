import {
  ALL_PERMISSIONS,
  getPermissionCategory,
  getPermissionLabel,
  getPermissionTooltip,
} from '@/constant/permission'

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
  translateCategory: (key: string) => string
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
      const prefix = category.charAt(0).toLowerCase() + category.slice(1)
      return {
        label: translateCategory(`RamManagement.permissionCategoryLabels.${prefix}`),
        value: category,
        tooltip: translateCategory(`RamManagement.permissionCategoryTooltips.${prefix}`),
        children,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}
