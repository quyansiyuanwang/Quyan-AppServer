// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Router } from 'vue-router'
import { ROUTE_PREFETCH_POLICY as policy } from '@/config/loading-policy'
import { installRoutePrefetch } from '@/router/route-prefetch'
import { resetRouteAccess } from '@/router/route-access'
import { useSessionStore } from '@/stores/sessionStore'
import { trackForegroundRequest } from '@/utils/foreground-activity'

const { preload } = vi.hoisted(() => ({ preload: vi.fn(async (_route: unknown) => undefined) }))
vi.mock('@/router/domain-view-loader', () => ({ preloadRouteViewComponents: preload }))
vi.mock('@/config/site-registry', () => ({ isKnownSiteProfile: () => false }))
let cleanup: (() => void) | undefined
let afterNavigation: (
  to: { name: string; fullPath: string },
  from?: unknown,
  failure?: unknown,
) => void
let beforeNavigation: () => void
const route = (name: string) => ({
  name,
  path: '/' + name,
  fullPath: '/' + name,
  matched: [{ name, meta: { allowGuest: true }, components: {} }],
})
const makeRouter = () => ({
  resolve: vi.fn((target: string | { name: string }) =>
    route(typeof target === 'string' ? target.slice(1) : target.name),
  ),
  hasRoute: () => true,
  currentRoute: { value: route('current') },
  beforeEach: vi.fn((callback) => {
    beforeNavigation = callback
    return vi.fn()
  }),
  afterEach: vi.fn((callback) => {
    afterNavigation = callback
    return vi.fn()
  }),
  onError: vi.fn(() => vi.fn()),
})
const install = () => {
  const router = makeRouter()
  cleanup = installRoutePrefetch(router as unknown as Router, { id: 'rejected' } as never)
  afterNavigation({ name: 'current', fullPath: '/current' })
  return router
}
beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  resetRouteAccess()
  preload.mockReset().mockResolvedValue(undefined)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})
describe('route prefetch scheduler', () => {
  it('warms menu buttons and links after sustained pointer intent', async () => {
    install()
    document.body.innerHTML =
      '<button data-route-name="dashboard">Dashboard</button><a href="/docs">Docs</a>'
    document.querySelector('button')!.dispatchEvent(new Event('pointerover', { bubbles: true }))
    expect(preload).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(policy.hoverDelayMs)
    expect(preload).toHaveBeenCalledWith(expect.objectContaining({ name: 'dashboard' }))
    document.querySelector('a')!.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(preload).toHaveBeenCalledWith(expect.objectContaining({ name: 'docs' }))
  })
  it('ignores new-window, download and unregistered external links', () => {
    install()
    document.body.innerHTML =
      '<a href="https://example.com/docs">External</a><a href="/docs" target="_blank">New</a><a href="/file" download>Download</a>'
    document
      .querySelectorAll('a')
      .forEach((anchor) => anchor.dispatchEvent(new Event('focusin', { bubbles: true })))
    expect(preload).not.toHaveBeenCalled()
  })
  it('limits concurrent speculative targets and deduplicates running targets', async () => {
    install()
    const resolves: (() => void)[] = []
    preload.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolves.push(resolve)
        }),
    )
    document.body.innerHTML = ['one', 'two', 'three']
      .map((name) => `<button data-route-name="${name}">${name}</button>`)
      .join('')
    const buttons = document.querySelectorAll('button')
    buttons.forEach((button) => button.dispatchEvent(new Event('focusin', { bubbles: true })))
    buttons[0]!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(preload).toHaveBeenCalledTimes(2)
    resolves[0]!()
    await Promise.resolve()
    await Promise.resolve()
    expect(preload).toHaveBeenCalledTimes(3)
    resolves.slice(1).forEach((resolve) => resolve())
  })
  it('waits for foreground requests and actual navigation', async () => {
    install()
    let resolve!: () => void
    const foreground = trackForegroundRequest(
      new Promise<void>((done) => {
        resolve = done
      }),
    )
    document.body.innerHTML = '<button data-route-name="one">One</button>'
    document.querySelector('button')!.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(preload).not.toHaveBeenCalled()
    resolve()
    await foreground
    expect(preload).toHaveBeenCalledOnce()
    beforeNavigation()
    document.body.innerHTML = '<button data-route-name="two">Two</button>'
    document.querySelector('button')!.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(preload).toHaveBeenCalledOnce()
    afterNavigation({ name: 'next', fullPath: '/next' })
    expect(preload).toHaveBeenCalledTimes(2)
  })
  it('does not preload a protected target for an anonymous session', () => {
    const router = install()
    router.resolve.mockReturnValue({
      ...route('protected'),
      matched: [{ name: 'protected', meta: {} as never, components: {} }],
    })
    useSessionStore().setAnonymous()
    document.body.innerHTML = '<button data-route-name="protected">Protected</button>'
    document.querySelector('button')!.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(preload).not.toHaveBeenCalled()
  })
  it('does not start work while the document is hidden', () => {
    install()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.body.innerHTML = '<button data-route-name="one">One</button>'
    document.querySelector('button')!.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(preload).not.toHaveBeenCalled()
  })
})
