// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_CHECK_POLICY as policy } from '@/config/loading-policy'
import { configureWatchDog, extractEntryModule } from '@/config/auto-update'

describe('auto update entry detection', () => {
  it('reads the hashed application entry from a production document', () => {
    expect(
      extractEntryModule(
        '<script type="module" crossorigin src="/assets/index-Bpx9wg7P.js"></script>',
      ),
    ).toBe('/assets/index-Bpx9wg7P.js')
  })

  it('does not treat module preloads as the application entry', () => {
    expect(
      extractEntryModule(
        '<link rel="modulepreload" href="/assets/framework-D9m5x5OM.js"><script type="module" src="/assets/index-Bpx9wg7P.js"></script>',
      ),
    ).toBe('/assets/index-Bpx9wg7P.js')
  })

  it('rejects documents without a module entry', () => {
    expect(extractEntryModule('<script src="/assets/index.js"></script>')).toBeUndefined()
  })
})

describe('serial update polling', () => {
  let stop: (() => void) | undefined
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.head.innerHTML = '<script type="module" src="/assets/index-current.js"></script>'
  })
  afterEach(() => {
    stop?.()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  it('does not poll immediately or overlap a slow request', async () => {
    const fetch = vi.fn(() => new Promise(() => undefined))
    vi.stubGlobal('fetch', fetch)
    stop = configureWatchDog()
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(policy.intervalMs)
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(policy.intervalMs * 3)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('pauses hidden tabs and resumes on a serial timer', async () => {
    const fetch = vi.fn(
      async () => new Response('<script type="module" src="/assets/index-current.js"></script>'),
    )
    vi.stubGlobal('fetch', fetch)
    stop = configureWatchDog()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(policy.intervalMs * 3)
    expect(fetch).not.toHaveBeenCalled()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(policy.intervalMs)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
