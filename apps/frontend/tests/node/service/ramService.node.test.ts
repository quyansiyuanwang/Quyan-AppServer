import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'
const { requestMock } = vi.hoisted(() => ({ requestMock: { post: vi.fn(), put: vi.fn() } }))
vi.mock('@/stores/request', () => ({ useRequestStore: () => ({ getAxios: () => requestMock }) }))
vi.mock('@/service/passwordEncryptionService', () => ({ passwordEncryptionService: {} }))
import { ramService } from '@/service/ramService'
const document = {
  Version: '1' as const,
  Statement: { Effect: 'Allow' as const, Action: 'alidns:DescribeDomains', Resource: '*' },
}
beforeEach(() => {
  vi.resetAllMocks()
})
describe('RAM service IAM document operations', () => {
  it('validates through the generated RAM endpoint', async () => {
    const data = { valid: true, document, documentHash: 'h1', broadWildcard: false }
    requestMock.post.mockResolvedValueOnce({ code: CustomCode.OK, data })
    await expect(ramService.validatePolicy(document)).resolves.toEqual(data)
    expect(requestMock.post).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RamControllerValidatePolicy' }),
      { body: { document } },
      undefined,
    )
  })
  it('propagates server validation failures', async () => {
    requestMock.post.mockResolvedValueOnce({
      code: CustomCode.PERMISSION_DENIED,
      message: 'Denied',
    })
    await expect(ramService.validatePolicy(document)).rejects.toThrow()
  })
  it('preserves the update concurrency hash and sends no legacy permissions', async () => {
    const payload = { document, expectedDocumentHash: 'h1' }
    requestMock.put.mockResolvedValueOnce({ code: CustomCode.OK, data: { id: 'p1', ...payload } })
    await ramService.updatePolicy('p1', payload)
    expect(requestMock.put).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RamControllerUpdatePolicy' }),
      { path: { policyId: 'p1' }, body: payload },
      undefined,
    )
  })
})
