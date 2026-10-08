import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomCode } from '@/constant/custom-code'
const { requestMock } = vi.hoisted(() => ({
  requestMock: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
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
  it('loads an attachment page through its policy path without a fallback on denial', async () => {
    const query = { page: 2, pageSize: 25 },
      data = { items: [], ...query, hasNext: true }
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.OK, data })
    expect(await ramService.listPolicyAttachmentsPage('policy', query)).toEqual(data)
    expect(requestMock.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerListPolicyAttachmentsPage' }),
      { path: { policyId: 'policy' }, params: query },
      undefined,
    )
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.PERMISSION_DENIED })
    await expect(ramService.listPolicyAttachmentsPage('policy', query)).rejects.toThrow()
    expect(requestMock.get).toHaveBeenCalledTimes(2)
  })

  it('paginates bindings on their parent role with an optional same-account user filter', async () => {
    const query = { page: 2, pageSize: 25, userId: 'user' },
      data = { items: [], page: 2, pageSize: 25, hasNext: true }
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.OK, data })
    expect(await ramService.listRoleBindingsPage('role', query)).toEqual(data)
    expect(requestMock.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerListRoleBindingsPage' }),
      { path: { roleId: 'role' }, params: query },
      undefined,
    )
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.PERMISSION_DENIED })
    await expect(ramService.listRoleBindingsPage('role', query)).rejects.toThrow()
  })

  it('uses generated user and session page endpoints and passes the principal filter', async () => {
    const query = { page: 3, pageSize: 25 },
      data = { items: [], ...query, hasNext: true }
    requestMock.get.mockResolvedValue({ code: CustomCode.OK, data })
    expect(await ramService.listUsersPage(query)).toEqual(data)
    expect(requestMock.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerListUsersPage' }),
      { params: query },
      undefined,
    )
    expect(await ramService.listSessionsPage({ ...query, principalUserId: 'actor' })).toEqual(data)
    expect(requestMock.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerListSessionsPage' }),
      { params: { ...query, principalUserId: 'actor' } },
      undefined,
    )
    requestMock.get.mockResolvedValue({ code: CustomCode.PERMISSION_DENIED })
    await expect(ramService.listUsersPage(query)).rejects.toThrow()
    await expect(ramService.listSessionsPage(query)).rejects.toThrow()
  })

  it('loads paged group options without falling back to the unbounded list on denial', async () => {
    const query = { page: 2, pageSize: 25, keyword: 'team' }
    const data = { items: [], page: 2, pageSize: 25, hasNext: true }
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.OK, data })
    expect(await ramService.listVisibleGroupPage(query)).toEqual(data)
    expect(requestMock.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerListVisibleGroupPage' }),
      { params: query },
      undefined,
    )
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.PERMISSION_DENIED })
    await expect(ramService.listVisibleGroupPage(query)).rejects.toThrow()
    expect(requestMock.get).toHaveBeenCalledTimes(2)
  })

  it('loads role and policy candidate pages through the generated descriptors', async () => {
    const query = { page: 2, pageSize: 25 }
    const data = { items: [], ...query, hasNext: true }
    requestMock.get.mockResolvedValue({ code: CustomCode.OK, data })
    expect(await ramService.listRolesPage(query)).toEqual(data)
    expect(requestMock.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerListRolesPage' }),
      { params: query },
      undefined,
    )
    expect(await ramService.listPoliciesPage(query)).toEqual(data)
    expect(requestMock.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerListPoliciesPage' }),
      { params: query },
      undefined,
    )
    requestMock.get.mockResolvedValue({ code: CustomCode.PERMISSION_DENIED })
    await expect(ramService.listRolesPage(query)).rejects.toThrow()
    await expect(ramService.listPoliciesPage(query)).rejects.toThrow()
  })

  it('uses paged descriptors and dedicated scoped authorization mutations', async () => {
    const page = { items: [], page: 2, pageSize: 25, hasNext: true }
    requestMock.get.mockResolvedValue({ code: CustomCode.OK, data: page })
    await ramService.listAuthorizationPage({ page: 2, pageSize: 25, principalId: 'user-1' })
    expect(requestMock.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerListAuthorizationPage' }),
      { params: { page: 2, pageSize: 25, principalId: 'user-1' } },
      undefined,
    )
    await ramService.listResourceGroupPage({ page: 2, pageSize: 25 })
    expect(requestMock.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerListResourceGroupPage' }),
      { params: { page: 2, pageSize: 25 } },
      undefined,
    )
    await ramService.listResourceGroupMemberPage('group-1', { page: 2, pageSize: 25 })
    expect(requestMock.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerListResourceGroupMemberPage' }),
      { path: { groupId: 'group-1' }, params: { page: 2, pageSize: 25 } },
      undefined,
    )
    requestMock.post.mockResolvedValue({ code: CustomCode.OK, data: { id: 'authorization-1' } })
    const body = {
      principalType: 'user' as const,
      principalId: 'user-1',
      policyId: 'policy-1',
      scopeType: 'resource-group' as const,
      scopeResourceId: 'group-1',
    }
    await ramService.createAuthorization(body)
    expect(requestMock.post).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerCreateAuthorization' }),
      { body },
      undefined,
    )
    await ramService.createResourceGroup({ name: 'Development' })
    expect(requestMock.post).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerCreateResourceGroup' }),
      { body: { name: 'Development' } },
      undefined,
    )
    await ramService.addResourceGroupMember('group-1', 'acs:quyan:*:owner:user/one')
    expect(requestMock.post).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerAddResourceGroupMember' }),
      { path: { groupId: 'group-1' }, body: { resourceArn: 'acs:quyan:*:owner:user/one' } },
      undefined,
    )
    requestMock.delete.mockResolvedValue({ code: CustomCode.OK })
    await ramService.deleteAuthorization('authorization-1')
    expect(requestMock.delete).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerDeleteAuthorization' }),
      { path: { authorizationId: 'authorization-1' } },
      undefined,
    )
    await ramService.removeResourceGroupMember('group-1', 'member-1')
    expect(requestMock.delete).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'RamControllerRemoveResourceGroupMember' }),
      { path: { groupId: 'group-1', memberId: 'member-1' } },
      undefined,
    )
  })
  it('requests a billed AI draft through the generated replay-protected descriptor only', async () => {
    const body = { instruction: 'Read one user', model: 'model-id', relayTokenId: 'token-id' }
    const data = {
      explanation: [],
      diagnostics: [],
      missingInformation: [],
      riskLevel: 'high',
      delegation: 'not-evaluated',
    }
    requestMock.post.mockResolvedValueOnce({ code: CustomCode.OK, data })
    expect(await ramService.generatePolicyDraft(body)).toEqual(data)
    expect(requestMock.post).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RamControllerGeneratePolicyDraft' }),
      { body },
      undefined,
    )
    expect(requestMock.put).not.toHaveBeenCalled()
    requestMock.post.mockResolvedValueOnce({ code: CustomCode.PERMISSION_DENIED })
    await expect(ramService.generatePolicyDraft(body)).rejects.toThrow()
  })
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

  it('sends raw JSON unchanged through the diagnosis endpoint', async () => {
    const raw = '{"Version":"1",}'
    const data = {
      valid: false,
      diagnostics: [{ code: 'json-syntax', line: 1, column: 16 }],
      delegation: 'not-evaluated',
    }
    requestMock.post.mockResolvedValueOnce({ code: CustomCode.OK, data })
    expect(await ramService.diagnosePolicy(raw)).toEqual(data)
    expect(requestMock.post).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RamControllerDiagnosePolicy' }),
      { body: { documentText: raw } },
      undefined,
    )
  })
  it('uses the generated catalog descriptor for the policy Schema', async () => {
    const data = { title: 'Policy', additionalProperties: false }
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.OK, data })
    expect(await ramService.getPolicySchema()).toEqual(data)
    expect(requestMock.get).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'IamCatalogControllerGetPolicySchema' }),
      { params: { policyKind: 'identity' } },
      undefined,
    )
  })
  it('uses trust-specific Schema and diagnosis without publishing a document', async () => {
    const schema = { title: 'Trust', 'x-quyan-policy-kind': 'trust' }
    requestMock.get.mockResolvedValueOnce({ code: CustomCode.OK, data: schema })
    expect(await ramService.getPolicySchema('trust')).toEqual(schema)
    expect(requestMock.get).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'IamCatalogControllerGetPolicySchema' }),
      { params: { policyKind: 'trust' } },
      undefined,
    )
    requestMock.post.mockResolvedValueOnce({
      code: CustomCode.OK,
      data: { valid: false, diagnostics: [] },
    })
    await ramService.diagnosePolicy('{}', 'trust')
    expect(requestMock.post).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RamControllerDiagnosePolicy' }),
      { body: { documentText: '{}', policyKind: 'trust' } },
      undefined,
    )
    expect(requestMock.put).not.toHaveBeenCalled()
  })
  it('publishes trust only through the generated replay-protected role API and carries the hash', async () => {
    const body = {
      document: {
        Version: '1' as const,
        Statement: {
          Effect: 'Allow' as const,
          Action: 'quyan:ram:AssumeRole',
          Resource: 'acs:quyan:*:owner:role/role',
          Principal: { RAM: 'acs:quyan::owner:user/user' },
        },
      },
      expectedDocumentHash: 'a'.repeat(64),
    }
    requestMock.put.mockResolvedValueOnce({ code: CustomCode.OK, data: { id: 'role' } })
    expect(await ramService.setRoleTrustPolicy('role', body)).toEqual({ id: 'role' })
    expect(requestMock.put).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'RamControllerSetRoleTrustPolicy' }),
      { path: { roleId: 'role' }, body },
      undefined,
    )
    requestMock.put.mockResolvedValueOnce({ code: CustomCode.PERMISSION_DENIED })
    await expect(ramService.setRoleTrustPolicy('role', body)).rejects.toThrow()
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
