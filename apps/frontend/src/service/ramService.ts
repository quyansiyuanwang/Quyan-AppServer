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
} from '@/client/types.gen'
import { CustomCode } from '@/constant/custom-code'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { md5 } from '@/utils/encryption'
import { toServiceError } from '@/utils/error-utils'

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
    const body: Record<string, unknown> = { ...data }
    if (data.password) {
      body.password = md5(data.password)
    } else {
      // AccessKey 模式：生成随机内部密码
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
      const randomPwd = Array.from({ length: 16 }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length)),
      ).join('')
      body.password = md5(randomPwd)
    }
    const result = await ramApi.createUser({ body: body as CreateRamUserDto })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
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
}

export const ramService = RamService.getInstance()
