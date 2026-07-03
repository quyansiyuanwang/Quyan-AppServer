/**
 * 比较两个对象，返回只包含修改字段的对象
 * @param original 原始对象
 * @param current 当前对象
 * @returns 只包含修改字段的对象
 */
export function getObjectDiff<T extends Record<string, any>>(
  original: T,
  current: Partial<T>,
): Partial<T> {
  const diff: Partial<T> = {}

  for (const key in current) {
    const currentValue = current[key]

    if (currentValue === undefined) {
      continue // 跳过undefined值
    }

    if (key in original) {
      const originalValue = original[key]

      // 处理数组类型
      if (Array.isArray(originalValue) && Array.isArray(currentValue)) {
        if (JSON.stringify(originalValue) !== JSON.stringify(currentValue)) {
          diff[key] = currentValue
        }
      }
      // 处理对象类型
      else if (
        typeof originalValue === 'object' &&
        originalValue !== null &&
        typeof currentValue === 'object' &&
        currentValue !== null
      ) {
        if (JSON.stringify(originalValue) !== JSON.stringify(currentValue)) {
          diff[key] = currentValue
        }
      }
      // 处理基本类型
      else if (originalValue !== currentValue) {
        diff[key] = currentValue
      }
    } else {
      // 新增的字段
      diff[key] = currentValue
    }
  }

  return diff
}

/**
 * 深度比较两个对象是否相等
 * @param obj1 对象1
 * @param obj2 对象2
 * @returns 是否相等
 */
export function deepEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) return true

  if (obj1 == null || obj2 == null) return obj1 === obj2

  if (typeof obj1 !== typeof obj2) return false

  if (typeof obj1 !== 'object') return obj1 === obj2

  if (Array.isArray(obj1) !== Array.isArray(obj2)) return false

  const keys1 = Object.keys(obj1)
  const keys2 = Object.keys(obj2)

  if (keys1.length !== keys2.length) return false

  for (const key of keys1) {
    if (!keys2.includes(key)) return false
    if (!deepEqual(obj1[key], obj2[key])) return false
  }

  return true
}

/**
 * 获取对象的非空字段
 * @param obj 对象
 * @returns 只包含非空字段的对象
 */
export function getNonEmptyFields<T extends Record<string, any>>(obj: Partial<T>): Partial<T> {
  const result: Partial<T> = {}

  for (const key in obj) {
    const value = obj[key]
    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}
