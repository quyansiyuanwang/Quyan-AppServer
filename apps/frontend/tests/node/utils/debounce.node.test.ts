import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { conditionDebounce, debounce, debounceRef, lineTimeDebounce } from '@/utils/debounce'

describe('debounce utils', () => {
  it('conditionDebounce executes immediately when condition is false', async () => {
    const fn = vi.fn((value: number) => value + 1)
    const wrapped = conditionDebounce(fn, 100, () => false)

    await expect(wrapped(1)).resolves.toBe(2)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('debounce executes after delay', async () => {
    vi.useFakeTimers()
    const fn = vi.fn((value: string) => `${value}-done`)
    const wrapped = debounce(fn, 200)

    const resultPromise = wrapped('job')
    expect(fn).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)

    await expect(resultPromise).resolves.toBe('job-done')
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('debounceRef updates after delay', async () => {
    vi.useFakeTimers()
    const valueRef = debounceRef('a', 100)

    valueRef.value = 'b'
    expect(valueRef.value).toBe('a')

    await vi.advanceTimersByTimeAsync(100)
    await nextTick()

    expect(valueRef.value).toBe('b')
    vi.useRealTimers()
  })

  it('lineTimeDebounce triggers delayed call when slope is greater than threshold', async () => {
    vi.useFakeTimers()
    vi.spyOn(Date, 'now').mockReturnValueOnce(1).mockReturnValueOnce(2)

    const fn = vi.fn((value: number) => value)
    const wrapped = lineTimeDebounce(fn, 100, (v) => v, 0.5)

    const resultPromise = wrapped(10)
    expect(fn).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    await expect(resultPromise).resolves.toBe(10)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('lineTimeDebounce resolves immediately when reverse condition is not satisfied', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000)

    const fn = vi.fn((value: number) => value + 1)
    const wrapped = lineTimeDebounce(fn, 100, (v) => v, 0.0005, true)

    await expect(wrapped(1)).resolves.toBe(2)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
