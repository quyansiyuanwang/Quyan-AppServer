// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StorageKey from '@/constant/storagekey'

const reportClientErrorMock = vi.fn()
const reportClientErrorBatchMock = vi.fn()
const postKeepaliveMock = vi.fn()

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

  it('tries a keepalive upload when the page is being discarded', async () => {
    postKeepaliveMock.mockResolvedValue(true)
    const { installErrorReporter, reportClientError } = await import('@/service/errorReportService')

    await reportClientError({ errorType: 'Error', message: 'Pending report' })
    installErrorReporter()
    window.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => {
      expect(postKeepaliveMock).toHaveBeenCalledWith(
        '/v1/error-reports/client/batch',
        expect.objectContaining({
          reports: [expect.objectContaining({ message: 'Pending report' })],
        }),
      )
    })
    expect(sessionStorage.getItem(StorageKey.Util.ERROR_REPORT_QUEUE)).toBeNull()
  })
})
