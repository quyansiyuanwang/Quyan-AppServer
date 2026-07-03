import { toServiceError, type ServiceError, type ServiceResultLike } from '@/utils/error-utils'

export type { ServiceError, ServiceResultLike }

export const createServiceError = (
  result?: ServiceResultLike,
  fallbackMessage: string = 'Unknown error',
): ServiceError => {
  return toServiceError(result, fallbackMessage)
}
