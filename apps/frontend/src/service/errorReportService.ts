import { createErrorReportControllerApi } from '@/client/services/error-report-controller.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'

export type ClientErrorPayload = {
  errorType: string
  message: string
  route?: string
  severity?: 'error' | 'fatal' | 'warning'
  requestId?: string
  httpMethod?: string
  httpStatus?: number
  clientVersion?: string
  stack?: string
  context?: Record<string, unknown>
}

const errorReportApi = cacheObject(() =>
  createErrorReportControllerApi(useRequestStore().getAxios()),
)
const reportedFingerprints = new Map<string, number>()
let reporting = false

const fingerprint = (payload: ClientErrorPayload) =>
  `${payload.errorType}:${payload.message.slice(0, 240)}:${payload.route || ''}`

export const reportClientError = async (payload: ClientErrorPayload): Promise<void> => {
  if (reporting) return
  const key = fingerprint(payload)
  const now = Date.now()
  if ((reportedFingerprints.get(key) || 0) > now - 60_000) return
  reportedFingerprints.set(key, now)
  if (reportedFingerprints.size > 100) {
    for (const [knownKey, timestamp] of reportedFingerprints) {
      if (timestamp < now - 60_000) reportedFingerprints.delete(knownKey)
    }
  }

  reporting = true
  try {
    await errorReportApi.reportClientError(
      { body: payload },
      { retry: false, skipProgressBar: true },
    )
  } catch {
    // Reporting must never interfere with the original user action.
  } finally {
    reporting = false
  }
}

export const installErrorReporter = () => {
  window.addEventListener('error', (event) => {
    const error = event.error instanceof Error ? event.error : null
    void reportClientError({
      errorType: error?.name || 'WindowError',
      message: error?.message || event.message || 'Unknown browser error',
      route: window.location.pathname,
      severity: 'error',
      stack: error?.stack,
      context: { filename: event.filename, line: event.lineno, column: event.colno },
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason : null
    void reportClientError({
      errorType: reason?.name || 'UnhandledRejection',
      message: reason?.message || String(event.reason || 'Unhandled promise rejection'),
      route: window.location.pathname,
      severity: 'error',
      stack: reason?.stack,
    })
  })
}

export const errorReportService = {
  listGroups: async (params: Record<string, unknown>) =>
    (await errorReportApi.listGroups({ params: params as any })).data,
  getGroup: async (id: string) => (await errorReportApi.getGroup({ path: { id } })).data,
  listOccurrences: async (id: string, params: Record<string, unknown>) =>
    (await errorReportApi.listOccurrences({ path: { id }, params: params as any })).data,
  updateStatus: async (id: string, resolutionStatus: string) =>
    (await errorReportApi.updateStatus({ path: { id }, body: { resolutionStatus } as any })).data,
}
