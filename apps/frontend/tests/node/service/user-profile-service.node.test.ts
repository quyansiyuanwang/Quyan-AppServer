import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'
const { requestMock } = vi.hoisted(() => ({
  requestMock: { get: vi.fn(), patch: vi.fn() },
}))
vi.mock('@/stores/request', () => ({ useRequestStore: () => ({ getAxios: () => requestMock }) }))
vi.mock('@/service/passwordEncryptionService', () => ({ passwordEncryptionService: {} }))
import { UserService } from '@/service/userService'
beforeEach(() => vi.clearAllMocks())
describe('resource-scoped personal profile client contract', () => {
  it('reads own profile through its generated endpoint without supplying a target identity', async () => {
    const data = { id: 'actor', accountOwnerId: 'owner', username: 'fixture' }
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.OK, data })
    expect(await UserService.getInstance().getMe()).toEqual(data)
    expect(requestMock.get).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'UserControllerGetCurrentUser' }),
      {},
      undefined,
    )
  })
  it('does not replace an IAM-denied personal read with a generic admin query', async () => {
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.PERMISSION_DENIED })
    await expect(UserService.getInstance().getMe()).rejects.toThrow()
    expect(requestMock.get).toHaveBeenCalledTimes(1)
    expect(requestMock.get).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'UserControllerGetCurrentUser' }),
      {},
      undefined,
    )
  })
  it('updates through the existing replay-protected generated profile operation', async () => {
    const changes = { name: 'fixture-display-name' },
      data = { id: 'actor', ...changes }
    requestMock.patch.mockResolvedValueOnce({ code: CustomCode.OK, data })
    expect(await UserService.getInstance().updateProfile(changes)).toEqual(data)
    expect(requestMock.patch).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'UserControllerUpdateProfile' }),
      { body: changes },
      undefined,
    )
    requestMock.patch.mockResolvedValueOnce({ code: CustomCode.PERMISSION_DENIED })
    await expect(UserService.getInstance().updateProfile(changes)).rejects.toThrow()
  })
})
