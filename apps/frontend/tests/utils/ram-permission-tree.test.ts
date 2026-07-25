import { describe, expect, it } from 'vitest'
import { Permission } from '@/constant/permission'
import {
  buildGrantablePermissionTree,
  buildPermissionResourceGroups,
  filterGrantablePermissions,
} from '@/views/management/ram-permission-tree'

const translateCategory = (key: string) => key
interface TreeNode {
  value: string
  children?: TreeNode[]
}

const collectPermissionValues = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((node) => (node.children?.length ? collectPermissionValues(node.children) : [node.value]))

describe('ram permission tree security filtering', () => {
  it('only includes permissions in the effective permission set', () => {
    const tree = buildGrantablePermissionTree({
      allPermissions: [Permission.USER_READ, Permission.USER_DELETE, Permission.RAM_POLICY_CREATE],
      effectivePermissions: [Permission.USER_READ, Permission.RAM_POLICY_CREATE],
      locale: 'en',
      translateCategory,
    })

    const values = collectPermissionValues(tree)
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
    expect(collectPermissionValues(tree)).toEqual([Permission.USER_READ])
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

  it('groups RAM and developer-product permissions by their managed resource', () => {
    const groups = buildPermissionResourceGroups([
      Permission.RAM_USER_READ,
      Permission.RAM_POLICY_CREATE,
      Permission.PRODUCT_KV_READ,
      Permission.PRODUCT_PUSH_SEND,
    ])

    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'ram:user', permissions: [Permission.RAM_USER_READ] }),
        expect.objectContaining({ id: 'ram:policy', permissions: [Permission.RAM_POLICY_CREATE] }),
        expect.objectContaining({ id: 'product:kv', permissions: [Permission.PRODUCT_KV_READ] }),
        expect.objectContaining({ id: 'product:push', permissions: [Permission.PRODUCT_PUSH_SEND] }),
      ]),
    )
  })

  it('keeps unregistered action segments as translated category leaves', () => {
    const groups = buildPermissionResourceGroups([
      Permission.TICKET_SUBMIT,
      Permission.TICKET_COMMENT,
    ])

    expect(groups).toEqual([
      expect.objectContaining({
        id: 'ticket:general',
        permissions: [Permission.TICKET_SUBMIT, Permission.TICKET_COMMENT],
      }),
    ])
  })

  it('does not add a duplicate resource level for generic categories', () => {
    const tree = buildGrantablePermissionTree({
      allPermissions: [Permission.REDEMPTION_CODE_CREATE, Permission.DEBUG_ACCESS],
      effectivePermissions: [Permission.REDEMPTION_CODE_CREATE, Permission.DEBUG_ACCESS],
      locale: 'zh-CN',
      translateCategory,
    })

    const redemption = tree.find((node) => node.value === 'category:redemption')
    const debug = tree.find((node) => node.value === 'category:debug')

    expect(redemption?.children).toEqual([
      expect.objectContaining({
        value: Permission.REDEMPTION_CODE_CREATE,
        label: '创建兑换码',
      }),
    ])
    expect(debug?.children).toEqual([
      expect.objectContaining({ value: Permission.DEBUG_ACCESS, label: '调试访问' }),
    ])
  })
})
