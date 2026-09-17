import { afterEach, describe, expect, it, vi } from 'vitest'
import { SESSION_RECOVERY_POLICY as policy } from '@/config/loading-policy'
import {
  classifyRecoveryFailure,
  recoverSessionOperation,
  SessionRestoreError,
} from '@/utils/session-recovery'

const context = () => ({
  signal: new AbortController().signal,
  deadline: Date.now() + policy.totalTimeoutMs,
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('bounded session recovery', () => {
  it('retries transient reads at most twice', async () => {
    vi.useFakeTimers()
    const task = vi
      .fn()
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ code: 'ERR_NETWORK' })
      .mockResolvedValue('ready')
    const promise = recoverSessionOperation('permissions', task, context())
    await vi.runAllTimersAsync()
    expect(await promise).toBe('ready')
    expect(task).toHaveBeenCalledTimes(3)
  })
  it.each([401, 403, 400, 429])('does not retry HTTP %s', async (status) => {
    const task = vi.fn().mockRejectedValue({ response: { status } })
    await expect(recoverSessionOperation('refresh', task, context())).rejects.toBeInstanceOf(
      SessionRestoreError,
    )
    expect(task).toHaveBeenCalledOnce()
  })
  it('bounds hanging attempts and cancels their signals', async () => {
    vi.useFakeTimers()
    const started = Date.now()
    const signals: AbortSignal[] = []
    const task = vi.fn(({ signal }) => {
      signals.push(signal)
      return new Promise(() => undefined)
    })
    const promise = recoverSessionOperation('refresh', task, context())
    const assertion = expect(promise).rejects.toMatchObject({ kind: 'transient' })
    await vi.runAllTimersAsync()
    await assertion
    expect(Date.now() - started).toBe(policy.totalTimeoutMs)
    expect(task).toHaveBeenCalledTimes(3)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })
  it('cancels pending recovery without retry', async () => {
    const controller = new AbortController()
    const task = vi.fn(() => new Promise(() => undefined))
    const promise = recoverSessionOperation('profile', task, {
      signal: controller.signal,
      deadline: Date.now() + policy.totalTimeoutMs,
    })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(task).toHaveBeenCalledOnce()
  })
  it('does not issue requests offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const task = vi.fn()
    await expect(recoverSessionOperation('refresh', task, context())).rejects.toMatchObject({
      kind: 'offline',
    })
    expect(task).not.toHaveBeenCalled()
    expect(classifyRecoveryFailure({ response: { status: 401 } })).toBe('unauthorized')
  })
})
