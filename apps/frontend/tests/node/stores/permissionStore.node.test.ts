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
      permissions: [{ id: 'permission-a', name: 'user:read', category: 'user' }],
      currentUserPermissions: {
        userId: 'user-a',
        groupPermissions: [],
        additionalPermissions: [],
        removedPermissions: [],
        effectivePermissions: ['user:read'],
      },
    })
    setCurrentStorageScopeForUserId('user-b')
    const store = usePermissionStore()

    expect(store.restoreCurrentUserPermissionsCache('user-b')).toBe(false)
    expect(store.currentUserPermissions).toBeNull()
    expect(store.restoreCurrentUserPermissionsCache('user-a')).toBe(true)
    expect(store.effectivePermissions).toEqual(['user:read'])
  })
})
