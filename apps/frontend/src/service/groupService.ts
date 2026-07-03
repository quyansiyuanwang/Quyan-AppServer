import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import type { Permission } from '@/constant/permission'
import { toServiceError } from '@/utils/error-utils'
import { cacheObject } from '@/utils/common'
import { createGroupControllerApi } from '@/client/services/group-controller.gen'
import { createPermissionControllerApi } from '@/client/services/permission-controller.gen'

const permissionApi = cacheObject(() => createPermissionControllerApi(useRequestStore().getAxios()))

const groupApi = cacheObject(() => createGroupControllerApi(useRequestStore().getAxios()))

interface CreateGroupRequest {
  username: string
  name?: string
  level: number
  description?: string
}

interface UpdateGroupRequest {
  name?: string
  level?: number
  description?: string
}

export class GroupService {
  private static instance: GroupService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new GroupService()
    }
    return this.instance
  }

  async getAllGroups(params?: {
    keyword?: string
    page?: number
    pageSize?: number
    hasRamPermission?: boolean
  }) {
    const result = await groupApi.getAllGroups({
      params: params || {},
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async getGroupById(groupId: string) {
    const result = await groupApi.getGroupById({
      path: { groupId },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async createGroup(data: CreateGroupRequest) {
    const result = await groupApi.createGroup({
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async updateGroup(groupId: string, data: UpdateGroupRequest) {
    const result = await groupApi.updateGroup({
      path: { groupId },
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async deleteGroup(groupId: string) {
    const result = await groupApi.deleteGroup({
      path: { groupId },
    })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async getGroupPermissions(groupId: string) {
    const result = await permissionApi.getGroupPermissions({
      path: { groupId },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async setGroupPermissions(groupId: string, permissions: Permission[]) {
    const result = await permissionApi.setGroupPermissions({
      path: { groupId },
      body: { permissions },
    })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }
}

export const groupService = GroupService.getInstance()
