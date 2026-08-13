// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import StorageKey from '@/constant/storagekey'
import { SessionCoordinator } from '@/service/sessionCoordinator'

const authApi = {
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
}

vi.mock('@/client/services/auth-controller.gen', () => ({
  createAuthControllerApi: () => authApi,
}))
vi.mock('@/stores/request', async () => {
  const actual = await vi.importActual<typeof import('@/stores/request')>('@/stores/request')
  return { ...actual, useRequestStore: () => ({ getAxios: () => ({}) }) }
})
vi.mock('@/service/heartbeatService', () => ({
  heartbeatService: { start: vi.fn(async () => undefined), stop: vi.fn() },
}))
vi.mock('@/service/replaySigningService', () => ({
  ReplaySigningService: {
    getInstance: () => ({
      refreshSigningMaterial: vi.fn(async () => undefined),
      clearSigningMaterial: vi.fn(),
    }),
  },
}))

describe('session coordinator', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    authApi.refresh.mockReset()
  })

  it('restores an access token from the HttpOnly-cookie refresh endpoint once for concurrent callers', async () => {
    authApi.refresh.mockResolvedValue({ code: 0, data: { access_token: 'cookie-access' } })
    const sessionCoordinator = new SessionCoordinator()

    const [first, second] = await Promise.all([
      sessionCoordinator.ensureSession(),
      sessionCoordinator.ensureSession(),
    ])

    expect(first).toBe('cookie-access')
    expect(second).toBe('cookie-access')
    expect(authApi.refresh).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(StorageKey.Auth.ACCESS_TOKEN)).toBeNull()
    expect(localStorage.getItem(StorageKey.Auth.REFRESH_TOKEN)).toBeNull()
  })

  it('marks a failed cookie restore as anonymous without persisting credentials', async () => {
    authApi.refresh.mockResolvedValue({ code: 1001, data: null })
    const sessionCoordinator = new SessionCoordinator()

    await expect(sessionCoordinator.refresh()).resolves.toBeNull()
    expect(sessionCoordinator.getSnapshot().status).toBe('expired')
    expect(sessionCoordinator.getSnapshot().accessToken).toBeNull()
  })
})
