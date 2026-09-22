import { i18ns } from '@/locales'
import { CustomCode } from '@/constant/custom-code'

export interface ServiceResultLike {
  code?: number
  message?: string
  data?: unknown
}

export type ServiceError = Error & {
  code?: number
  data?: unknown
  response?: {
    data?: unknown
    status?: number
  }
  status?: number
  cause?: unknown
}

interface RequestCanceledErrorLike {
  name?: string
  code?: string
}

interface ValidationFieldErrorLike {
  code?: number
  data?: {
    field?: string
  }
}

const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isServiceResultLike = (value: unknown): value is ServiceResultLike => {
  if (!isObjectLike(value)) return false
  if ('code' in value && typeof value.code !== 'number' && typeof value.code !== 'undefined')
    return false
  if (
    'message' in value &&
    typeof value.message !== 'string' &&
    typeof value.message !== 'undefined'
  )
    return false
  return true
}

const isServiceError = (value: unknown): value is ServiceError => {
  return value instanceof Error && ('code' in value || 'data' in value || 'response' in value)
}

export const toServiceError = (
  source?: unknown,
  fallbackMessage: string = i18ns.t('requestErrors.failed'),
): ServiceError => {
  if (isServiceError(source)) return normalizeRequestError(source)

  if (source instanceof Error) {
    const error = source as ServiceError
    if (!error.response) {
      error.response = {
        data: undefined,
      }
    }
    return normalizeRequestError(error)
  }

  const result = isServiceResultLike(source) ? source : undefined

  const error = new Error(getErrorMessage(result, fallbackMessage)) as ServiceError
  userMessages.set(error, error.message)
  error.code = result?.code
  error.data = result?.data
  error.response = {
    data: result,
  }
  return error
}

const presentations = new WeakMap<object, 'global' | 'local' | 'silent'>()
export const setErrorPresentation = (
  error: object,
  presentation: 'global' | 'local' | 'silent',
): void => {
  presentations.set(error, presentation)
}
export const isSilentError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && presentations.get(error) === 'silent'
const userMessages = new WeakMap<object, string>()
const originalMessages = new WeakMap<object, string>()

/** Explicitly authored client-side business messages, never arbitrary runtime errors. */
export const createUserFacingError = (message: string): ServiceError => {
  const error = new Error(message)
  userMessages.set(error, message)
  return error
}

export const getErrorMessage = (
  source: unknown,
  fallbackMessage: string = i18ns.t('requestErrors.failed'),
): string => {
  if (!isObjectLike(source)) return fallbackMessage
  const response = isObjectLike(source.response) ? source.response : undefined
  const envelope = response?.data ?? (!(source instanceof Error) ? source : undefined)
  if (
    isObjectLike(envelope) &&
    typeof envelope.code === 'number' &&
    envelope.code !== CustomCode.OK &&
    typeof envelope.message === 'string' &&
    envelope.message.trim()
  ) {
    return envelope.message.trim()
  }
  const explicit = userMessages.get(source)
  if (explicit) return explicit
  if (source.code === 'ECONNABORTED' || source.code === 'ETIMEDOUT')
    return i18ns.t('requestErrors.timeout')
  if (source.code === 'ERR_NETWORK') {
    return i18ns.t(
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'requestErrors.offline'
        : 'requestErrors.network',
    )
  }
  const status = response?.status ?? source.status
  if (status === 401) return i18ns.t('requestErrors.unauthorized')
  if (status === 403) return i18ns.t('requestErrors.forbidden')
  if (status === 404) return i18ns.t('requestErrors.notFound')
  if (status === 429) return i18ns.t('requestErrors.rateLimited')
  if (typeof status === 'number' && status >= 500) return i18ns.t('requestErrors.server')
  return fallbackMessage
}

/** Keep Axios identity, config, response and string network codes intact. */
export const normalizeRequestError = <T extends Error>(error: T): T => {
  if (isRequestCanceled(error)) return error
  if (!originalMessages.has(error)) originalMessages.set(error, error.message)
  error.message = getErrorMessage(error)
  return error
}

export const getOriginalErrorMessage = (error: Error): string =>
  originalMessages.get(error) ?? error.message

export const isRequestCanceled = (error: unknown): boolean => {
  if (!isObjectLike(error)) return false

  const canceledError = error as RequestCanceledErrorLike
  return (
    canceledError.name === 'CanceledError' ||
    canceledError.name === 'AbortError' ||
    canceledError.code === 'ERR_CANCELED'
  )
}

export const isValidationFieldError = (
  error: ValidationFieldErrorLike | null | undefined,
  field: string,
): boolean => {
  return error?.code === CustomCode.VALIDATION_FAILED && error?.data?.field === field
}
