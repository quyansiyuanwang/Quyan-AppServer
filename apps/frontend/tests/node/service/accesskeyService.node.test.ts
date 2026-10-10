import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'
const { requestMock } = vi.hoisted(() => ({
  requestMock: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))
vi.mock('@/stores/request', () => ({ useRequestStore: () => ({ getAxios: () => requestMock }) }))
import { AccessKeyService } from '@/service/accesskeyService'
beforeEach(() => vi.clearAllMocks())
describe('AccessKey server pagination contract', () => {
  it('uses the generated operation descriptor and forwards paging as request-store params', async () => {
    const query = { page: 2, pageSize: 25 },
      data = { items: [], ...query, hasNext: true }
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.OK, data })
    expect(await AccessKeyService.getInstance().getAccessKeysPage(query)).toEqual(data)
    expect(requestMock.get).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AccessKeyControllerListAccessKeysPage' }),
      { params: query },
      undefined,
    )
  })
  it('does not fall back to a broad array request on denial or missing page data', async () => {
    requestMock.get
      .mockResolvedValueOnce({ code: CustomCode.PERMISSION_DENIED })
      .mockResolvedValueOnce({ code: CustomCode.OK })
    await expect(
      AccessKeyService.getInstance().getAccessKeysPage({ page: 1, pageSize: 50 }),
    ).rejects.toThrow()
    await expect(
      AccessKeyService.getInstance().getAccessKeysPage({ page: 1, pageSize: 50 }),
    ).rejects.toThrow()
    expect(requestMock.get).toHaveBeenCalledTimes(2)
  })
})
