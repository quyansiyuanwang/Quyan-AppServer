import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { UserDto } from '@/client/types.gen'
import { UserInfo as DefaultUserInfo } from '@/constant/model'
import StorageKey from '@/constant/storagekey'
import { TypedLocalStorage } from '@/utils/typedLocalStorage'
import { getScopedStorageKey } from '@/utils/storageScope'

/**
 * 用户信息 Store
 * 提供用户信息的响应式状态和操作方法
 * 数据持久化到 localStorage，遵循单向数据流原则
 */
export const useUserInfoStore = defineStore('userInfo', () => {
  // State
  const userInfo = ref<UserDto>({ ...DefaultUserInfo })
  const isUserInfoFetched = ref<boolean>(false)

  const getUserInfoStorageKey = () => getScopedStorageKey(StorageKey.User.INFO)

  // 辅助函数：从 localStorage 读取
  const loadFromStorage = (): UserDto | null => {
    try {
      const parsed = TypedLocalStorage.get(getUserInfoStorageKey(), DefaultUserInfo)
      if (!parsed) return null

      if (checkTypesMatch(parsed, DefaultUserInfo)) {
        userInfo.value = parsed
        return parsed
      }
      return null
    } catch (e) {
      console.warn(`Error parsing userInfo from localStorage.`, e)
      return null
    }
  }

  const fetchUserInfo = async () => {
    const result = await import('@/service/userService').then(({ userService }) => {
      return userService.getMe()
    })
    setUserInfo(result)
    isUserInfoFetched.value = true
  }

  // 辅助函数：保存到 localStorage
  const saveToStorage = (value: UserDto) => {
    try {
      TypedLocalStorage.set(getUserInfoStorageKey(), value)
    } catch (e) {
      console.error(`Failed to save userInfo to localStorage.`, e)
    }
  }

  // 辅助函数：深拷贝
  const copy = (obj: any) => {
    return JSON.parse(JSON.stringify(obj))
  }

  // 辅助函数：类型检查
  const checkTypesMatch = (nowValue: any, defaultValue: any): boolean => {
    if (defaultValue === null) {
      return nowValue === null || typeof nowValue === 'object'
    } else if (defaultValue === undefined) {
      return true
    } else if (nowValue === null || nowValue === undefined) {
      return false
    }

    if (typeof nowValue !== typeof defaultValue) {
      return false
    }

    if (typeof nowValue !== 'object') {
      return true
    }

    if (Array.isArray(nowValue) || Array.isArray(defaultValue)) {
      if (!Array.isArray(nowValue) || !Array.isArray(defaultValue)) {
        return false
      }
      if (nowValue.length === 0 || defaultValue.length === 0) {
        return true
      }
      return checkTypesMatch(nowValue[0], defaultValue[0])
    }

    const keys1 = Object.keys(nowValue)
    const keys2 = Object.keys(defaultValue)

    for (const key of keys2) {
      if (!keys1.includes(key)) {
        return false
      }
      if (!checkTypesMatch(nowValue[key], defaultValue[key])) {
        return false
      }
    }

    return true
  }

  // 监听变化并持久化
  watch(
    () => userInfo.value,
    (newValue) => {
      saveToStorage(newValue)
    },
    { deep: true },
  )

  // Actions - 遵循单向数据流，所有修改通过 action 进行
  const setUserInfo = (newInfo: Partial<UserDto>) => {
    userInfo.value = { ...userInfo.value, ...newInfo }
  }

  const setUsername = (username: string) => {
    userInfo.value.username = username
  }

  const setName = (name: string | null) => {
    userInfo.value.name = name
  }

  const setEmail = (email: string | null) => {
    userInfo.value.email = email
  }

  const setGroupId = (groupId: string | undefined) => {
    userInfo.value.groupId = groupId
  }

  const setStatus = (status: number | undefined) => {
    userInfo.value.status = status
  }

  const clear = () => {
    TypedLocalStorage.remove(getUserInfoStorageKey())
    userInfo.value = copy(DefaultUserInfo)
    isUserInfoFetched.value = false
  }

  const reset = () => {
    userInfo.value = { ...DefaultUserInfo }
  }

  // Getters
  const getUsername = () => userInfo.value.username
  const getName = () => userInfo.value.name
  const getEmail = () => userInfo.value.email
  const getGroupId = () => userInfo.value.groupId
  const getStatus = () => userInfo.value.status

  // 检查是否已登录
  const isLoggedIn = () => {
    return !!userInfo.value.username && !!userInfo.value.id
  }

  // 检查用户信息是否已获取
  const hasUserInfoFetched = () => isUserInfoFetched.value

  const init = async () => {
    await fetchUserInfo()
  }

  return {
    // State
    userInfo,
    isUserInfoFetched,
    // Actions
    init,
    fetchUserInfo,
    loadFromStorage,
    setUserInfo,
    setUsername,
    setName,
    setEmail,
    setGroupId,
    setStatus,
    clear,
    reset,
    // Getters
    getUsername,
    getName,
    getEmail,
    getGroupId,
    getStatus,
    hasUserInfoFetched,
    // Utilities
    isLoggedIn,
  }
})
