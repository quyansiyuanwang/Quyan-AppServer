import {
  type PermissionControllerAddUserPermissionsApiType,
  type PermissionControllerRemoveUserPermissionsApiType,
  type PermissionControllerCheckPermissionsApiType,
  type PermissionControllerSetGroupPermissionsApiType,
} from '@/client/api-types-map.gen'
import type { SetUserPermissionDto } from '@/client/types.gen'
import { CustomCode } from '@/constant/custom-code'
import { usePermissionStore } from '@/stores/permissionStore'
import { useRequestStore } from '@/stores/request'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { cache } from '@/utils/common'
import { toServiceError } from '@/utils/error-utils'
import { createPermissionControllerApi } from '@/client/services/permission-controller.gen'

const getPermissionControllerApi = cache(() =>
  createPermissionControllerApi(useRequestStore().getAxios()),
)

export class PermissionService {
  private static instance: PermissionService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new PermissionService()
    }
    return this.instance
  }

  /**
   * 获取所有可用权限列表
   * @returns 所有权限分类及权限列表
   */
  async getAllPermissions() {
    const result = await getPermissionControllerApi().getAllPermissions({})
    return result
  }

  /**
   * 获取用户权限详情（包含组权限、额外权限、移除权限和最终有效权限）
   * @param userId 用户ID
   * @returns 用户完整权限信息
   */
  async getUserPermissions(userId: string) {
    const result = await getPermissionControllerApi().getUserPermissions({
      path: { userId },
    })
    return result
  }

  /**
   * 设置用户权限（同时设置额外添加和移除的权限）
   * @param userId 用户ID
   * @param data 权限配置（permissionAdds: 添加的权限，permissionRemoves: 移除的权限）
   * @returns 是否成功
   */
  async setUserPermissions(userId: string, data: SetUserPermissionDto) {
    const result = await getPermissionControllerApi().setUserPermissions({
      path: { userId },
      body: data,
    })
    return result?.code === CustomCode.OK
  }

  /**
   * 为用户添加额外权限
   * @param userId 用户ID
   * @param permissions 要添加的权限列表
   * @returns 是否成功
   */
  async addUserPermissions(
    userId: string,
    permissions: PermissionControllerAddUserPermissionsApiType['body'],
  ) {
    const result = await getPermissionControllerApi().addUserPermissions({
      path: { userId },
      body: permissions,
    })
    return result?.code === CustomCode.OK
  }

  /**
   * 移除用户权限
   * @param userId 用户ID
   * @param permissions 要移除的权限列表
   * @returns 是否成功
   */
  async removeUserPermissions(
    userId: string,
    permissions: PermissionControllerRemoveUserPermissionsApiType['body'],
  ) {
    const result = await getPermissionControllerApi().removeUserPermissions({
      path: { userId },
      body: permissions,
    })
    return result?.code === CustomCode.OK
  }

  /**
   * 清空用户的所有额外权限配置（恢复到仅拥有组权限）
   * @param userId 用户ID
   * @returns 是否成功
   */
  async clearUserPermissions(userId: string) {
    const result = await getPermissionControllerApi().clearUserPermissions({
      path: { userId },
    })
    return result?.code === CustomCode.OK
  }

  /**
   * 检查用户是否拥有指定权限
   * @param data 检查参数（userId: 用户ID, permissions: 要检查的权限列表）
   * @returns 权限检查结果
   */
  async checkPermissions(data: PermissionControllerCheckPermissionsApiType['body']) {
    const result = await getPermissionControllerApi().checkPermissions({
      body: data,
    })
    return result
  }

  /**
   * 获取用户组权限
   * @param groupId 用户组ID
   * @returns 用户组权限列表
   */
  async getGroupPermissions(groupId: string) {
    const result = await getPermissionControllerApi().getGroupPermissions({
      path: { groupId },
    })
    return result
  }

  /**
   * 设置用户组权限
   * @param groupId 用户组ID
   * @param data 权限配置
   * @returns 是否成功
   */
  async setGroupPermissions(
    groupId: string,
    data: PermissionControllerSetGroupPermissionsApiType['body'],
  ) {
    const result = await getPermissionControllerApi().setGroupPermissions({
      path: { groupId },
      body: data,
    })
    return result?.code === CustomCode.OK
  }

  async loadCurrentUserPermissions() {
    const userInfoStore = useUserInfoStore()
    const myId = userInfoStore.userInfo.id
    if (!myId) throw toServiceError(undefined, '无法获取当前用户ID')
    const result = await getPermissionControllerApi().getUserPermissions({
      path: { userId: myId },
    })
    return result
  }

  async ensureLoaded() {
    const { sessionCoordinator } = await import('@/service/sessionCoordinator')
    await sessionCoordinator.hydrateUserAndPermissions()
  }
}

export const permissionService = PermissionService.getInstance()
