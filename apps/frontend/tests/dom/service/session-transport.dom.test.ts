// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, HttpStatusCode } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { sessionCoordinator } from '@/service/sessionCoordinator'
import { clearAccessToken, useRequestStore } from '@/stores/request'
import { useSessionStore } from '@/stores/sessionStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUserInfoStore } from '@/stores/userInfoStore'
import {
  AuthControllerRefresh,
  AuthControllerLogout,
} from '@/client/api-descriptors/auth-controller.gen'
import { UserControllerGetCurrentUser } from '@/client/api-descriptors/user-controller.gen'
import { PermissionControllerGetUserPermissions } from '@/client/api-descriptors/permission-controller.gen'
import { CustomCode } from '@/constant/custom-code'
import { Permission } from '@/constant/permission'
import { siteProfiles } from '@/config/site-registry'
import { createProtectedNavigationGuard } from '@/router/navigation-guard'
import { resetRouteAccess, routeAccessState } from '@/router/route-access'
import { createAccessToken } from '../../helpers/access-token'

// Only independent background work is mocked; auth/profile/permission clients,
// transport, coordinator, stores, and the navigation guard are the real code.
vi.mock('@/service/heartbeatService', () => ({
  heartbeatService: { start: vi.fn(async () => undefined), stop: vi.fn() },
}))
vi.mock('@/service/replaySigningService', () => ({
  ReplaySigningService: {
    getInstance: () => ({
      refreshSigningMaterial: vi.fn(async () => undefined),
      clearSigningMaterial: vi.fn(),
      ensureSigningMaterial: vi.fn(async () => null),
    }),
  },
}))

const userId = 'session-transport-user'
const version = '2026-09-18T00:00:00.000Z'
const permissionsUrl = PermissionControllerGetUserPermissions.url.replace('{userId}', userId)
const pinia = createPinia()
const profile = siteProfiles.find(
  (profile) => profile.id === 'account' && profile.deploymentId === 'local',
)!
const responses = new Map<string, { status: number; body: unknown }>()
const requests: string[] = []
let accessToken: string

const setResponse = (url: string, data: unknown, status = HttpStatusCode.Ok) => {
  responses.set(url, { status, body: { code: CustomCode.OK, message: 'fixture', data } })
}
const navigate = async (permission?: Permission) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/session-check', component: { template: '<div />' }, meta: { permission } }],
  })
  const guard = createProtectedNavigationGuard(router, profile)
  return guard(router.resolve('/session-check'))
}

describe('session restoration through generated clients and real request transport', () => {
  beforeEach(() => {
    setActivePinia(pinia)
    localStorage.clear()
    clearAccessToken()
    resetRouteAccess()
    responses.clear()
    requests.length = 0
    accessToken = createAccessToken(userId, version)
    // refresh really returns just access_token, not a fallback user DTO.
    setResponse(AuthControllerRefresh.url, { access_token: accessToken })
    setResponse(AuthControllerLogout.url, {})
    setResponse(UserControllerGetCurrentUser.url, { id: userId, username: 'transport-user' })
    setResponse(permissionsUrl, {
      userId,
      groupPermissions: [],
      additionalPermissions: [],
      removedPermissions: [],
      effectivePermissions: [],
    })
    useRequestStore().getAxios().getAxios().defaults.adapter = async (config) => {
      requests.push(config.url!)
      const fixture = responses.get(config.url!)
      if (!fixture) throw new Error(`Unexpected fixture endpoint: ${config.url}`)
      const response = {
        config,
        status: fixture.status,
        statusText: String(fixture.status),
        headers: new AxiosHeaders(),
        data: fixture.body,
      }
      if (fixture.status >= HttpStatusCode.BadRequest)
        throw new AxiosError(
          'Fixture request rejected',
          AxiosError.ERR_BAD_REQUEST,
          config,
          undefined,
          response,
        )
      return response
    }
  })
  afterEach(async () => {
    await sessionCoordinator.logout()
    clearAccessToken()
    localStorage.clear()
    resetRouteAccess()
  })

  it('admits a cold protected route when cookie refresh returns a standard JWT without a user DTO', async () => {
    await expect(navigate()).resolves.toBe(true)
    expect(useSessionStore().permissionsStatus).toBe('ready')
    expect(usePermissionStore().isLoaded).toBe(true)
    expect(useUserInfoStore().userInfo.id).toBe(userId)
    expect(routeAccessState.status.value).toBe('idle')
    expect(requests).toEqual(
      expect.arrayContaining([
        AuthControllerRefresh.url,
        UserControllerGetCurrentUser.url,
        permissionsUrl,
      ]),
    )
    expect(requests.filter((url) => url === AuthControllerRefresh.url)).toHaveLength(1)
  })

  it('hydrates after login without requiring another refresh or a preexisting user cache', async () => {
    sessionCoordinator.completeLogin({ access_token: accessToken })
    await expect(navigate()).resolves.toBe(true)
    expect(requests).not.toContain(AuthControllerRefresh.url)
    expect(usePermissionStore().isLoaded).toBe(true)
  })

  it('refreshes an expired standard exp and shares restoration across concurrent callers', async () => {
    sessionCoordinator.completeLogin({
      access_token: createAccessToken(userId, version, { exp: Math.floor(Date.now() / 1000) - 1 }),
    })
    const [first, second] = await Promise.all([
      sessionCoordinator.restoreProtectedSession(),
      sessionCoordinator.restoreProtectedSession(),
    ])
    expect(first).toBe(accessToken)
    expect(second).toBe(accessToken)
    expect(requests.filter((url) => url === AuthControllerRefresh.url)).toHaveLength(1)
    expect(useSessionStore().permissionsStatus).toBe('ready')
  })

  it('does not turn successful authentication into authorization for a missing permission', async () => {
    await expect(navigate(Permission.USER_READ)).resolves.toBe(false)
    expect(routeAccessState.status.value).toBe('denied')
    expect(useSessionStore().permissionsStatus).toBe('ready')
  })

  it('rejects another user permission response without committing a partial profile', async () => {
    setResponse(permissionsUrl, { userId: 'different-user', effectivePermissions: [] })
    await expect(sessionCoordinator.restoreProtectedSession()).rejects.toMatchObject({
      stage: 'permissions',
    })
    expect(usePermissionStore().isLoaded).toBe(false)
    expect(useUserInfoStore().isUserInfoFetched).toBe(false)
    expect(useSessionStore().permissionsStatus).toBe('failed')
  })

  it('preserves a permissions HTTP failure rather than admitting the route', async () => {
    setResponse(permissionsUrl, null, HttpStatusCode.Forbidden)
    await expect(sessionCoordinator.restoreProtectedSession()).rejects.toMatchObject({
      stage: 'permissions',
      kind: 'forbidden',
    })
    expect(usePermissionStore().isLoaded).toBe(false)
    expect(useUserInfoStore().isUserInfoFetched).toBe(false)
  })
})
