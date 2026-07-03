import { useTopLoadingProgressStore } from '@/stores/topLoadingProgressStore'
import { MyAxios } from '@/stores/request'

const configureTopProgress = () => {
  const topLoadingProgressStore = useTopLoadingProgressStore()
  const taskWrapper = topLoadingProgressStore.wrapTask
  MyAxios.setDefaultOptions({ requestWrapper: taskWrapper })
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
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
