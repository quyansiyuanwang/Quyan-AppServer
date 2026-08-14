// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mountMock = vi.fn()
const ensureSessionMock = vi.fn(async () => null)
const installRoutesMock = vi.fn(async () => undefined)

vi.mock('vue', () => ({ createApp: vi.fn(() => ({ use: vi.fn(), mount: mountMock, config: {} })) }))
vi.mock('pinia', () => ({ createPinia: vi.fn(() => ({})) }))
vi.mock('@/router', () => ({
  default: { resolve: vi.fn(() => ({ matched: [{ meta: { allowGuest: true } }] })) },
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
    ensureSession: ensureSessionMock,
    hydrateUserAndPermissions: vi.fn(async () => undefined),
  },
}))

describe('AppRuntime', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('starts once and does not probe a guest route session', async () => {
    const { AppRuntime } = await import('@/app-runtime')
    const runtime = new AppRuntime()
    await Promise.all([runtime.start(), runtime.start()])

    expect(installRoutesMock).toHaveBeenCalledTimes(1)
    expect(mountMock).toHaveBeenCalledTimes(1)
    expect(ensureSessionMock).not.toHaveBeenCalled()
    expect(runtime.getPhase()).toBe('running')
  })
})
