import { beforeEach, describe, expect, it, vi } from 'vitest'
import StorageKey from '@/constant/storagekey'

const hydrateMock = vi.fn()
const clearSessionMock = vi.fn()
const registerExpiryHandlerOnRestoreMock = vi.fn()
const bootstrapSessionMock = vi.fn(async () => null)
const setCurrentStorageScopeForUserIdMock = vi.fn()
const resetCurrentStorageScopeMock = vi.fn()
const useMock = vi.fn()
const mountMock = vi.fn()
const directiveMock = vi.fn()
const queueBusinessRoutePreloadMock = vi.fn()

vi.mock('vue', () => ({
  createApp: vi.fn(() => ({
    use: useMock,
    mount: mountMock,
    directive: directiveMock,
  })),
}))

vi.mock('pinia', () => ({
  createPinia: vi.fn(() => ({ __pinia: true })),
}))

vi.mock('@/App.vue', () => ({
  default: {},
}))

vi.mock('@/router', () => ({
  default: { __router: true },
}))

vi.mock('@/router/preload', () => ({
  queueBusinessRoutePreload: queueBusinessRoutePreloadMock,
}))

vi.mock('@/locales', () => ({
  i18ns: { plugin: { __i18n: true } },
  initializeI18n: vi.fn(async () => undefined),
}))

vi.mock('@/config', () => ({
  configureAll: vi.fn(),
}))

vi.mock('@/events', () => ({
  registerAllEvents: vi.fn(),
}))

vi.mock('@/stores/impersonationStore', () => ({
  useImpersonationStore: () => ({
    hydrate: hydrateMock,
    clearSession: clearSessionMock,
    sessionInfo: { targetUserId: 'target-user-1' },
    isImpersonating: true,
  }),
}))

vi.mock('@/utils/storageScope', () => ({
  setCurrentStorageScopeForUserId: setCurrentStorageScopeForUserIdMock,
  resetCurrentStorageScope: resetCurrentStorageScopeMock,
}))

vi.mock('@/service/impersonationService', () => ({
  impersonationService: {
    registerExpiryHandlerOnRestore: registerExpiryHandlerOnRestoreMock,
  },
}))

vi.mock('@/service/authorizationService', () => ({
  authorizationService: {
    bootstrapSession: bootstrapSessionMock,
    getPendingPolicyConsentChallenge: vi.fn(() => null),
    setPendingPolicyConsentChallenge: vi.fn(),
    clearPendingPolicyConsentChallenge: vi.fn(),
  },
}))

describe('main bootstrap impersonation restore', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores impersonation scope and expiry handler instead of clearing the session', async () => {
    localStorage.setItem(
      StorageKey.Impersonation.SESSION_INFO,
      JSON.stringify({
        targetUserId: 'target-user-1',
        targetUsername: 'target',
        targetName: 'Target User',
        mode: 'view',
        startedAt: Date.now(),
      }),
    )

    const { bootstrapApp } = await import('@/bootstrap')
    await bootstrapApp()

    expect(hydrateMock).toHaveBeenCalledTimes(1)
    expect(clearSessionMock).not.toHaveBeenCalled()
    expect(setCurrentStorageScopeForUserIdMock).toHaveBeenCalledWith('target-user-1')
    expect(resetCurrentStorageScopeMock).not.toHaveBeenCalled()
    expect(registerExpiryHandlerOnRestoreMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(StorageKey.Impersonation.SESSION_INFO)).not.toBeNull()
  })

  it('queues business route preloading after restoring a valid session', async () => {
    bootstrapSessionMock.mockResolvedValueOnce('access-token')

    const { bootstrapApp } = await import('@/bootstrap')
    await bootstrapApp()
    await vi.advanceTimersByTimeAsync(2400)
    await Promise.resolve()
    await Promise.resolve()

    expect(bootstrapSessionMock).toHaveBeenCalledTimes(1)
    expect(queueBusinessRoutePreloadMock).toHaveBeenCalledWith({ __router: true })
  })
})
