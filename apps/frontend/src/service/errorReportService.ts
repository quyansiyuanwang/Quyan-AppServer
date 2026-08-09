import { createErrorReportControllerApi } from '@/client/services/error-report-controller.gen'
import { useRequestStore } from '@/stores/request'
import StorageKey from '@/constant/storagekey'
import { TypedSessionStorage } from '@/utils/typedSessionStorage'
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
const QUEUE_MAX_ITEMS = 20
const QUEUE_MAX_ITEM_BYTES = 12_000
const QUEUE_MAX_BYTES = 64_000
const REPORT_BATCH_ENDPOINT = '/v1/error-reports/client/batch'
const REPORT_BATCH_SIZE = 10
const KEEPALIVE_BATCH_SIZE = 5
const REPORT_FLUSH_DELAY_MS = 30_000
const SENSITIVE_KEY =
  /(token|password|secret|cookie|authorization|api[-_]?key|access[-_]?key|credential|private[-_]?key)/i
let flushPromise: Promise<void> | null = null
let keepalivePromise: Promise<void> | null = null
let reporterInstalled = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

type QueuedReport = { id: string; payload: ClientErrorPayload }

const redactText = (value: string, maxLength: number): string =>
  value
    .replace(
      /\b(?:authorization|cookie|set-cookie|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)\b\s*[:=]\s*[^\s,;]+/gi,
      (match) => `${match.split(/[:=]/, 1)[0]}=[redacted]`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .slice(0, maxLength)

const truncateValue = (value: unknown, depth = 0): unknown => {
  if (depth > 4) return '[depth-limited]'
  if (typeof value === 'string') return redactText(value, 4000)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => truncateValue(item, depth + 1))

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 50)
      .map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[redacted]' : truncateValue(item, depth + 1),
      ]),
  )
}

const normalizePayload = (payload: ClientErrorPayload): ClientErrorPayload => ({
  errorType: redactText(String(payload.errorType || 'Error'), 120),
  message: redactText(String(payload.message || 'Unknown error'), 4000),
  route: payload.route ? redactText(payload.route, 1024) : undefined,
  severity: payload.severity,
  requestId: payload.requestId?.slice(0, 128),
  httpMethod: payload.httpMethod?.slice(0, 12),
  httpStatus: payload.httpStatus,
  clientVersion: payload.clientVersion?.slice(0, 128),
  stack: payload.stack ? redactText(payload.stack, 8000) : undefined,
  context: payload.context
    ? (truncateValue(payload.context) as Record<string, unknown>)
    : undefined,
})

const readQueue = (): QueuedReport[] => {
  try {
    const raw = TypedSessionStorage.getItem(StorageKey.Util.ERROR_REPORT_QUEUE)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is QueuedReport =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as QueuedReport).id === 'string' &&
        Boolean((entry as QueuedReport).payload),
    )
  } catch {
    return []
  }
}

const writeQueue = (queue: QueuedReport[]): void => {
  try {
    if (queue.length === 0) {
      TypedSessionStorage.removeItem(StorageKey.Util.ERROR_REPORT_QUEUE)
      return
    }

    const limited = queue.slice(-QUEUE_MAX_ITEMS)
    while (limited.length > 0) {
      const serialized = JSON.stringify(limited)
      if (serialized.length <= QUEUE_MAX_BYTES) {
        TypedSessionStorage.setItem(StorageKey.Util.ERROR_REPORT_QUEUE, serialized)
        return
      }
      limited.shift()
    }
    TypedSessionStorage.removeItem(StorageKey.Util.ERROR_REPORT_QUEUE)
  } catch {
    // Storage quota and private browsing failures must never affect the app.
  }
}

const enqueue = (payload: ClientErrorPayload): void => {
  try {
    const entry: QueuedReport = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      payload,
    }
    if (JSON.stringify(entry).length > QUEUE_MAX_ITEM_BYTES) return
    writeQueue([...readQueue(), entry])
  } catch {
    // A non-serializable context is simply omitted from the queue.
  }
}

const scheduleFlush = (delay = REPORT_FLUSH_DELAY_MS): void => {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushPendingReports()
  }, delay)
}

const flushPendingReports = async (keepalive = false): Promise<void> => {
  if (keepalive) {
    if (keepalivePromise) return keepalivePromise

    keepalivePromise = (async () => {
      const entries = readQueue().slice(0, KEEPALIVE_BATCH_SIZE)
      if (entries.length === 0) return
      const sent = await useRequestStore()
        .getAxios()
        .postKeepalive(REPORT_BATCH_ENDPOINT, { reports: entries.map((entry) => entry.payload) })
      if (sent) {
        const sentIds = new Set(entries.map((entry) => entry.id))
        writeQueue(readQueue().filter((entry) => !sentIds.has(entry.id)))
      }
    })().finally(() => {
      keepalivePromise = null
    })
    return keepalivePromise
  }

  if (flushPromise) return flushPromise

  flushPromise = (async () => {
    const entries = readQueue().slice(0, REPORT_BATCH_SIZE)
    if (entries.length === 0) return

    try {
      await errorReportApi.reportClientErrorBatch(
        { body: { reports: entries.map((entry) => entry.payload) } },
        { retry: false, skipProgressBar: true },
      )
      const sentIds = new Set(entries.map((entry) => entry.id))
      writeQueue(readQueue().filter((entry) => !sentIds.has(entry.id)))
      if (readQueue().length > 0) scheduleFlush()
    } catch {
      scheduleFlush()
    }
  })().finally(() => {
    flushPromise = null
  })

  return flushPromise
}

const fingerprint = (payload: ClientErrorPayload) =>
  `${payload.errorType}:${payload.message.slice(0, 240)}:${payload.route || ''}`

export const reportClientError = async (payload: ClientErrorPayload): Promise<void> => {
  const safePayload = normalizePayload(payload)
  const key = fingerprint(safePayload)
  const now = Date.now()
  if ((reportedFingerprints.get(key) || 0) > now - 60_000) return
  reportedFingerprints.set(key, now)
  if (reportedFingerprints.size > 100) {
    for (const [knownKey, timestamp] of reportedFingerprints) {
      if (timestamp < now - 60_000) reportedFingerprints.delete(knownKey)
    }
  }

  enqueue(safePayload)
  if (readQueue().length >= REPORT_BATCH_SIZE) void flushPendingReports()
  else scheduleFlush()
}

export const installErrorReporter = () => {
  if (reporterInstalled || typeof window === 'undefined') return
  reporterInstalled = true

  if (readQueue().length >= REPORT_BATCH_SIZE) void flushPendingReports()
  else scheduleFlush()

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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPendingReports()
  })

  const flushOnPageExit = () => {
    // Keepalive is best effort. Failed sends remain in the browser-session queue.
    void flushPendingReports(true)
  }
  window.addEventListener('pagehide', flushOnPageExit)
  window.addEventListener('beforeunload', flushOnPageExit)
}

export { flushPendingReports }

export const errorReportService = {
  listGroups: async (params: Record<string, unknown>) =>
    (await errorReportApi.listGroups({ params: params as any })).data,
  getGroup: async (id: string) => (await errorReportApi.getGroup({ path: { id } })).data,
  listOccurrences: async (id: string, params: Record<string, unknown>) =>
    (await errorReportApi.listOccurrences({ path: { id }, params: params as any })).data,
  updateStatus: async (id: string, resolutionStatus: string) =>
    (await errorReportApi.updateStatus({ path: { id }, body: { resolutionStatus } as any })).data,
}
