import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import {
  useRequestStore,
  saveTokenExpiration,
  clearTokenExpiration,
  setAccessToken,
  clearAccessToken,
} from '@/stores/request'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { authEventBus } from '@/stores/globalInstance'
import StorageKey from '@/constant/storagekey'
import router from '@/router'
import type { UserDto } from '@/client/types.gen'
import { toServiceError } from '@/utils/error-utils'
import { authorizationService } from '@/service/authorizationService'
import { cacheObject } from '@/utils/common'
import { createImpersonationControllerApi } from '@/client/services/impersonation-controller.gen'
import {
  getCurrentStorageScope,
  setCurrentStorageScope,
  setCurrentStorageScopeForUserId,
  resetCurrentStorageScope,
} from '@/utils/storageScope'

const impersonationApi = cacheObject(() =>
  createImpersonationControllerApi(useRequestStore().getAxios()),
)

export class ImpersonationService {
  private static instance: ImpersonationService | null = null
  private exitHandler: (() => void) | null = null

  private constructor() {}

  static getInstance(): ImpersonationService {
    if (!this.instance) this.instance = new ImpersonationService()
    return this.instance
  }

  private backupOriginalSession() {
    const accessToken = TypedLocalStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)
    const refreshToken = TypedLocalStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)
    const accessExpiry = TypedLocalStorage.getItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION)
    const refreshExpiry = TypedLocalStorage.getItem(StorageKey.Auth.REFRESH_TOKEN_EXPIRATION)
    const storageScope = getCurrentStorageScope()

    if (accessToken) {
      TypedLocalStorage.setItem(StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN, accessToken)
    } else {
      TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN)
    }

    if (refreshToken) {
      TypedLocalStorage.setItem(StorageKey.Impersonation.ORIGINAL_REFRESH_TOKEN, refreshToken)
    } else {
      TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_REFRESH_TOKEN)
    }

    if (accessExpiry) {
      TypedLocalStorage.setItem(StorageKey.Impersonation.ORIGINAL_ACCESS_EXPIRY, accessExpiry)
    } else {
      TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_ACCESS_EXPIRY)
    }

    if (refreshExpiry) {
      TypedLocalStorage.setItem(StorageKey.Impersonation.ORIGINAL_REFRESH_EXPIRY, refreshExpiry)
    } else {
      TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_REFRESH_EXPIRY)
    }

    TypedLocalStorage.setItem(StorageKey.Impersonation.ORIGINAL_STORAGE_SCOPE, storageScope)
  }

  private restoreOriginalSession(): boolean {
    const originalAccessToken = TypedLocalStorage.getItem(
      StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN,
    )
    const originalRefreshToken = TypedLocalStorage.getItem(
      StorageKey.Impersonation.ORIGINAL_REFRESH_TOKEN,
    )
    const originalAccessExpiry = TypedLocalStorage.getItem(
      StorageKey.Impersonation.ORIGINAL_ACCESS_EXPIRY,
    )
    const originalRefreshExpiry = TypedLocalStorage.getItem(
      StorageKey.Impersonation.ORIGINAL_REFRESH_EXPIRY,
    )
    const originalStorageScope = TypedLocalStorage.getItem(
      StorageKey.Impersonation.ORIGINAL_STORAGE_SCOPE,
    )

    if (!originalAccessToken) {
      return false
    }

    setAccessToken(originalAccessToken)
    if (originalAccessExpiry) {
      TypedLocalStorage.setItem(StorageKey.Auth.ACCESS_TOKEN_EXPIRATION, originalAccessExpiry)
    }

    if (originalRefreshToken) {
      TypedLocalStorage.setItem(StorageKey.Auth.REFRESH_TOKEN, originalRefreshToken)
    } else {
      TypedLocalStorage.removeItem(StorageKey.Auth.REFRESH_TOKEN)
    }

    if (originalRefreshExpiry) {
      TypedLocalStorage.setItem(StorageKey.Auth.REFRESH_TOKEN_EXPIRATION, originalRefreshExpiry)
    } else {
      TypedLocalStorage.removeItem(StorageKey.Auth.REFRESH_TOKEN_EXPIRATION)
    }

    if (originalStorageScope) {
      setCurrentStorageScope(originalStorageScope)
    } else {
      resetCurrentStorageScope()
    }

    return true
  }

  private clearOriginalSessionBackup() {
    TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_ACCESS_TOKEN)
    TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_REFRESH_TOKEN)
    TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_ACCESS_EXPIRY)
    TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_REFRESH_EXPIRY)
    TypedLocalStorage.removeItem(StorageKey.Impersonation.ORIGINAL_STORAGE_SCOPE)
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

    this.backupOriginalSession()

    setAccessToken(access_token)
    saveTokenExpiration(access_token)
    setCurrentStorageScopeForUserId(targetUser.id)

    // 记录模拟会话信息
    impersonationStore.setSession({
      targetUserId: targetUser.id,
      targetUsername: targetUser.username ?? '',
      targetName: targetUser.name ?? null,
      mode,
      startedAt: Date.now(),
    })

    // 注册 token 过期自动退出
    this.registerExpiryHandler()

    // 重新加载用户信息和权限（切换到目标用户视角）
    await this.reloadStores()
  }

  /**
   * 退出模拟，恢复管理员身份
   */
  async exitImpersonation(redirectTo?: string) {
    const impersonationStore = useImpersonationStore()

    // 移除过期钩子
    this.unregisterExpiryHandler()

    const restoredLocally = this.restoreOriginalSession()

    // 清除模拟会话状态
    impersonationStore.clearSession()

    if (restoredLocally) {
      await this.reloadStores()
      this.clearOriginalSessionBackup()
    } else {
      clearAccessToken()
      clearTokenExpiration()
      clearTokenExpiration(true)
      resetCurrentStorageScope()
      await authorizationService.bootstrapSession(true)
      await this.reloadStores()
    }

    this.clearOriginalSessionBackup()

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

    // fetchUserInfo must complete first so permissionStore.init() can read the new userId
    await userInfoStore.fetchUserInfo()
    await permissionStore.init()
  }

  /**
   * 注册模拟 token 过期处理：过期时自动退出模拟而非跳转登录页
   */
  private registerExpiryHandler() {
    this.unregisterExpiryHandler()

    const handler = () => {
      const impersonationStore = useImpersonationStore()
      if (impersonationStore.isImpersonating) {
        console.info('[Impersonation] Token expired, exiting impersonation session')
        this.exitImpersonation()
      }
    }

    this.exitHandler = handler
    authEventBus.on('ACCESS_TOKEN_REFRESH_FAILED', handler)
  }

  /** 页面刷新后，若已在模拟会话中，重新注册过期处理器 */
  registerExpiryHandlerOnRestore() {
    this.registerExpiryHandler()
  }

  private unregisterExpiryHandler() {
    if (this.exitHandler) {
      authEventBus.off('ACCESS_TOKEN_REFRESH_FAILED', this.exitHandler)
      this.exitHandler = null
    }
  }
}

export const impersonationService = ImpersonationService.getInstance()
