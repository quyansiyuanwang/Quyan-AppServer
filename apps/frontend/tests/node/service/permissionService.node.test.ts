import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'
import type {
  PermissionControllerCheckPermissionsApiType,
  PermissionControllerSetGroupPermissionsApiType,
} from '@/client/api-types-map.gen'

const { requestMock, userInfoStoreMock, permissionStoreMock } = vi.hoisted(() => ({
  requestMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  userInfoStoreMock: {
    init: vi.fn(),
    userInfo: { id: 'user-1' },
  },
  permissionStoreMock: {
    untilReady: vi.fn(),
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
}))

vi.mock('@/stores/userInfoStore', () => ({
  useUserInfoStore: () => userInfoStoreMock,
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => permissionStoreMock,
}))

import { PermissionService, permissionService } from '@/service/permissionService'

const expectOperation = (name: string) => expect.objectContaining({ name })

describe('permissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userInfoStoreMock.userInfo.id = 'user-1'
  })

  it('returns a singleton instance from getInstance', () => {
    ;(PermissionService as any).instance = null

    const first = PermissionService.getInstance()
    const second = PermissionService.getInstance()

    expect(first).toBe(second)
  })

  it('gets all permissions, user permissions and group permissions', async () => {
    const allPermissions = { data: { categories: [] } }
    const userPermissions = { data: { effectivePermissions: ['user:read'] } }
    const groupPermissions = { data: { permissions: ['user:read'] } }

    requestMock.get
      .mockResolvedValueOnce(allPermissions)
      .mockResolvedValueOnce(userPermissions)
      .mockResolvedValueOnce(groupPermissions)

    await expect(permissionService.getAllPermissions()).resolves.toBe(allPermissions)
    await expect(permissionService.getUserPermissions('u2')).resolves.toBe(userPermissions)
    await expect(permissionService.getGroupPermissions('g1')).resolves.toBe(groupPermissions)

    expect(requestMock.get).toHaveBeenNthCalledWith(
      1,
      expectOperation('PermissionControllerGetAllPermissions'),
      {},
      undefined,
    )
    expect(requestMock.get).toHaveBeenNthCalledWith(
      2,
      expectOperation('PermissionControllerGetUserPermissions'),
      {
        path: { userId: 'u2' },
      },
      undefined,
    )
    expect(requestMock.get).toHaveBeenNthCalledWith(
      3,
      expectOperation('PermissionControllerGetGroupPermissions'),
      {
        path: { groupId: 'g1' },
      },
      undefined,
    )
  })

  it('setUserPermissions returns true only when code is OK', async () => {
    requestMock.put.mockResolvedValueOnce({ code: CustomCode.OK })
    requestMock.put.mockResolvedValueOnce({ code: CustomCode.INTERNAL_SERVER_ERROR })

    await expect(permissionService.setUserPermissions('u1', { permissionAdds: [] })).resolves.toBe(
      true,
    )
    await expect(permissionService.setUserPermissions('u1', { permissionAdds: [] })).resolves.toBe(
      false,
    )
  })

  it('handles add/remove/clear permission APIs by custom response code', async () => {
    requestMock.post
      .mockResolvedValueOnce({ code: CustomCode.OK })
      .mockResolvedValueOnce({ code: CustomCode.OK })
      .mockResolvedValueOnce({ code: CustomCode.INTERNAL_SERVER_ERROR })

    await expect(
      permissionService.addUserPermissions('u1', { permissions: ['user:read'] }),
    ).resolves.toBe(true)
    await expect(
      permissionService.removeUserPermissions('u1', { permissions: ['group:read'] }),
    ).resolves.toBe(true)
    await expect(permissionService.clearUserPermissions('u1')).resolves.toBe(false)

    expect(requestMock.post).toHaveBeenNthCalledWith(
      1,
      expectOperation('PermissionControllerAddUserPermissions'),
      {
        path: { userId: 'u1' },
        body: { permissions: ['user:read'] },
      },
      undefined,
    )
    expect(requestMock.post).toHaveBeenNthCalledWith(
      2,
      expectOperation('PermissionControllerRemoveUserPermissions'),
      {
        path: { userId: 'u1' },
        body: { permissions: ['group:read'] },
      },
      undefined,
    )
    expect(requestMock.post).toHaveBeenNthCalledWith(
      3,
      expectOperation('PermissionControllerClearUserPermissions'),
      {
        path: { userId: 'u1' },
      },
      undefined,
    )
  })

  it('proxies checkPermissions and setGroupPermissions', async () => {
    const checkPayload: PermissionControllerCheckPermissionsApiType['body'] = {
      userId: 'u1',
      permissions: ['user:read'],
    }
    const checkResponse = { data: { hasPermission: true } }
    const setGroupPayload: PermissionControllerSetGroupPermissionsApiType['body'] = {
      permissions: ['user:read'],
    }

    requestMock.post.mockResolvedValueOnce(checkResponse)
    requestMock.put.mockResolvedValueOnce({ code: CustomCode.OK })

    await expect(permissionService.checkPermissions(checkPayload)).resolves.toBe(checkResponse)
    await expect(permissionService.setGroupPermissions('g1', setGroupPayload)).resolves.toBe(true)

    expect(requestMock.post).toHaveBeenCalledWith(
      expectOperation('PermissionControllerCheckPermissions'),
      {
        body: checkPayload,
      },
      undefined,
    )
    expect(requestMock.put).toHaveBeenCalledWith(
      expectOperation('PermissionControllerSetGroupPermissions'),
      {
        path: { groupId: 'g1' },
        body: setGroupPayload,
      },
      undefined,
    )
  })

  it('loadCurrentUserPermissions requests by current user id', async () => {
    const response = { data: { effectivePermissions: ['user:read'] } }
    requestMock.get.mockResolvedValue(response)

    const result = await permissionService.loadCurrentUserPermissions()

    expect(userInfoStoreMock.init).toHaveBeenCalledTimes(1)
    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('PermissionControllerGetUserPermissions'),
      {
        path: { userId: 'user-1' },
      },
      undefined,
    )
    expect(result).toBe(response)
  })

  it('loadCurrentUserPermissions throws when user id is missing', async () => {
    userInfoStoreMock.userInfo.id = ''

    await expect(permissionService.loadCurrentUserPermissions()).rejects.toThrow('无法获取当前用户ID')
  })

  it('ensureLoaded delegates to permission store untilReady', async () => {
    permissionStoreMock.untilReady.mockResolvedValue(undefined)

    await permissionService.ensureLoaded()

    expect(permissionStoreMock.untilReady).toHaveBeenCalledTimes(1)
  })
})
