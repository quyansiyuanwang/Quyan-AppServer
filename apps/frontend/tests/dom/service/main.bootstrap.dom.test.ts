// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mountMock = vi.fn()
const restoreProtectedSessionMock = vi.fn(async () => null)
const preloadRouteViewComponentsMock = vi.fn(async () => undefined)
const guestRoute = () => ({
  path: '/',
  fullPath: '/',
  query: {},
  meta: { allowGuest: true },
  matched: [{ meta: { allowGuest: true } }],
})
const resolveMock = vi.fn(guestRoute)
const installRoutesMock = vi.fn(async () => undefined)
const routerReadyMock = vi.fn(async () => undefined)
const installSessionExpiryRedirectMock = vi.fn()
const isNavigationFailureMock = vi.fn(() => false)

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    isNavigationFailure: isNavigationFailureMock,
  }
})

vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue')>()),
  createApp: vi.fn(() => ({ use: vi.fn(), mount: mountMock, config: {} })),
}))
vi.mock('pinia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('pinia')>()),
  createPinia: vi.fn(() => ({})),
  setActivePinia: vi.fn(),
}))
vi.mock('@/router', () => ({
  default: {
    resolve: resolveMock,
    isReady: routerReadyMock,
  },
  currentSiteProfile: { id: 'public' },
  installProfileRoutes: installRoutesMock,
}))
vi.mock('@/config/site-registry', () => ({ isKnownSiteProfile: () => true }))
vi.mock('@/app-roots/load-profile-app', () => ({ loadProfileApp: vi.fn(async () => ({})) }))
vi.mock('@/locales', () => ({
  i18ns: { plugin: {} },
  initializeI18n: vi.fn(async () => undefined),
}))
vi.mock('@/config', () => ({ configureAll: vi.fn() }))
vi.mock('@/service/errorReportService', () => ({
  installErrorReporter: vi.fn(),
  reportClientError: vi.fn(),
}))
vi.mock('@/stores/request', () => ({ clearLegacyAuthStorage: vi.fn() }))
vi.mock('@/service/sessionCoordinator', () => ({
  sessionCoordinator: {
    restoreProtectedSession: restoreProtectedSessionMock,
  },
}))
vi.mock('@/router/domain-view-loader', () => ({
  preloadRouteViewComponents: preloadRouteViewComponentsMock,
}))
vi.mock('@/service/sessionExpiryRedirectService', () => ({
  installSessionExpiryRedirect: installSessionExpiryRedirectMock,
}))

/**
 * 这些用例在 `vi.resetModules()` 后动态 import `@/app-runtime`，该模块依赖图很大；
 * 整套并行运行时首次求值可能远超 vitest 默认的 5s。超时会留下仍在飞行的 `start()`，
 * 污染后续用例的 mock 调用计数（曾表现为 routerReady 被调用 3 次而非 1 次）。
 * 因此显式放宽：慢的是模块求值，不是被测逻辑（隔离运行每例约 0.5s）。
 */
const MODULE_EVAL_TIMEOUT_MS = 30_000

describe('AppRuntime', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    isNavigationFailureMock.mockReturnValue(false)
    resolveMock.mockReturnValue(guestRoute())
  })

  it(
    'starts once and does not probe a guest route session',
    async () => {
      const { AppRuntime } = await import('@/app-runtime')
      const runtime = new AppRuntime()
      await Promise.all([runtime.start(), runtime.start()])

      expect(installRoutesMock).toHaveBeenCalledTimes(1)
      expect(routerReadyMock).toHaveBeenCalledTimes(1)
      expect(mountMock).toHaveBeenCalledTimes(1)
      expect(installSessionExpiryRedirectMock).toHaveBeenCalledTimes(1)
      expect(restoreProtectedSessionMock).not.toHaveBeenCalled()
      expect(preloadRouteViewComponentsMock).toHaveBeenCalledOnce()
      expect(runtime.getPhase()).toBe('running')
    },
    MODULE_EVAL_TIMEOUT_MS,
  )

  it(
    'starts protected session restoration and route preloading before router readiness',
    async () => {
      resolveMock.mockReturnValue({
        path: '/dashboard',
        fullPath: '/dashboard',
        query: {},
        meta: {},
        matched: [{ meta: {} }],
      })

      const { AppRuntime } = await import('@/app-runtime')
      const runtime = new AppRuntime()
      await runtime.start()

      expect(restoreProtectedSessionMock).toHaveBeenCalledOnce()
      expect(preloadRouteViewComponentsMock).toHaveBeenCalledOnce()
    },
    MODULE_EVAL_TIMEOUT_MS,
  )

  it(
    'waits for the initial route to settle before mounting the application shell',
    async () => {
      let resolveInitialRoute: (() => void) | undefined
      routerReadyMock.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveInitialRoute = resolve
          }),
      )

      const { AppRuntime } = await import('@/app-runtime')
      const runtime = new AppRuntime()
      const starting = runtime.start()

      await vi.waitFor(() => expect(routerReadyMock).toHaveBeenCalledOnce())
      expect(mountMock).not.toHaveBeenCalled()

      resolveInitialRoute?.()
      await starting

      expect(mountMock).toHaveBeenCalledOnce()
    },
    MODULE_EVAL_TIMEOUT_MS,
  )

  it(
    'warms root code but mounts only the access boundary when route access is denied',
    async () => {
      const { loadProfileApp } = await import('@/app-roots/load-profile-app')
      const { denyRouteAccess } = await import('@/router/route-access')
      denyRouteAccess('/settings/profile', 'user:read')
      routerReadyMock.mockRejectedValueOnce(new Error('navigation aborted'))
      isNavigationFailureMock.mockReturnValueOnce(true)

      const { AppRuntime } = await import('@/app-runtime')
      const runtime = new AppRuntime()
      await runtime.start()

      expect(mountMock).toHaveBeenCalledOnce()
      expect(loadProfileApp).toHaveBeenCalledOnce()
    },
    MODULE_EVAL_TIMEOUT_MS,
  )

  it(
    'does not mount while a cross-origin login redirect is in progress',
    async () => {
      const { markRouteRedirecting } = await import('@/router/route-access')
      markRouteRedirecting('/settings/profile')
      routerReadyMock.mockRejectedValueOnce(new Error('navigation aborted'))
      isNavigationFailureMock.mockReturnValueOnce(true)

      const { AppRuntime } = await import('@/app-runtime')
      const runtime = new AppRuntime()
      await runtime.start()

      expect(mountMock).not.toHaveBeenCalled()
    },
    MODULE_EVAL_TIMEOUT_MS,
  )
})
