// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalized, Router } from 'vue-router'
import type { SiteProfile } from '@/config/site-registry'
import { createProtectedNavigationGuard } from '@/router/navigation-guard'
import { resetRouteAccess, routeAccessState } from '@/router/route-access'

const {
  SessionRestoreErrorMock,
  restoreProtectedSessionMock,
  preloadRouteViewComponentsMock,
  navigateToLoginMock,
  hasPermissionMock,
  resolveRouteMigrationUrlMock,
  replaceDocumentMock,
} = vi.hoisted(() => {
  class SessionRestoreError extends Error {}
  return {
    SessionRestoreErrorMock: SessionRestoreError,
    restoreProtectedSessionMock: vi.fn(),
    preloadRouteViewComponentsMock: vi.fn(async () => undefined),
    navigateToLoginMock: vi.fn(),
    hasPermissionMock: vi.fn(),
    resolveRouteMigrationUrlMock: vi.fn(),
    replaceDocumentMock: vi.fn(),
  }
})

vi.mock('@/service/sessionCoordinator', () => ({
  SessionRestoreError: SessionRestoreErrorMock,
  sessionCoordinator: {
    restoreProtectedSession: restoreProtectedSessionMock,
    releaseProtectedSessionRestore: vi.fn(),
  },
}))
vi.mock('@/router/domain-view-loader', () => ({
  preloadRouteViewComponents: preloadRouteViewComponentsMock,
}))
vi.mock('@/service/authNavigationService', () => ({ navigateToLogin: navigateToLoginMock }))
vi.mock('@/service/navigationService', () => ({ replaceDocument: replaceDocumentMock }))
vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({ hasPermission: hasPermissionMock }),
}))
vi.mock('@/router/route-migration', () => ({
  resolveRouteMigrationUrl: resolveRouteMigrationUrlMock,
}))

const profile = {
  id: 'account',
  canonicalOrigin: 'https://account.qysyw.test',
} as SiteProfile

const createTo = (meta: Record<string, unknown> = {}): RouteLocationNormalized =>
  ({
    path: '/settings/profile',
    fullPath: '/settings/profile',
    query: {},
    meta,
    matched: [{ meta }],
  }) as unknown as RouteLocationNormalized

describe('protected navigation guard', () => {
  const router = { replace: vi.fn() } as unknown as Router

  beforeEach(() => {
    vi.clearAllMocks()
    resetRouteAccess()
    resolveRouteMigrationUrlMock.mockReturnValue(undefined)
  })

  it('does not probe a guest route session', async () => {
    const guard = createProtectedNavigationGuard(router, profile)

    await expect(guard(createTo({ allowGuest: true }))).resolves.toBe(true)
    expect(restoreProtectedSessionMock).not.toHaveBeenCalled()
    expect(preloadRouteViewComponentsMock).not.toHaveBeenCalled()
  })

  it('redirects a business route before rendering when no session can be restored', async () => {
    restoreProtectedSessionMock.mockResolvedValue(null)
    navigateToLoginMock.mockResolvedValue(undefined)
    const guard = createProtectedNavigationGuard(router, profile)

    await expect(guard(createTo())).resolves.toBe(false)
    expect(navigateToLoginMock).toHaveBeenCalledWith(router, profile, '/settings/profile')
    expect(routeAccessState.status.value).toBe('redirecting')
    expect(restoreProtectedSessionMock).toHaveBeenCalledOnce()
  })

  it('returns the local login route on the identity profile', async () => {
    restoreProtectedSessionMock.mockResolvedValue(null)
    const identityProfile = {
      ...profile,
      id: 'identity',
      canonicalOrigin: 'https://auth.qysyw.test',
    } as SiteProfile
    const guard = createProtectedNavigationGuard(router, identityProfile)

    await expect(guard(createTo())).resolves.toEqual({
      name: 'login',
      query: { redirect: '/settings/profile' },
    })
    expect(navigateToLoginMock).not.toHaveBeenCalled()
  })

  it('continues after cookie restoration and permission hydration', async () => {
    restoreProtectedSessionMock.mockResolvedValue('access-token')
    hasPermissionMock.mockReturnValue(true)
    const guard = createProtectedNavigationGuard(router, profile)

    await expect(guard(createTo({ permission: 'user:read' }))).resolves.toBe(true)
    expect(restoreProtectedSessionMock).toHaveBeenCalledOnce()
    expect(preloadRouteViewComponentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ fullPath: '/settings/profile' }),
    )
    expect(routeAccessState.status.value).toBe('idle')
  })

  it('keeps the URL and marks access denied when permission is missing', async () => {
    restoreProtectedSessionMock.mockResolvedValue('access-token')
    hasPermissionMock.mockReturnValue(false)
    const guard = createProtectedNavigationGuard(router, profile)

    await expect(guard(createTo({ permission: 'user:read' }))).resolves.toBe(false)
    expect(routeAccessState.status.value).toBe('denied')
    expect(routeAccessState.targetPath.value).toBe('/settings/profile')
    expect(routeAccessState.requiredPermission.value).toBe('user:read')
  })

  it('shows the retry boundary for transient session failures', async () => {
    restoreProtectedSessionMock.mockRejectedValue(new SessionRestoreErrorMock('offline'))
    const guard = createProtectedNavigationGuard(router, profile)

    await expect(guard(createTo())).resolves.toBe(false)
    expect(routeAccessState.status.value).toBe('error')
    expect(routeAccessState.error.value).toBeInstanceOf(SessionRestoreErrorMock)
  })
})
