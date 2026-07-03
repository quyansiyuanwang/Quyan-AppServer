import { customRef, type Ref } from 'vue'

/**
 * 条件防抖函数, 只有当条件函数返回 true 时才会触发防抖
 * @param fn 被防抖函数
 * @param delay 延迟时间
 * @param condition 条件函数
 * @returns
 */
export const conditionDebounce = <T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
  condition: (...args: Parameters<T>) => boolean,
) => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return new Promise((resolve) => {
      const resolveFn = () => resolve(fn(...args))
      const shouldTriggerDebounce = condition(...args)

      clearTimeout(timeout)
      if (shouldTriggerDebounce) timeout = setTimeout(resolveFn, delay)
      else resolveFn()
    })
  }
}

/**
 * 时间线防抖函数, 模型 f = kx + b
 * dx = fx(...args), 当 dx / dt > slope 时, 触发防抖, reverse 反转比较逻辑
 * @param fn 被防抖函数
 * @param delay 延迟
 * @param fx 新值计算函数
 * @param slope 阈值斜率
 * @param reverse 反转逻辑
 * @returns
 */
export const lineTimeDebounce = <T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
  fx: (...args: Parameters<T>) => number,
  slope: number,
  reverse: boolean = false,
) => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let lastTriggerTime = 0
  let lastFxVal = 0
  return (...args: Parameters<T>) => {
    return new Promise((resolve) => {
      const resolveFn = () => resolve(fn(...args))

      const now = Date.now()
      const thisFnVal = fx(...args)
      const k = Math.abs(thisFnVal - lastFxVal) / (now - lastTriggerTime)

      clearTimeout(timeout)
      if (reverse ? k < slope : k > slope) timeout = setTimeout(resolveFn, delay)
      else resolveFn()

      lastTriggerTime = now
      lastFxVal = thisFnVal
    })
  }
}

/**
 * 简单防抖函数
 * 使用: debounce(fn, delay)(...args)
 * @param fn 被防抖函数
 * @param delay 延迟
 * @returns
 */
export const debounce = <T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): ((...args: Parameters<T>) => Promise<ReturnType<T>>) => {
  return conditionDebounce(fn, delay, () => true)
}

export const debounceRef = <T>(value: T, delay: number) => {
  const debouncedValue: Ref<T, T> = customRef((track, trigger) => {
    let timeout: ReturnType<typeof setTimeout>
    return {
      get: () => {
        track()
        return value
      },
      set: (newValue) => {
        clearTimeout(timeout)
        timeout = setTimeout(() => {
          value = newValue
          trigger()
        }, delay)
      },
    }
  })
  return debouncedValue
}
