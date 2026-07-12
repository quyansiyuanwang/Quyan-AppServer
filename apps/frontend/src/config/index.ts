import { useTopLoadingProgressStore } from '@/stores/topLoadingProgressStore'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
}

const scheduleAfterLoad = (task: () => void, delay: number, timeout: number) => {
  const scheduleTask = () => {
    const idleWindow = window as IdleWindow

    setTimeout(() => {
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.requestIdleCallback(task, { timeout })
        return
      }

      task()
    }, delay)
  }

  if (document.readyState === 'complete') {
    scheduleTask()
    return
  }

  window.addEventListener('load', scheduleTask, { once: true })
}

const configureTopProgress = () => {
  const topLoadingProgressStore = useTopLoadingProgressStore()
  const taskWrapper = topLoadingProgressStore.wrapTask

  scheduleAfterLoad(
    () => {
      void import('@/stores/request')
        .then(({ MyAxios }) => {
          MyAxios.setDefaultOptions({ requestWrapper: taskWrapper })
        })
        .catch((error) => {
          console.warn('[config] Failed to initialize request progress wrapper:', error)
        })
    },
    800,
    4000,
  )
}

const scheduleWatchDog = () => {
  const startWatchDog = () => {
    void import('./auto-update').then(({ configureWatchDog }) => {
      configureWatchDog()
    })
  }

  const scheduleAfterLoad = () => {
    const idleWindow = window as IdleWindow

    // Push update-checking logic out of the first-screen critical path.
    setTimeout(() => {
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.requestIdleCallback(startWatchDog, { timeout: 8000 })
        return
      }
      startWatchDog()
    }, 4000)
  }

  if (document.readyState === 'complete') {
    scheduleAfterLoad()
    return
  }

  window.addEventListener('load', scheduleAfterLoad, { once: true })
}

export function configureAll() {
  configureTopProgress()
  scheduleWatchDog()
}
