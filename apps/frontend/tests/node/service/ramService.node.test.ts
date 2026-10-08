import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'
const { requestMock } = vi.hoisted(() => ({
  requestMock: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))
vi.mock('@/stores/request', () => ({ useRequestStore: () => ({ getAxios: () => requestMock }) }))
vi.mock('@/service/passwordEncryptionService', () => ({ passwordEncryptionService: {} }))
import { ramService } from '@/service/ramService'
const document = {
  Version: '1' as const,
  Statement: { Effect: 'Allow' as const, Action: 'quyan:ram:ReadUser', Resource: '*' },
}
beforeEach(() => {
  vi.resetAllMocks()
})
describe('RAM service IAM document operations', () => {
  it('loads the catalog and simulates through generated descriptors', async () => {
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.OK, data: ['quyan:ram:ReadUser'] })
    expect(await ramService.getIamActions()).toEqual(['quyan:ram:ReadUser'])
    expect(requestMock.get).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RamControllerGetIamActions' }),
      {},
      undefined,
    )
    const input = { principalId: 'p1', action: 'quyan:ram:ReadUser', resource: '*' }
    const result = { decision: 'ExplicitDeny', reason: 'explicit-deny', matchedStatements: [] }
    requestMock.post.mockResolvedValueOnce({ code: CustomCode.OK, data: result })
    expect(await ramService.simulatePolicy(input)).toEqual(result)
    expect(requestMock.post).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RamControllerSimulatePolicy' }),
      { body: input },
      undefined,
    )
  })

  it('uses server pagination and sends the snapshot hash when restoring a version', async () => {
    const query = { page: 3, pageSize: 20 }
    const data = { items: [], total: 41, ...query, defaultDocumentHash: 'a'.repeat(64) }
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.OK, data })
    expect(await ramService.listPolicyVersions('policy-1', query)).toEqual(data)
    expect(requestMock.get).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RamControllerListPolicyVersions' }),
      { path: { policyId: 'policy-1' }, params: query },
      undefined,
    )
    const body = { versionId: 'version-1', expectedDocumentHash: data.defaultDocumentHash }
    requestMock.put.mockResolvedValueOnce({ code: CustomCode.OK })
    await ramService.setDefaultPolicyVersion('policy-1', body)
    expect(requestMock.put).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RamControllerSetDefaultPolicyVersion' }),
      { path: { policyId: 'policy-1' }, body },
      undefined,
    )
    requestMock.put.mockResolvedValueOnce({ code: CustomCode.PERMISSION_DENIED })
    await expect(ramService.setDefaultPolicyVersion('policy-1', body)).rejects.toThrow()
  })

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
