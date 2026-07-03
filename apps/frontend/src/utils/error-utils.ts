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
  }
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
  fallbackMessage: string = 'Unknown error',
): ServiceError => {
  if (isServiceError(source)) return source

  if (source instanceof Error) {
    const error = source as ServiceError
    if (!error.response) {
      error.response = {
        data: undefined,
      }
    }
    return error
  }

  const result = isServiceResultLike(source) ? source : undefined

  const error = new Error(result?.message || fallbackMessage) as ServiceError
  error.code = result?.code
  error.data = result?.data
  error.response = {
    data: result,
  }
  return error
}

export const getErrorMessage = (source: unknown, fallbackMessage: string): string => {
  if (source instanceof Error && source.message) return source.message
  if (isObjectLike(source) && typeof source.message === 'string' && source.message.length > 0)
    return source.message
  return fallbackMessage
}

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
