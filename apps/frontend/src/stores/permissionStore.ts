import type {
  Permission,
  AllPermissionsDto,
  UserFullPermissionsDto,
  PermissionCheckResultDto,
} from '@/client/types.gen'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useUserInfoStore } from './userInfoStore'
import { permissionService } from '@/service/permissionService'
import StorageKey from '@/constant/storagekey'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { getScopedStorageKey } from '@/utils/storageScope'

type CachedPermissionState = Pick<AllPermissionsDto, 'permissions'> & {
  currentUserPermissions: UserFullPermissionsDto
}

/**
 * 权限管理 Store
 * 提供权限的响应式状态和操作方法
 */
export const usePermissionStore = defineStore('permissionStore', () => {
  // ========== State ==========

  /** 所有可用权限列表（按分类组织） */
  const allPermissions = ref<AllPermissionsDto['permissions']>([])

  /** 当前用户的完整权限信息 */
  const currentUserPermissions = ref<UserFullPermissionsDto | null>(null)

  /** 当前权限缓存对应的用户ID */
  const currentPermissionUserId = ref<string | null>(null)

  /** 加载状态 */
  const loading = ref(false)

  /** 错误信息 */
  const error = ref<string | null>(null)

  const isLoaded = computed(() => {
    const currentUserId = useUserInfoStore().userInfo.id
    return (
      allPermissions.value.length > 0 &&
      currentUserPermissions.value !== null &&
      !!currentUserId &&
      currentPermissionUserId.value === currentUserId
    )
  })

  const getCacheKey = (userId: string) =>
    getScopedStorageKey(StorageKey.Permission.CURRENT_USER, `user:${userId}`)

  const saveCurrentUserPermissionsCache = (userId: string) => {
    if (!currentUserPermissions.value) return
    TypedLocalStorage.set<CachedPermissionState>(getCacheKey(userId), {
      permissions: allPermissions.value,
      currentUserPermissions: currentUserPermissions.value,
    })
  }

  const restoreCurrentUserPermissionsCache = (userId: string) => {
    const cached = TypedLocalStorage.get<CachedPermissionState>(getCacheKey(userId))
    if (
      !cached?.currentUserPermissions ||
      cached.currentUserPermissions.userId !== userId ||
      !Array.isArray(cached.permissions)
    )
      return false
    allPermissions.value = cached.permissions
    currentUserPermissions.value = cached.currentUserPermissions
    currentPermissionUserId.value = userId
    return true
  }

  // ========== Computed ==========

  /** 当前用户的有效权限列表 */
  const effectivePermissions = computed<Permission[]>(() => {
    return currentUserPermissions.value?.effectivePermissions || []
  })

  /** 当前用户的组权限列表 */
  const groupPermissions = computed<Permission[]>(() => {
    return currentUserPermissions.value?.groupPermissions || []
  })

  /** 当前用户额外添加的权限 */
  const additionalPermissions = computed<Permission[]>(() => {
    return currentUserPermissions.value?.additionalPermissions || []
  })

  /** 当前用户移除的权限 */
  const removedPermissions = computed<Permission[]>(() => {
    return currentUserPermissions.value?.removedPermissions || []
  })

  /** 权限分类列表 */
  const permissionCategories = computed(() => {
    const categories = new Set<string>()
    allPermissions.value.forEach((perm) => categories.add(perm.category))
    return Array.from(categories)
  })

  // ========== Actions ==========

  /**
   * 加载所有可用权限列表
   */
  const loadAllPermissions = async () => {
    try {
      loading.value = true
      error.value = null
      const data = await permissionService.getAllPermissions()
      if (data) {
        allPermissions.value = data.data.permissions
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载权限列表失败'
      console.error('加载权限列表失败:', err)
    } finally {
      loading.value = false
    }
  }

  /**
   * 加载当前用户权限
   */
  const loadCurrentUserPermissions = async () => {
    const userInfoStore = useUserInfoStore()
    const userId: string | null = userInfoStore.userInfo.id || null

    if (!userId) {
      clearCurrentUserPermissions()
      console.warn('用户ID不存在，无法加载权限')
      return
    }

    if (currentPermissionUserId.value && currentPermissionUserId.value !== userId) {
      clearCurrentUserPermissions()
    }

    return loadUserPermissions(userId)
  }

  /**
   * 加载指定用户的权限
   */
  const loadUserPermissions = async (userId: string) => {
    try {
      loading.value = true
      error.value = null
      const data = await permissionService.getUserPermissions(userId)

      const currentUserId = useUserInfoStore().userInfo.id
      if (userId === currentUserId) {
        currentUserPermissions.value = data.data || null
        currentPermissionUserId.value = data.data ? userId : null
        if (data.data) saveCurrentUserPermissionsCache(userId)
      }

      return data
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载用户权限失败'
      console.error('加载用户权限失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 设置用户权限
   */
  const setUserPermissions = async (
    userId: string,
    permissionAdds?: Permission[],
    permissionRemoves?: Permission[],
  ) => {
    try {
      loading.value = true
      error.value = null
      const success = await permissionService.setUserPermissions(userId, {
        permissionAdds,
        permissionRemoves,
      })

      if (success) {
        // 尝试重新加载用户权限
        // 如果返回TOKEN_EXPIRED_DUE_TO_UPDATE，会在全局拦截器中处理
        try {
          await loadUserPermissions(userId)
        } catch (reloadErr) {
          // 权限已经设置成功，忽略重新加载的错误
          console.warn('权限设置成功，但重新加载权限失败:', reloadErr)
        }
      }

      return success
    } catch (err) {
      error.value = err instanceof Error ? err.message : '设置用户权限失败'
      console.error('设置用户权限失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 为用户添加额外权限
   */
  const addUserPermissions = async (userId: string, permissions: Permission[]) => {
    try {
      loading.value = true
      error.value = null
      const success = await permissionService.addUserPermissions(userId, { permissions })

      if (success) {
        await loadUserPermissions(userId)
      }

      return success
    } catch (err) {
      error.value = err instanceof Error ? err.message : '添加用户权限失败'
      console.error('添加用户权限失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 移除用户权限
   */
  const removeUserPermissions = async (userId: string, permissions: Permission[]) => {
    try {
      loading.value = true
      error.value = null
      const success = await permissionService.removeUserPermissions(userId, { permissions })

      if (success) {
        await loadUserPermissions(userId)
      }

      return success
    } catch (err) {
      error.value = err instanceof Error ? err.message : '移除用户权限失败'
      console.error('移除用户权限失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 清空用户的所有额外权限配置
   */
  const clearUserPermissions = async (userId: string) => {
    try {
      loading.value = true
      error.value = null
      const success = await permissionService.clearUserPermissions(userId)

      if (success) {
        await loadUserPermissions(userId)
      }

      return success
    } catch (err) {
      error.value = err instanceof Error ? err.message : '清空用户权限失败'
      console.error('清空用户权限失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 检查用户是否拥有指定权限
   */
  const checkUserPermissions = async (
    userId: string,
    permissions: Permission[],
  ): Promise<PermissionCheckResultDto | null> => {
    try {
      const result = await permissionService.checkPermissions({ userId, permissions })
      return result.data || null
    } catch (err) {
      console.error('检查用户权限失败:', err)
      return null
    }
  }

  /**
   * 检查当前用户是否拥有指定权限（本地检查）
   */
  const hasPermission = (permission: string): boolean => {
    return effectivePermissions.value.includes(permission as Permission)
  }

  /**
   * 检查当前用户是否拥有任意一个权限（本地检查）
   */
  const hasAnyPermission = (...permissions: string[]): boolean => {
    return permissions.some((perm) => hasPermission(perm as Permission))
  }

  /**
   * 检查当前用户是否拥有所有权限（本地检查）
   */
  const hasAllPermissions = (...permissions: string[]): boolean => {
    return permissions.every((perm) => hasPermission(perm as Permission))
  }

  /**
   * 获取用户组权限
   */
  const loadGroupPermissions = async (groupId: string) => {
    try {
      loading.value = true
      error.value = null
      const data = await permissionService.getGroupPermissions(groupId)
      return data?.data.permissions || []
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载用户组权限失败'
      console.error('加载用户组权限失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 设置用户组权限
   */
  const setGroupPermissions = async (groupId: string, permissions: Permission[]) => {
    try {
      loading.value = true
      error.value = null
      const success = await permissionService.setGroupPermissions(groupId, { permissions })
      return success
    } catch (err) {
      error.value = err instanceof Error ? err.message : '设置用户组权限失败'
      console.error('设置用户组权限失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 根据分类获取权限列表
   */
  const getPermissionsByCategory = (category: string) => {
    return allPermissions.value.filter((perm) => perm.category === category)
  }

  /**
   * 清空当前用户权限缓存
   */
  const clearCurrentUserPermissions = () => {
    currentUserPermissions.value = null
    currentPermissionUserId.value = null
  }

  /**
   * 重置错误状态
   */
  const clearError = () => {
    error.value = null
  }

  return {
    // State
    allPermissions,
    currentUserPermissions,
    loading,
    error,
    isLoaded,

    // Computed
    effectivePermissions,
    groupPermissions,
    additionalPermissions,
    removedPermissions,
    permissionCategories,

    // Actions - 权限查询
    loadAllPermissions,
    loadCurrentUserPermissions,
    loadUserPermissions,
    loadGroupPermissions,
    checkUserPermissions,

    // Actions - 权限检查（本地）
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,

    // Actions - 用户权限管理
    setUserPermissions,
    addUserPermissions,
    removeUserPermissions,
    clearUserPermissions,

    // Actions - 用户组权限管理
    setGroupPermissions,

    // Utilities
    getPermissionsByCategory,
    clearCurrentUserPermissions,
    restoreCurrentUserPermissionsCache,
    clearError,
  }
})
