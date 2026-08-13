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
  // Vite already owns reload/HMR in development. Deployment version checks only
  // apply to immutable production assets and must never initiate local reloads.
  if (import.meta.env.DEV) return

  const startWatchDog = () => {
    void import('./auto-update')
      .then(({ configureWatchDog }) => {
        configureWatchDog()
      })
      .catch((error) => {
        console.warn('[config] Failed to initialize update watchdog:', error)
      })
  }

  scheduleAfterLoad(startWatchDog, 4000, 8000)
}

export function configureAll() {
  configureTopProgress()
  scheduleWatchDog()
}
