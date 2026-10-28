// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import StorageKey from '@/constant/storagekey'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { setCurrentStorageScopeForUserId } from '@/utils/storageScope'

const { permissionServiceMock } = vi.hoisted(() => ({
  permissionServiceMock: {
    getAllPermissions: vi.fn(),
    getUserPermissions: vi.fn(),
  },
}))

vi.mock('@/service/permissionService', () => ({ permissionService: permissionServiceMock }))

import { usePermissionStore } from '@/stores/permissionStore'

describe('permissionStore', () => {
  beforeAll(() => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size
      },
    }
    vi.stubGlobal('window', { localStorage: storage })
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    TypedLocalStorage.clear()
  })

  it('does not initiate guest-session network work', async () => {
    const store = usePermissionStore()
    await store.loadCurrentUserPermissions()

    expect(permissionServiceMock.getAllPermissions).not.toHaveBeenCalled()
    expect(permissionServiceMock.getUserPermissions).not.toHaveBeenCalled()
    expect(store.currentUserPermissions).toBeNull()
  })

  it('restores only the current user scoped permission cache', () => {
    const cacheKey = `${StorageKey.Permission.CURRENT_USER}::user:user-a`
    TypedLocalStorage.set(cacheKey, {
      version: 2,
      permissions: [{ id: 'permission-a', name: 'user:read', category: 'user' }],
      currentUserPermissions: {
        userId: 'user-a',
        groupPermissions: [],
        additionalPermissions: [],
        removedPermissions: [],
        effectivePermissions: ['user:read'],
      },
      userUpdatedAt: '2026-08-14T00:00:00.000Z',
    })
    setCurrentStorageScopeForUserId('user-b')
    const store = usePermissionStore()

    expect(store.restoreCurrentUserPermissionsCache('user-b', '2026-08-14T00:00:00.000Z')).toBe(
      false,
    )
    expect(store.currentUserPermissions).toBeNull()
    expect(store.restoreCurrentUserPermissionsCache('user-a', '2026-08-14T00:00:00.000Z')).toBe(
      true,
    )
    expect(store.effectivePermissions).toEqual(['user:read'])
  })

  it('invalidates a cached permission projection when the user version changes', () => {
    const cacheKey = `${StorageKey.Permission.CURRENT_USER}::user:user-a`
    TypedLocalStorage.set(cacheKey, {
      version: 2,
      permissions: [],
      currentUserPermissions: {
        userId: 'user-a',
        groupPermissions: [],
        additionalPermissions: [],
        removedPermissions: [],
        effectivePermissions: [],
      },
      userUpdatedAt: '2026-08-14T00:00:00.000Z',
    })
    const store = usePermissionStore()

    expect(store.restoreCurrentUserPermissionsCache('user-a', '2026-08-14T00:00:01.000Z')).toBe(
      false,
    )
  })

  it('uses scoped IAM hints only for UI admission, not the effective grant list', () => {
    const store = usePermissionStore()
    store.applyCurrentUserPermissions('user-a', {
      userId: 'user-a',
      groupPermissions: [],
      additionalPermissions: [],
      removedPermissions: [],
      effectivePermissions: [],
      uiPermissions: ['ram:user:read'],
    })
    expect(store.hasPermission('ram:user:read')).toBe(true)
    expect(store.hasAnyPermission('ram:role:read', 'ram:user:read')).toBe(true)
    expect(store.hasAllPermissions('ram:user:read', 'ram:role:read')).toBe(false)
    expect(store.hasPermission('ram:user:delete')).toBe(false)
    expect(store.effectivePermissions).toEqual([])
    store.clearCurrentUserPermissions()
    expect(store.hasPermission('ram:user:read')).toBe(false)
  })

  it('preserves an explicitly empty UI hint list and falls back only for older API responses', () => {
    const store = usePermissionStore()
    const permissions = {
      userId: 'user-a',
      groupPermissions: [],
      additionalPermissions: [],
      removedPermissions: [],
      effectivePermissions: ['ram:user:read' as const],
    }
    store.applyCurrentUserPermissions('user-a', { ...permissions, uiPermissions: [] })
    expect(store.hasPermission('ram:user:read')).toBe(false)
    store.applyCurrentUserPermissions('user-a', permissions)
    expect(store.hasPermission('ram:user:read')).toBe(true)
  })

  it('invalidates permission caches from before the UI projection contract', () => {
    TypedLocalStorage.set(`${StorageKey.Permission.CURRENT_USER}::user:user-a`, {
      permissions: [],
      userUpdatedAt: 'v1',
      currentUserPermissions: { userId: 'user-a', effectivePermissions: [] },
    })
    expect(usePermissionStore().restoreCurrentUserPermissionsCache('user-a', 'v1')).toBe(false)
  })

  it('round trips scoped UI hints through the versioned user cache', () => {
    const store = usePermissionStore()
    store.applyCurrentUserPermissions('user-a', {
      userId: 'user-a',
      groupPermissions: [],
      additionalPermissions: [],
      removedPermissions: [],
      effectivePermissions: [],
      uiPermissions: ['ram:user:read'],
    })
    store.saveCurrentUserPermissionsCache('user-a', 'v1')
    store.clearCurrentUserPermissions()
    expect(store.restoreCurrentUserPermissionsCache('user-a', 'v1')).toBe(true)
    expect(store.hasPermission('ram:user:read')).toBe(true)
    expect(store.effectivePermissions).toEqual([])
  })
})
