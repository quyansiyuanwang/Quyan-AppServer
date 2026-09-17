import { UPDATE_CHECK_POLICY as policy } from './loading-policy'
import { hasForegroundRequests } from '@/utils/foreground-activity'
import { i18ns } from '@/locales'
import { ElMessageBox } from '@/utils/elementPlusRuntime'
import { reloadDocument } from '@/service/navigationService'

export const extractEntryModule = (html: string): string | undefined => {
  const moduleScript = html.match(/<script\b[^>]*\btype=(["'])module\1[^>]*>/i)?.[0]
  return moduleScript?.match(/\bsrc=(["'])([^"']+)\1/i)?.[2]
}

let stopWatchDog: (() => void) | undefined

/** Serial, visibility-aware polling; failures never accumulate overlapping fetches. */
export const configureWatchDog = (): (() => void) => {
  if (stopWatchDog) return stopWatchDog
  let initialEntryModule = extractEntryModule(document.documentElement.outerHTML)
  let pendingEntryModule: string | undefined
  let pendingChecks = 0
  let intervalMs: number = policy.intervalMs
  let stopped = false
  let promptShown = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  const available = () =>
    !stopped && !promptShown && navigator.onLine !== false && document.visibilityState !== 'hidden'
  const schedule = () => {
    clearTimeout(timer)
    if (available()) timer = setTimeout(() => void check(), intervalMs)
  }
  const check = async () => {
    if (!available() || controller) return
    if (hasForegroundRequests()) {
      schedule()
      return
    }
    controller = new AbortController()
    const timeout = setTimeout(() => controller?.abort(), policy.requestTimeoutMs)
    try {
      const response = await fetch(import.meta.env.BASE_URL, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Unexpected index response: ${response.status}`)
      const entry = extractEntryModule(await response.text())
      if (!entry) throw new Error('Missing application entry')
      intervalMs = policy.intervalMs
      if (!initialEntryModule) initialEntryModule = entry
      if (entry === initialEntryModule) {
        pendingEntryModule = undefined
        pendingChecks = 0
      } else if (entry !== pendingEntryModule) {
        pendingEntryModule = entry
        pendingChecks = 1
      } else if (++pendingChecks >= policy.requiredConfirmations && available()) {
        promptShown = true
        void ElMessageBox.confirm(
          i18ns.t('watchdog.newVersionMessage'),
          i18ns.t('watchdog.newVersionTitle'),
          {
            confirmButtonText: i18ns.t('watchdog.refreshNow'),
            cancelButtonText: i18ns.t('watchdog.refreshLater'),
            type: 'info',
          },
        )
          .then(reloadDocument)
          .catch(() => undefined)
      }
    } catch {
      intervalMs = Math.min(intervalMs * policy.backoffMultiplier, policy.maxIntervalMs)
      pendingEntryModule = undefined
      pendingChecks = 0
    } finally {
      clearTimeout(timeout)
      controller = undefined
      schedule()
    }
  }
  const onAvailability = () => {
    if (!available()) {
      clearTimeout(timer)
      controller?.abort()
    } else schedule()
  }
  document.addEventListener('visibilitychange', onAvailability)
  window.addEventListener('online', onAvailability)
  window.addEventListener('offline', onAvailability)
  schedule()
  stopWatchDog = () => {
    stopped = true
    clearTimeout(timer)
    controller?.abort()
    document.removeEventListener('visibilitychange', onAvailability)
    window.removeEventListener('online', onAvailability)
    window.removeEventListener('offline', onAvailability)
    stopWatchDog = undefined
  }
  return stopWatchDog
}
