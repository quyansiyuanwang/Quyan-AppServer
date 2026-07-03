import { useRequestStore } from '@/stores/request'

import { md5 } from '@/utils/encryption'
import { CustomCode } from '@/constant/custom-code'
import type { CreateUserDto, UpdateUserDto } from '@/client/types.gen'
import { toServiceError } from '@/utils/error-utils'
import { cacheObject } from '@/utils/common'
import { createUserControllerApi } from '@/client/services/user-controller.gen'

const userApi = cacheObject(() => createUserControllerApi(useRequestStore().getAxios()))

/**
 * 用户服务
 *
 * 这是一个使用 MyAxios 请求器的示例服务
 * 展示了如何封装 API 调用并提供类型安全的接口
 */

export class UserService {
  private static instance: UserService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new UserService()
    }
    return this.instance
  }

  /**
   * 获取所有用户
   * @returns 用户列表
   * @throws 当请求失败时抛出错误
   */
  async getAllUsers(params?: {
    page?: number
    pageSize?: number
    keyword?: string
    userId?: string
    groupId?: string
    excludeCurrentUser?: boolean
    userType?: string
    hasRamPermission?: boolean
  }) {
    const result = await userApi.getAllUsers({
      params: params || {},
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result)
  }

  /**
   * 根据 ID 获取用户
   * @param userId 用户ID
   * @returns 用户信息
   * @throws 当用户不存在或请求失败时抛出错误
   */
  async getUserById(userId: string) {
    const result = await userApi.getUserById({
      path: { userId },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result)
  }

  async getMe() {
    const result = await userApi.getCurrentUser({})

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result)
  }

  async changePassword(opts: { userId: string; newPassword: string }) {
    const result = await userApi.changePassword({
      path: { userId: opts.userId },
      body: {
        newPassword: md5(opts.newPassword),
      },
    })

    if (result && result.code === CustomCode.OK) {
      return true
    }

    throw toServiceError(result)
  }

  async createUser(data: CreateUserDto) {
    const result = await userApi.createUser({
      body: {
        ...data,
        password: md5(data.password),
      },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result)
  }

  async updateUser(userId: string, data: UpdateUserDto) {
    const result = await userApi.updateUser({
      path: { userId },
      body: data,
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result)
  }

  async deleteUser(userId: string) {
    const result = await userApi.deleteUser({
      path: { userId },
    })

    if (result && result.code === CustomCode.OK) {
      return true
    }

    throw toServiceError(result)
  }

  /**
   * 更新个人资料（姓名）
   */
  async updateProfile(data: { name?: string }) {
    const result = await userApi.updateProfile({
      body: data,
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result)
  }

  /**
   * 发送邮箱变更验证码
   */
  async sendEmailChangeCode(newEmail: string) {
    const result = await userApi.sendEmailChangeCode({
      body: { newEmail },
    })

    if (result && result.code === CustomCode.OK) {
      return true
    }

    throw toServiceError(result)
  }

  /**
   * 通过验证码修改邮箱
   */
  async changeEmail(newEmail: string, verificationCode: string) {
    const result = await userApi.changeEmail({
      body: { newEmail, verificationCode },
    })

    if (result && result.code === CustomCode.OK) {
      return true
    }

    throw toServiceError(result)
  }
}

// 导出单例实例
export const userService = UserService.getInstance()
