import { describe, expect, it } from 'vitest'
import { Permission } from '@/constant/permission'
import {
  buildGrantablePermissionTree,
  filterGrantablePermissions,
} from '@/views/management/ram-permission-tree'

const translateCategory = (key: string) => key

describe('ram permission tree security filtering', () => {
  it('only includes permissions in the effective permission set', () => {
    const tree = buildGrantablePermissionTree({
      allPermissions: [Permission.USER_READ, Permission.USER_DELETE, Permission.RAM_POLICY_CREATE],
      effectivePermissions: [Permission.USER_READ, Permission.RAM_POLICY_CREATE],
      locale: 'en',
      translateCategory,
    })

    const values = tree.flatMap((node) => node.children?.map((child) => child.value) ?? [])
    expect(values).toEqual(expect.arrayContaining([Permission.USER_READ, Permission.RAM_POLICY_CREATE]))
    expect(values).not.toContain(Permission.USER_DELETE)
  })

  it('returns an empty tree when no permissions are grantable', () => {
    const tree = buildGrantablePermissionTree({
      allPermissions: [Permission.USER_READ],
      effectivePermissions: [],
      locale: 'en',
      translateCategory,
    })

    expect(tree).toEqual([])
  })

  it('omits empty categories after filtering non-grantable permissions', () => {
    const tree = buildGrantablePermissionTree({
      allPermissions: [Permission.USER_READ, Permission.SYSTEM_CONFIG],
      effectivePermissions: [Permission.USER_READ],
      locale: 'en',
      translateCategory,
    })

    expect(tree).toHaveLength(1)
    expect(tree[0]?.children?.map((child) => child.value)).toEqual([Permission.USER_READ])
  })

  it('maps title-cased metadata categories to their own translation keys', () => {
    const tree = buildGrantablePermissionTree({
      allPermissions: [
        Permission.USER_READ,
        Permission.RAM_POLICY_CREATE,
        Permission.PRODUCT_KV_READ,
        Permission.REMOTE_TERMINAL_DEVICE_READ,
      ],
      effectivePermissions: [
        Permission.USER_READ,
        Permission.RAM_POLICY_CREATE,
        Permission.PRODUCT_KV_READ,
        Permission.REMOTE_TERMINAL_DEVICE_READ,
      ],
      locale: 'en',
      translateCategory,
    })

    expect(tree.map((node) => node.label)).toEqual(
      expect.arrayContaining([
        'RamManagement.permissionCategoryLabels.user',
        'RamManagement.permissionCategoryLabels.ram',
        'RamManagement.permissionCategoryLabels.product',
        'RamManagement.permissionCategoryLabels.remote_terminal',
      ]),
    )
  })

  it('filters policy form permissions before submission', () => {
    const filtered = filterGrantablePermissions(
      [Permission.USER_READ, Permission.USER_DELETE, Permission.RAM_POLICY_CREATE],
      [Permission.USER_READ, Permission.RAM_POLICY_CREATE],
    )

    expect(filtered).toEqual([Permission.USER_READ, Permission.RAM_POLICY_CREATE])
  })
})
