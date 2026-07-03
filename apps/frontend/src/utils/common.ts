import type { StrictObj } from '@/types/common'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import { copyTextWithFallback } from '@/utils/clipboard'
import { watch, type Ref } from 'vue'

export const format = <S extends string>(str: S, obj: StrictObj<S>) => {
  return str.replace(/{(\w+)}/g, (_, key) => obj[key as keyof StrictObj<S>])
}

export const cache = <T>(factory: () => T): (() => T) => {
  let initialized = false
  let value: T

  return () => {
    if (!initialized) {
      value = factory()
      initialized = true
    }

    return value
  }
}

export const cacheObject = <T extends object>(factory: () => T): T => {
  const getValue = cache(factory)

  return new Proxy({} as T, {
    get(_target, property, receiver) {
      return Reflect.get(getValue(), property, receiver)
    },
    set(_target, property, value, receiver) {
      return Reflect.set(getValue(), property, value, receiver)
    },
    has(_target, property) {
      return property in getValue()
    },
    ownKeys() {
      return Reflect.ownKeys(getValue())
    },
    getOwnPropertyDescriptor(_target, property) {
      return Object.getOwnPropertyDescriptor(getValue(), property)
    },
  })
}

export const copyToClipboard = async (text: string, showMsg: boolean = true) => {
  try {
    const copied = await copyTextWithFallback(text)
    if (!copied) {
      if (showMsg) ElMessage.error(i18ns.t('message.error.copyFailed'))
      return
    }
    if (showMsg) ElMessage.success(i18ns.t('message.information.copiedToClipboard'))
  } catch (error) {
    console.error('复制失败:', error)
    if (showMsg) ElMessage.error(i18ns.t('message.error.copyFailed'))
  }
}

export const untilLoaded = <T>(
  ref: Ref<T>,
  checkFn: (arg0: Ref<T>) => boolean,
  timeoutMs: number = 30000,
) => {
  return new Promise<void>((resolve, reject) => {
    if (checkFn(ref)) {
      resolve()
      return
    }

    let timeout: ReturnType<typeof setTimeout> | null = null

    const cleanup = (shouldReject = false) => {
      stop()
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      if (shouldReject) reject(new Error('untilLoaded timeout'))
    }

    const stop = watch(ref, () => {
      if (checkFn(ref)) {
        cleanup()
        resolve()
      }
    })

    if (timeoutMs > 0) timeout = setTimeout(() => cleanup(true), timeoutMs)
  })
}

export const omitStr = (str: string, maxLength: number): string => {
  if (str.length <= maxLength) {
    return str
  }
  const half = Math.floor((maxLength - 3) / 2)
  return `${str.slice(0, half)}...${str.slice(str.length - half)}`
}
