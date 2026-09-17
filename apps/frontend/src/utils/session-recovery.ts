import { AxiosError, HttpStatusCode } from 'axios'
import { SESSION_RECOVERY_POLICY as policy } from '@/config/loading-policy'
import { isRequestCanceled } from './error-utils'

export type RecoveryStage = 'refresh' | 'profile' | 'permissions'
export type RecoveryFailureKind =
  | 'transient'
  | 'offline'
  | 'unauthorized'
  | 'forbidden'
  | 'canceled'
  | 'unexpected'

export const classifyRecoveryFailure = (error: unknown): RecoveryFailureKind => {
  const candidate = error as {
    originalError?: unknown
    cause?: unknown
    response?: { status?: number }
    status?: number
    code?: string
  }
  if (candidate?.originalError) return classifyRecoveryFailure(candidate.originalError)
  if (isRequestCanceled(error)) return 'canceled'
  const status = candidate?.response?.status ?? candidate?.status
  if (status === HttpStatusCode.Unauthorized) return 'unauthorized'
  if (status === HttpStatusCode.Forbidden) return 'forbidden'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  if (
    policy.transientStatuses.some((value) => value === Number(status)) ||
    [AxiosError.ERR_NETWORK, AxiosError.ECONNABORTED, AxiosError.ETIMEDOUT].includes(
      candidate?.code ?? '',
    )
  )
    return 'transient'
  return 'unexpected'
}

export const canceledRecovery = () =>
  Object.assign(new Error('Session recovery superseded'), {
    name: 'AbortError',
    code: AxiosError.ERR_CANCELED,
  })
const timedOut = () =>
  Object.assign(new Error('Session recovery timed out'), { code: AxiosError.ECONNABORTED })

export class SessionRestoreError extends Error {
  readonly kind: RecoveryFailureKind
  constructor(
    readonly originalError: unknown,
    readonly stage: RecoveryStage = 'refresh',
    readonly attempts = 1,
  ) {
    super(`Unable to restore the session (${stage})`)
    this.name = 'SessionRestoreError'
    this.kind = classifyRecoveryFailure(originalError)
  }
}

export const createSessionRecoveryDeadline = () => Date.now() + policy.totalTimeoutMs

/** Only session restoration/read operations use this policy, never arbitrary writes. */
export const recoverSessionOperation = async <T>(
  stage: RecoveryStage,
  task: (options: { signal: AbortSignal; timeout: number }) => Promise<T>,
  options: { signal: AbortSignal; deadline: number },
): Promise<T> => {
  const { signal, deadline } = options
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw canceledRecovery()
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new SessionRestoreError(timedOut(), stage, attempt)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new SessionRestoreError(
        Object.assign(new Error('Offline'), { code: AxiosError.ERR_NETWORK }),
        stage,
        attempt,
      )
    }
    const controller = new AbortController()
    const timeout = Math.min(policy.attemptTimeoutMs, remaining)
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: () => void = () => undefined
    try {
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => {
          controller.abort()
          reject(canceledRecovery())
        }
        signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => {
          reject(timedOut())
          controller.abort()
        }, timeout)
      })
      return await Promise.race([task({ signal: controller.signal, timeout }), interrupted])
    } catch (error) {
      if (signal.aborted || classifyRecoveryFailure(error) === 'canceled') throw canceledRecovery()
      if (
        attempt >= policy.retryDelaysMs.length ||
        classifyRecoveryFailure(error) !== 'transient' ||
        Date.now() >= deadline
      ) {
        throw new SessionRestoreError(error, stage, attempt + 1)
      }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
    const delay = Math.min(
      policy.retryDelaysMs[attempt]! * (1 + (Math.random() * 2 - 1) * policy.jitterRatio),
      Math.max(0, deadline - Date.now()),
    )
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        reject(canceledRecovery())
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, delay)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        signal.removeEventListener('abort', onAbort)
        onAbort()
      }
    })
  }
}
