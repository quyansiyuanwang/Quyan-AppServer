// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'
import { preloadRouteViewComponents } from '@/router/domain-view-loader'

const createRoute = (
  loader: () => Promise<unknown>,
): RouteLocationNormalized =>
  ({
    matched: [{ components: { default: loader } }],
  }) as unknown as RouteLocationNormalized

describe('route view preloading', () => {
  it('deduplicates concurrent preloads and reuses the resolved module cache', async () => {
    const loader = vi.fn(async () => ({ default: {} }))
    const route = createRoute(loader)

    await Promise.all([preloadRouteViewComponents(route), preloadRouteViewComponents(route)])
    await preloadRouteViewComponents(route)

    expect(loader).toHaveBeenCalledOnce()
  })

  it('allows a failed preload to be retried by the router', async () => {
    const loader = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ default: {} })
    const route = createRoute(loader)

    await expect(preloadRouteViewComponents(route)).resolves.toBeUndefined()
    await expect(preloadRouteViewComponents(route)).resolves.toBeUndefined()

    expect(loader).toHaveBeenCalledTimes(2)
  })
})
