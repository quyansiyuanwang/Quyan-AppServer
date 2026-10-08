import { createIamCatalogControllerApi } from '@/client/services/iam-catalog-controller.gen'
import { createRamControllerApi } from '@/client/services/ram-controller.gen'
import type {
  AssumeRamRoleDto,
  AttachPolicyBodyDto,
  BindRamRoleToGroupDto,
  BindRamRoleToUserDto,
  CreateRamPolicyDto,
  CreateRamRoleDto,
  CreateRamUserDto,
  UpdateRamPolicyDto,
  UpdateRamRoleDto,
  UpdateRamUserDto,
  ValidateIamPolicyDto,
  SimulateIamPolicyDto,
  SetDefaultRamPolicyVersionDto,
  SetRamRoleTrustPolicyDto,
} from '@/client/types.gen'
import { CustomCode } from '@/constant/custom-code'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { toServiceError } from '@/utils/error-utils'
import { passwordEncryptionService } from '@/service/passwordEncryptionService'

const catalogApi = cacheObject(() => createIamCatalogControllerApi(useRequestStore().getAxios()))

const ramApi = cacheObject(() => createRamControllerApi(useRequestStore().getAxios()))

export class RamService {
  private static instance: RamService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new RamService()
    }
    return this.instance
  }

  async listUsers() {
    const result = await ramApi.listUsers({})
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async createUser(data: CreateRamUserDto) {
    const body = { ...data, password: undefined }
    const create = async (passwordCredential?: CreateRamUserDto['passwordCredential']) => {
      const result = await ramApi.createUser({
        body: { ...body, ...(passwordCredential ? { passwordCredential } : {}) },
      })
      if (result?.code === CustomCode.OK && result.data) return result.data
      throw toServiceError(result)
    }

    return data.password
      ? passwordEncryptionService.runWithRetry(data.password, (passwordCredential) =>
          create(passwordCredential),
        )
      : create()
  }

  async updateUser(userId: string, data: UpdateRamUserDto) {
    const result = await ramApi.updateUser({ path: { userId }, body: data })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async deleteUser(userId: string) {
    const result = await ramApi.deleteUser({ path: { userId } })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  async listRoles() {
    const result = await ramApi.listRoles({})
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async createRole(data: CreateRamRoleDto) {
    const result = await ramApi.createRole({ body: data })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async updateRole(roleId: string, data: UpdateRamRoleDto) {
    const result = await ramApi.updateRole({ path: { roleId }, body: data })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async setRoleTrustPolicy(roleId: string, data: SetRamRoleTrustPolicyDto) {
    const result = await ramApi.setRoleTrustPolicy({ path: { roleId }, body: data })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async deleteRole(roleId: string) {
    const result = await ramApi.deleteRole({ path: { roleId } })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  async listRoleBindings(roleId: string, userId?: string) {
    const result = await ramApi.listRoleBindings({ path: { roleId }, params: { userId } })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async bindRoleToUser(roleId: string, data: BindRamRoleToUserDto) {
    const result = await ramApi.bindRoleToUser({ path: { roleId }, body: data })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  async unbindRoleFromUser(roleId: string, userId: string) {
    const result = await ramApi.unbindRoleFromUser({ path: { roleId, userId } })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  async bindRoleToGroup(roleId: string, data: BindRamRoleToGroupDto) {
    const result = await ramApi.bindRoleToGroup({ path: { roleId }, body: data })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  async unbindRoleFromGroup(roleId: string, groupId: string) {
    const result = await ramApi.unbindRoleFromGroup({ path: { roleId, groupId } })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  async assumeRole(data: AssumeRamRoleDto) {
    const result = await ramApi.assumeRole({ body: data })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async listSessions(principalUserId?: string) {
    const result = await ramApi.listSessions({ params: { principalUserId } })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async revokeSession(sessionId: string) {
    const result = await ramApi.revokeSession({ path: { sessionId } })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  // ── 权限策略 ──

  async listPolicies() {
    const result = await ramApi.listPolicies({})
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async createPolicy(data: CreateRamPolicyDto) {
    const result = await ramApi.createPolicy({ body: data })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async updatePolicy(policyId: string, data: UpdateRamPolicyDto) {
    const result = await ramApi.updatePolicy({ path: { policyId }, body: data })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async listPolicyVersions(policyId: string, query: { page: number; pageSize: number }) {
    const result = await ramApi.listPolicyVersions({ path: { policyId }, params: query })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async setDefaultPolicyVersion(policyId: string, data: SetDefaultRamPolicyVersionDto) {
    const result = await ramApi.setDefaultPolicyVersion({ path: { policyId }, body: data })
    if (result?.code === CustomCode.OK) return
    throw toServiceError(result)
  }

  async getIamActions() {
    const result = await ramApi.getIamActions({})
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async simulatePolicy(data: SimulateIamPolicyDto) {
    const result = await ramApi.simulatePolicy({ body: data })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async diagnosePolicy(documentText: string, policyKind?: 'identity' | 'trust') {
    const result = await ramApi.diagnosePolicy({
      body: { documentText, ...(policyKind ? { policyKind } : {}) },
    })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async getPolicySchema(policyKind: 'identity' | 'trust' = 'identity') {
    const result = await catalogApi.getPolicySchema({ params: { policyKind } })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async validatePolicy(document: ValidateIamPolicyDto['document']) {
    const result = await ramApi.validatePolicy({ body: { document } })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async deletePolicy(policyId: string) {
    const result = await ramApi.deletePolicy({ path: { policyId } })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  async listPolicyAttachments(policyId: string) {
    const result = await ramApi.listPolicyAttachments({ path: { policyId } })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async attachPolicy(data: AttachPolicyBodyDto) {
    const result = await ramApi.attachPolicy({ body: data })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  async detachPolicy(data: AttachPolicyBodyDto) {
    const result = await ramApi.detachPolicy({ body: data })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result)
  }

  // ── 授权概览 ──

  async getUserEffectivePermissions(userId: string) {
    const result = await ramApi.getUserEffectivePermissions({ params: { userId } })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async listGroups(params?: { keyword?: string; page?: number; pageSize?: number }) {
    const result = await ramApi.listVisibleGroups({ params: params || {} })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }
}

export const ramService = RamService.getInstance()
