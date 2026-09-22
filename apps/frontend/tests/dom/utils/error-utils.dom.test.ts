// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AxiosError, CanceledError } from 'axios'
import {
  getErrorMessage,
  normalizeRequestError,
  getOriginalErrorMessage,
  createUserFacingError,
  setErrorPresentation,
} from '@/utils/error-utils'
import { configureRequestErrorNotifier, showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { i18ns } from '@/locales'

describe('safe error presentation', () => {
  const notify = vi.fn()
  beforeEach(() => {
    notify.mockClear()
    configureRequestErrorNotifier(notify)
  })
  it('prefers a localized envelope while retaining Axios identity and codes', () => {
    const error = new AxiosError('Request failed with status code 422', 'ERR_BAD_REQUEST')
    error.response = { status: 422, data: { code: 1001, message: '请输入正确的邮箱' } } as never
    expect(normalizeRequestError(error)).toBe(error)
    expect(error.message).toBe('请输入正确的邮箱')
    expect(error.code).toBe('ERR_BAD_REQUEST')
    expect(error.response.status).toBe(422)
    expect(getOriginalErrorMessage(error)).toBe('Request failed with status code 422')
  })
  it('does not display raw errors or proxy HTML', () => {
    expect(getErrorMessage(new Error('SQL internal detail'), 'fallback')).toBe('fallback')
    expect(getErrorMessage({ response: { data: '<html>bad gateway</html>' } }, 'fallback')).toBe(
      'fallback',
    )
    expect(getErrorMessage({ code: 0, message: 'Success' }, 'fallback')).toBe('fallback')
    expect(getErrorMessage({ message: 'untrusted text' }, 'fallback')).toBe('fallback')
    expect(getErrorMessage({ code: 5, message: '  ' }, 'fallback')).toBe('fallback')
    expect(getErrorMessage(createUserFacingError('Explicit validation'))).toBe(
      'Explicit validation',
    )
  })
  it('localizes transport failure and preserves cancellation', () => {
    const timeout = new AxiosError('timeout of 1000ms exceeded', 'ECONNABORTED')
    expect(normalizeRequestError(timeout).message).toBe(i18ns.t('requestErrors.timeout'))
    expect(timeout.code).toBe('ECONNABORTED')
    const canceled = new CanceledError('canceled')
    expect(normalizeRequestError(canceled).message).toBe('canceled')
    showRequestErrorNotice(canceled)
    expect(notify).not.toHaveBeenCalled()
  })
  it('notifies once for the same error even if a page has a different fallback', () => {
    const error = new Error('opaque internal error')
    showRequestErrorNotice(error, 'first localized fallback')
    showRequestErrorNotice(error, 'second localized fallback')
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

it('suppresses silent errors even when a page tries to notify', () => {
  const notify = vi.fn()
  configureRequestErrorNotifier(notify)
  const error = new Error('background failure')
  setErrorPresentation(error, 'silent')
  showRequestErrorNotice(error)
  expect(notify).not.toHaveBeenCalled()
})
