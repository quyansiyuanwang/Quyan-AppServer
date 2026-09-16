import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTopLoadingProgressStore } from '@/stores/topLoadingProgressStore'

describe('top loading progress store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not replay a completed animation when a new request starts during the finish delay', async () => {
    const store = useTopLoadingProgressStore()

    let resolveFirst: (() => void) | undefined
    const first = store.wrapTask(
      new Promise<void>((resolve) => {
        resolveFirst = resolve
      }),
    )
    await vi.advanceTimersByTimeAsync(100)
    resolveFirst?.()
    await first
    expect(store.progress).toBe(100)

    let resolveSecond: (() => void) | undefined
    const second = store.wrapTask(
      new Promise<void>((resolve) => {
        resolveSecond = resolve
      }),
    )
    await vi.advanceTimersByTimeAsync(300)
    expect(store.progress).toBe(100)

    resolveSecond?.()
    await second
    expect(store.progress).toBe(100)
  })
})
