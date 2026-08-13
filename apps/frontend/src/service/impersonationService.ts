import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { useRequestStore, setAccessToken } from '@/stores/request'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { usePermissionStore } from '@/stores/permissionStore'
import router from '@/router'
import type { UserDto } from '@/client/types.gen'
import { toServiceError } from '@/utils/error-utils'
import { sessionCoordinator } from '@/service/sessionCoordinator'
import { cacheObject } from '@/utils/common'
import { createImpersonationControllerApi } from '@/client/services/impersonation-controller.gen'
import {
  setCurrentStorageScopeForUserId,
} from '@/utils/storageScope'

const impersonationApi = cacheObject(() =>
  createImpersonationControllerApi(useRequestStore().getAxios()),
)

export class ImpersonationService {
  private static instance: ImpersonationService | null = null
  private constructor() {}

  static getInstance(): ImpersonationService {
    if (!this.instance) this.instance = new ImpersonationService()
    return this.instance
  }

  /**
   * 开始模拟指定用户
   * 1. 调用后端获取模拟 token
   * 2. 注入模拟 token 到内存
   * 3. 重新加载用户信息和权限（切换到目标用户视角）
   * 4. 注册 token 过期时自动退出钩子
   */
  async startImpersonation(targetUser: Pick<UserDto, 'id' | 'username' | 'name'>) {
    const impersonationStore = useImpersonationStore()

    // 不允许在模拟中再次模拟
    if (impersonationStore.isImpersonating) {
      throw new Error('当前已在模拟会话中，请先退出')
    }

    const result = await impersonationApi.startImpersonation({
      body: { targetUserId: targetUser.id },
    })

    if (!result.data?.access_token) {
      throw toServiceError(result, '获取模拟 token 失败')
    }

    const { access_token, mode } = result.data as {
      access_token: string
      mode: 'view' | 'act'
    }

    setAccessToken(access_token)
    setCurrentStorageScopeForUserId(targetUser.id)

    // 记录模拟会话信息
    impersonationStore.setSession({
      targetUserId: targetUser.id,
      targetUsername: targetUser.username ?? '',
      targetName: targetUser.name ?? null,
      mode,
      startedAt: Date.now(),
    })

    // 重新加载用户信息和权限（切换到目标用户视角）
    await this.reloadStores()
  }

  /**
   * 退出模拟，恢复管理员身份
   */
  async exitImpersonation(redirectTo?: string) {
    const impersonationStore = useImpersonationStore()

    // 清除模拟会话状态
    impersonationStore.clearSession()
    const restoredToken = await sessionCoordinator.refresh()
    if (!restoredToken) throw new Error('Unable to restore the original session')
    await this.reloadStores()

    // 跳转
    if (redirectTo) {
      await router.push(redirectTo)
    } else {
      await router.push({ name: 'userManagement' })
    }
  }

  private async reloadStores() {
    const userInfoStore = useUserInfoStore()
    const permissionStore = usePermissionStore()

    userInfoStore.clear()
    permissionStore.clearCurrentUserPermissions()

    // Fetch identity before its permissions; the coordinator owns this sequence.
    await userInfoStore.fetchUserInfo()
    await permissionStore.loadCurrentUserPermissions()
  }
}

export const impersonationService = ImpersonationService.getInstance()
