// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StorageKey from '@/constant/storagekey'

const reportClientErrorMock = vi.fn()
const reportClientErrorBatchMock = vi.fn()
const postKeepaliveMock = vi.fn()
const notifyMock = vi.fn()

vi.mock('@/utils/common', () => ({
  cacheObject: <T>(factory: () => T) => factory(),
}))

vi.mock('@/client/services/error-report-controller.gen', () => ({
  createErrorReportControllerApi: () => ({
    reportClientError: reportClientErrorMock,
    reportClientErrorBatch: reportClientErrorBatchMock,
  }),
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: () => ({ postKeepalive: postKeepaliveMock }),
  }),
}))

describe('error report service lifecycle queue', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('keeps a failed report locally and removes it after a later successful flush', async () => {
    reportClientErrorBatchMock.mockRejectedValueOnce(new Error('offline'))
    const { flushPendingReports, reportClientError } = await import('@/service/errorReportService')

    await reportClientError({
      errorType: 'TypeError',
      message: 'Network failed',
      context: { accessToken: 'must-not-be-stored', retryCount: 1 },
    })

    await flushPendingReports()

    const queued = sessionStorage.getItem(StorageKey.Util.ERROR_REPORT_QUEUE)
    expect(queued).toContain('[redacted]')
    expect(queued).not.toContain('must-not-be-stored')

    reportClientErrorBatchMock.mockResolvedValueOnce({ code: 0 })
    await flushPendingReports()

    expect(sessionStorage.getItem(StorageKey.Util.ERROR_REPORT_QUEUE)).toBeNull()
  })

  it('shows one global notice for an unhandled rejection and keeps uploading it', async () => {
    postKeepaliveMock.mockResolvedValue(true)
    const { installErrorReporter, reportClientError } = await import('@/service/errorReportService')
    const { configureRequestErrorNotifier } = await import('@/utils/requestErrorNotice')
    configureRequestErrorNotifier((title, message) => notifyMock(title, message))

    await reportClientError({ errorType: 'Error', message: 'Pending report' })
    installErrorReporter()

    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', { value: new Error('Unexpected failure') })
    window.dispatchEvent(rejection)
    window.dispatchEvent(rejection)

    await vi.waitFor(() => {
      expect(notifyMock).toHaveBeenCalledTimes(1)
      expect(notifyMock).not.toHaveBeenCalledWith(expect.any(String), 'Unexpected failure')
    })

    window.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => {
      expect(postKeepaliveMock).toHaveBeenCalledWith(
        '/v1/error-reports/client/batch',
        expect.objectContaining({
          reports: expect.arrayContaining([
            expect.objectContaining({ message: 'Pending report' }),
            expect.objectContaining({ message: 'Unexpected failure' }),
          ]),
        }),
      )
    })
    expect(sessionStorage.getItem(StorageKey.Util.ERROR_REPORT_QUEUE)).toBeNull()
  })

  it('ignores benign ResizeObserver loop notifications', async () => {
    const { installErrorReporter, reportClientError } = await import('@/service/errorReportService')
    const { configureRequestErrorNotifier } = await import('@/utils/requestErrorNotice')
    configureRequestErrorNotifier((title, message) => notifyMock(title, message))
    installErrorReporter()

    const message = 'ResizeObserver loop completed with undelivered notifications.'
    const event = new Event('error')
    Object.defineProperty(event, 'message', { value: message })
    Object.defineProperty(event, 'error', { value: new Error(message) })
    window.dispatchEvent(event)
    await reportClientError({ errorType: 'Error', message })

    expect(notifyMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(StorageKey.Util.ERROR_REPORT_QUEUE)).toBeNull()
  })
})
