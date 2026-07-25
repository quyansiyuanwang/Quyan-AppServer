import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'

const { requestMock } = vi.hoisted(() => ({
  requestMock: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => requestMock,
  }),
}))

import { groupService } from '@/service/groupService'

const expectOperation = (name: string) => expect.objectContaining({ name })

describe('groupService permission operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the group domain API and normalizes the permission list response', async () => {
    requestMock.get.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: ['user:read'],
    })

    await expect(groupService.getGroupPermissions('group-1')).resolves.toEqual({
      permissions: ['user:read'],
    })
    expect(requestMock.get).toHaveBeenCalledWith(
      expectOperation('GroupControllerGetGroupPermissions'),
      { path: { groupId: 'group-1' } },
      undefined,
    )
  })

  it('saves group permissions through the group domain API', async () => {
    requestMock.put.mockResolvedValueOnce({ code: CustomCode.OK })

    await expect(groupService.setGroupPermissions('group-1', ['user:read'])).resolves.toBe(true)
    expect(requestMock.put).toHaveBeenCalledWith(
      expectOperation('GroupControllerSetGroupPermissions'),
      {
        path: { groupId: 'group-1' },
        body: { permissions: ['user:read'] },
      },
      undefined,
    )
  })
})
