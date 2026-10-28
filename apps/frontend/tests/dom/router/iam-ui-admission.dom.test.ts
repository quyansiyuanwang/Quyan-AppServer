// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RouteLocationNormalized, Router } from 'vue-router'
import type { SiteProfile } from '@/config/site-registry'
import { usePermissionStore } from '@/stores/permissionStore'
import { createProtectedNavigationGuard } from '@/router/navigation-guard'
import {
  collectVisibleNavigationRoutes,
  navigationMenuDefinition,
} from '@/config/navigation-metadata'

vi.mock('@/service/permissionService', () => ({ permissionService: {} }))
vi.mock('@/service/sessionCoordinator', () => ({
  sessionCoordinator: {
    getAuthorizationIdentity: () => 'fixture-user:v1',
    restoreProtectedSession: async () => 'fixture-token-not-a-credential',
  },
}))
vi.mock('@/router/domain-view-loader', () => ({
  preloadRouteViewComponents: async () => undefined,
}))
vi.mock('@/service/authNavigationService', () => ({ navigateToLogin: vi.fn() }))
vi.mock('@/service/navigationService', () => ({ replaceDocument: vi.fn() }))
vi.mock('@/router/route-migration', () => ({ resolveRouteMigrationUrl: () => undefined }))

describe('scoped IAM workflow admission', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens the role page and its navigation entry using hints without global authority', async () => {
    const store = usePermissionStore()
    store.applyCurrentUserPermissions('fixture-user', {
      userId: 'fixture-user',
      groupPermissions: [],
      additionalPermissions: [],
      removedPermissions: [],
      effectivePermissions: [],
      uiPermissions: ['ram:role:read'],
    })
    const visible = collectVisibleNavigationRoutes(
      navigationMenuDefinition,
      store.uiPermissions,
      () => true,
    )
    expect(visible.some(({ node }) => node.route === 'ramRoles')).toBe(true)
    expect(visible.some(({ node }) => node.route === 'ramPolicies')).toBe(false)
    const router = { currentRoute: { value: { matched: [] } } } as unknown as Router
    const profile = {
      id: 'management-core',
      canonicalOrigin: 'https://manage.example.test',
    } as SiteProfile
    const to = {
      path: '/ram/roles',
      fullPath: '/ram/roles',
      query: {},
      meta: { permission: 'ram:role:read' },
      matched: [{ meta: {} }],
    } as unknown as RouteLocationNormalized
    const guard = createProtectedNavigationGuard(router, profile)
    await expect(guard(to)).resolves.toBe(true)
    expect(store.effectivePermissions).toEqual([])
    store.applyCurrentUserPermissions('fixture-user', {
      ...store.currentUserPermissions!,
      uiPermissions: [],
    })
    await expect(guard(to)).resolves.toBe(false)
  })
})
