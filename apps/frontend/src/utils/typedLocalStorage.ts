import { onBeforeUnmount, ref, watchEffect, type Ref } from 'vue'
import StorageKey from '@/constant/storagekey'
import type { DeepValues } from '@/types/common'

export type StorageLikeKey = DeepValues<typeof StorageKey> | string

export interface TypedStorageLike {
  get<T>(key: StorageLikeKey, defaultValue?: T): T | undefined
  set<T>(key: StorageLikeKey, value: T): void
  getItem(key: StorageLikeKey): string | null
  setItem(key: StorageLikeKey, value: string): void
  removeItem(key: StorageLikeKey): void
  remove(key: StorageLikeKey): void
  has(key: StorageLikeKey): boolean
}

const getStorage = (kind: 'local' | 'session'): Storage | null => {
  try {
    if (typeof window === 'undefined') return null
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export class TypedBrowserStorage implements TypedStorageLike {
  constructor(private readonly kind: 'local' | 'session') {}

  get<T>(key: StorageLikeKey, defaultValue?: T): T | undefined {
    const value = this.getItem(key)
    if (value == null) return defaultValue
    try {
      return JSON.parse(value) as T
    } catch {
      return defaultValue
    }
  }

  set<T>(key: StorageLikeKey, value: T): void {
    try {
      const serializedValue = JSON.stringify(value)
      if (serializedValue !== undefined) this.setItem(key, serializedValue)
    } catch {
      // JSON serialization and browser storage failures are intentionally non-fatal.
    }
  }

  getItem(key: StorageLikeKey): string | null {
    try {
      return getStorage(this.kind)?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  setItem(key: StorageLikeKey, value: string): void {
    try {
      getStorage(this.kind)?.setItem(key, value)
    } catch {
      // Storage can be unavailable in SSR and privacy-restricted browser contexts.
    }
  }

  removeItem(key: StorageLikeKey): void {
    try {
      getStorage(this.kind)?.removeItem(key)
    } catch {
      // Storage can be unavailable in SSR and privacy-restricted browser contexts.
    }
  }

  remove(key: StorageLikeKey): void {
    this.removeItem(key)
  }
  has(key: StorageLikeKey): boolean {
    return this.getItem(key) !== null
  }

  clear(): void {
    try {
      getStorage(this.kind)?.clear()
    } catch {
      // Storage can be unavailable in SSR and privacy-restricted browser contexts.
    }
  }

  get size(): number {
    try {
      return getStorage(this.kind)?.length ?? 0
    } catch {
      return 0
    }
  }

  key(index: number): string | null {
    try {
      return getStorage(this.kind)?.key(index) ?? null
    } catch {
      return null
    }
  }
}

/**
 * typedLocalStorage 工具类
 * 提供类型安全的 localStorage 操作
 */
export class TypedLocalStorage {
  private static readonly storage = new TypedBrowserStorage('local')
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
  static set<T>(key: StorageLikeKey, value: T): void {
    this.storage.set(key, value)
  }

  /**
   * 获取 localStorage 值
   * @param key localStorage 键名
   * @param defaultValue 默认值
   * @returns 存储的值或默认值
   */
  static get<T>(key: StorageLikeKey, defaultValue?: T): T | undefined {
    const storedValue = this.storage.getItem(key)
    if (storedValue == null) return defaultValue
    if (storedValue === 'null') return defaultValue === null ? (null as T) : defaultValue

    try {
      return JSON.parse(storedValue) as T
    } catch {
      return defaultValue
    }
  }

  /** 获取原始的 localStorage 值字符串
   *  @param key localStorage 键名
   *  @returns 存储的字符串值或 null
   */
  static getItem(key: StorageLikeKey): string | null {
    return this.storage.getItem(key)
  }

  /** 设置原始的 localStorage 值字符串
   *  @param key localStorage 键名
   *  @param value 要存储的字符串值
   */
  static setItem(key: StorageLikeKey, value: string): void {
    this.storage.setItem(key, value)
  }

  /**
   * 移除 localStorage 值
   * @param key localStorage 键名
   */
  static removeItem(key: StorageLikeKey): void {
    this.storage.removeItem(key)
  }

  /**
   * 移除 localStorage 值
   * @param key localStorage 键名
   */
  static remove(key: StorageLikeKey): void {
    this.storage.removeItem(key)
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
    const validPrefixes = [
      StorageKey.Easter.PASSIVE_CONFIG_PREFIX,
      ...Array.from(validKeys).map((key) => `${key}::`),
    ]

    // 遍历 localStorage 并删除无效键
    for (let i = this.size - 1; i >= 0; i--) {
      const key = this.key(i)
      if (key && !validKeys.has(key) && !validPrefixes.some((prefix) => key.startsWith(prefix))) {
        this.removeItem(key)
      }
    }
  }

  /**
   * 清除所有 localStorage 数据
   */
  static clear(): void {
    this.storage.clear()
  }

  /**
   * 检查 localStorage 中是否存在指定键
   * @param key localStorage 键名
   */
  static has(key: StorageLikeKey): boolean {
    return this.storage.has(key)
  }

  /**
   * 获取 localStorage 中所有键的数量
   */
  static get size(): number {
    return this.storage.size
  }

  /**
   * 获取 localStorage 中指定索引的键名
   * @param index 索引位置
   */
  static key(index: number): string | null {
    return this.storage.key(index)
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
