// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import { installRoutePrefetch } from '@/router/route-prefetch'

const { preloadRouteViewComponentsMock } = vi.hoisted(() => ({
  preloadRouteViewComponentsMock: vi.fn(async () => undefined),
}))

vi.mock('@/router/domain-view-loader', () => ({
  preloadRouteViewComponents: preloadRouteViewComponentsMock,
}))

describe('route link prefetch', () => {
  let cleanup: (() => void) | undefined

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('preloads a same-origin destination on pointer intent', async () => {
    const resolved = { matched: [{}] }
    const router = {
      resolve: vi.fn(() => resolved),
    } as unknown as Router
    cleanup = installRoutePrefetch(router)
    document.body.innerHTML = '<a href="/dashboard?tab=usage">Dashboard</a>'

    document.querySelector('a')!.dispatchEvent(new Event('pointerenter', { bubbles: true }))

    expect(router.resolve).toHaveBeenCalledWith('/dashboard?tab=usage')
    expect(preloadRouteViewComponentsMock).toHaveBeenCalledWith(resolved)
  })

  it('does not preload external or new-window links', () => {
    const router = { resolve: vi.fn() } as unknown as Router
    cleanup = installRoutePrefetch(router)
    document.body.innerHTML =
      '<a href="https://example.com/docs">External</a><a href="/docs" target="_blank">Docs</a>'

    document.querySelectorAll('a').forEach((anchor) => {
      anchor.dispatchEvent(new Event('focusin', { bubbles: true }))
    })

    expect(router.resolve).not.toHaveBeenCalled()
    expect(preloadRouteViewComponentsMock).not.toHaveBeenCalled()
  })
})
