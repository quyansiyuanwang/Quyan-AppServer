import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTopLoadingProgressStore } from '@/stores/topLoadingProgressStore'

const createDeferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('top loading progress store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides the progress bar after the completion delay', async () => {
    const store = useTopLoadingProgressStore()
    const task = createDeferred()

    const wrapped = store.wrapTask(task.promise)
    await vi.advanceTimersByTimeAsync(100)
    task.resolve()
    await wrapped

    expect(store.progress).toBe(100)
    expect(store.isVisible).toBe(true)

    await vi.advanceTimersByTimeAsync(299)
    expect(store.progress).toBe(100)

    await vi.advanceTimersByTimeAsync(1)
    expect(store.progress).toBe(-1)
    expect(store.isVisible).toBe(false)
    expect(store.getTaskCount()).toBe(0)
  })

  it('does not replay a completed animation when a new request starts during the finish delay', async () => {
    const store = useTopLoadingProgressStore()

    const first = createDeferred()
    const firstWrapped = store.wrapTask(first.promise)
    await vi.advanceTimersByTimeAsync(100)
    first.resolve()
    await firstWrapped
    expect(store.progress).toBe(100)

    const second = createDeferred()
    const secondWrapped = store.wrapTask(second.promise)
    await vi.advanceTimersByTimeAsync(300)
    expect(store.progress).toBe(100)

    second.resolve()
    await secondWrapped
    expect(store.progress).toBe(100)

    await vi.advanceTimersByTimeAsync(300)
    expect(store.progress).toBe(-1)
    expect(store.isVisible).toBe(false)
  })

  it('waits for the last overlapping request before hiding', async () => {
    const store = useTopLoadingProgressStore()
    const first = createDeferred()
    const second = createDeferred()

    const firstWrapped = store.wrapTask(first.promise)
    const secondWrapped = store.wrapTask(second.promise)
    await vi.advanceTimersByTimeAsync(100)

    first.resolve()
    await firstWrapped
    expect(store.progress).toBeLessThan(100)
    expect(store.getTaskCount()).toBe(2)

    second.resolve()
    await secondWrapped
    expect(store.progress).toBe(100)

    await vi.advanceTimersByTimeAsync(300)
    expect(store.progress).toBe(-1)
    expect(store.isVisible).toBe(false)
  })

  it('clears progress when a request fails', async () => {
    const store = useTopLoadingProgressStore()
    const task = createDeferred()

    const wrapped = store.wrapTask(task.promise)
    await vi.advanceTimersByTimeAsync(100)
    task.reject(new Error('request failed'))
    await expect(wrapped).rejects.toThrow('request failed')

    expect(store.progress).toBe(-1)
    expect(store.isVisible).toBe(false)
    expect(store.getTaskCount()).toBe(0)
  })
})
