import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { getAccessTokenMock, isTokenExpiredMock, permissionServiceMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  isTokenExpiredMock: vi.fn(),
  permissionServiceMock: {
    getAllPermissions: vi.fn(),
    getUserPermissions: vi.fn(),
  },
}))

vi.mock('@/stores/request', () => ({
  getAccessToken: getAccessTokenMock,
  isTokenExpired: isTokenExpiredMock,
}))

vi.mock('@/service/permissionService', () => ({
  permissionService: permissionServiceMock,
}))

import { usePermissionStore } from '@/stores/permissionStore'

describe('permissionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    getAccessTokenMock.mockReturnValue(null)
    isTokenExpiredMock.mockReturnValue(false)
  })

  it('does not fetch permissions for a guest session', async () => {
    const store = usePermissionStore()
    store.currentUserPermissions = {
      userId: 'stale-user',
      groupPermissions: [],
      additionalPermissions: [],
      removedPermissions: [],
      effectivePermissions: [],
    } as any

    await store.untilReady()

    expect(permissionServiceMock.getAllPermissions).not.toHaveBeenCalled()
    expect(permissionServiceMock.getUserPermissions).not.toHaveBeenCalled()
    expect(store.currentUserPermissions).toBeNull()
  })
})
