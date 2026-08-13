import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { permissionServiceMock } = vi.hoisted(() => ({
  permissionServiceMock: {
    getAllPermissions: vi.fn(),
    getUserPermissions: vi.fn(),
  },
}))

vi.mock('@/service/permissionService', () => ({ permissionService: permissionServiceMock }))

import { usePermissionStore } from '@/stores/permissionStore'

describe('permissionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('does not initiate guest-session network work', async () => {
    const store = usePermissionStore()
    await store.loadCurrentUserPermissions()

    expect(permissionServiceMock.getAllPermissions).not.toHaveBeenCalled()
    expect(permissionServiceMock.getUserPermissions).not.toHaveBeenCalled()
    expect(store.currentUserPermissions).toBeNull()
  })
})
