import { onBeforeUnmount, ref, watchEffect, type Ref } from 'vue'
import StorageKey from '@/constant/storagekey'
import type { DeepValues } from '@/types/common'

type StorageLikeKey = DeepValues<typeof StorageKey> | string

/**
 * typedLocalStorage 工具类
 * 提供类型安全的 localStorage 操作
 */
export class TypedLocalStorage {
  /**
   * 深拷贝对象
   * 需要存到 localStorage 中的值, 不存在循环引用
   */
  static copy<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj))
  }

  /**
   * 设置 localStorage 值
   * @param key localStorage 键名
   * @param value 要存储的值
   */
  static set(key: StorageLikeKey, value: any): void {
    localStorage.setItem(key, JSON.stringify(value))
  }

  /**
   * 获取 localStorage 值
   * @param key localStorage 键名
   * @param defaultValue 默认值
   * @returns 存储的值或默认值
   */
  static get<T>(key: StorageLikeKey, defaultValue?: T): T | undefined {
    const storedValue = localStorage.getItem(key)
    if (!storedValue) return defaultValue

    // Handle null explicitly
    if (storedValue === 'null') {
      if (defaultValue === null) return null as T
      return defaultValue
    }

    // Check if stored value is JSON object/array
    const trimmed = storedValue.trim()
    return JSON.parse(trimmed)
  }

  /** 获取原始的 localStorage 值字符串
   *  @param key localStorage 键名
   *  @returns 存储的字符串值或 null
   */
  static getItem(key: StorageLikeKey): string | null {
    return localStorage.getItem(key)
  }

  /** 设置原始的 localStorage 值字符串
   *  @param key localStorage 键名
   *  @param value 要存储的字符串值
   */
  static setItem(key: StorageLikeKey, value: string): void {
    localStorage.setItem(key, value)
  }

  /**
   * 移除 localStorage 值
   * @param key localStorage 键名
   */
  static removeItem(key: StorageLikeKey): void {
    localStorage.removeItem(key)
  }

  /**
   * 移除 localStorage 值
   * @param key localStorage 键名
   */
  static remove(key: StorageLikeKey): void {
    localStorage.removeItem(key)
  }

  /**
   * 清除所有未在 StorageKey 中定义的 localStorage 键
   */
  static cleanUnused(): void {
    const validKeys = new Set<string>()

    // 收集所有有效的 StorageKey 键
    const collectKeys = (obj: any) => {
      for (const key in obj) {
        const value = obj[key]
        if (typeof value === 'string') {
          validKeys.add(value)
        } else if (typeof value === 'object') {
          collectKeys(value)
        }
      }
    }
    collectKeys(StorageKey)

    // 遍历 localStorage 并删除无效键
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && !validKeys.has(key)) {
        localStorage.removeItem(key)
      }
    }
  }

  /**
   * 清除所有 localStorage 数据
   */
  static clear(): void {
    localStorage.clear()
  }

  /**
   * 检查 localStorage 中是否存在指定键
   * @param key localStorage 键名
   */
  static has(key: StorageLikeKey): boolean {
    return localStorage.getItem(key) !== null
  }

  /**
   * 获取 localStorage 中所有键的数量
   */
  static get size(): number {
    return localStorage.length
  }

  /**
   * 获取 localStorage 中指定索引的键名
   * @param index 索引位置
   */
  static key(index: number): string | null {
    return localStorage.key(index)
  }

  static ref<T, K extends DeepValues<typeof StorageKey>>(
    key: K | string,
    defaultValueHandle: T | (() => T),
  ): {
    data: Ref<T>
    clear: () => void
  } {
    // 从 localStorage 读取初始值
    const getInitialValue = (): T | undefined => {
      return TypedLocalStorage.get(
        key,
        isFunction(defaultValueHandle) ? defaultValueHandle() : defaultValueHandle,
      )
    }

    // 创建响应式引用
    const data = ref<T>(getInitialValue()!) as Ref<T>

    // 监听变化并写入 localStorage
    const stopHandle = watchEffect(() => {
      TypedLocalStorage.set(key, data.value)
    })
    onBeforeUnmount(stopHandle)

    /**
     * 清除 localStorage 中的数据并重置为默认值
     */
    const clear = () => {
      TypedLocalStorage.remove(key)
      data.value = isFunction(defaultValueHandle)
        ? defaultValueHandle()
        : TypedLocalStorage.copy(defaultValueHandle)
    }

    return {
      data,
      clear,
    }
  }
}

// 辅助函数，类型谓词
function isFunction<T>(value: T | (() => T)): value is () => T {
  return typeof value === 'function'
}
