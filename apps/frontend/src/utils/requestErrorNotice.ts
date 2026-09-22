import { getErrorMessage, isRequestCanceled, isSilentError } from './error-utils'
import { i18ns } from '@/locales'

const ERROR_NOTICE_DEDUPE_MS = 1_500
const recentErrorNotices = new Map<string, number>()
const notifiedErrors = new WeakSet<object>()
const pendingNotices: string[] = []

type RequestErrorNotifier = (title: string, message: string) => void
let requestErrorNotifier: RequestErrorNotifier | null = null

export const configureRequestErrorNotifier = (notifier: RequestErrorNotifier): void => {
  requestErrorNotifier = notifier
  while (pendingNotices.length > 0) {
    const message = pendingNotices.shift()
    if (message) notifier(i18ns.t('error'), message)
  }
}

export const showRequestErrorNotice = (
  source: unknown,
  fallbackMessage: string = i18ns.t('loadFailed'),
): void => {
  if (isRequestCanceled(source) || isSilentError(source)) return
  if (typeof source === 'object' && source !== null) {
    if (notifiedErrors.has(source)) return
    notifiedErrors.add(source)
  }
  const rawMessage = typeof source === 'string' ? source : getErrorMessage(source, fallbackMessage)
  const message = String(rawMessage || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
  const visibleMessage = message || fallbackMessage
  const now = Date.now()

  if ((recentErrorNotices.get(visibleMessage) || 0) > now - ERROR_NOTICE_DEDUPE_MS) return
  recentErrorNotices.set(visibleMessage, now)
  if (recentErrorNotices.size > 100) {
    for (const [knownMessage, timestamp] of recentErrorNotices) {
      if (timestamp < now - ERROR_NOTICE_DEDUPE_MS) recentErrorNotices.delete(knownMessage)
    }
  }

  if (requestErrorNotifier) {
    requestErrorNotifier(i18ns.t('error'), visibleMessage)
    return
  }

  // The application can fail before optional UI plugins finish loading. Keep a
  // bounded queue and flush it when the notifier is installed.
  pendingNotices.push(visibleMessage)
  if (pendingNotices.length > 3) pendingNotices.splice(0, pendingNotices.length - 3)
}
