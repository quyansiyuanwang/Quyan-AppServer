import type { RouteLocationNormalized, Router } from 'vue-router'
import type { SiteProfile } from '@/config/site-registry'
import { replaceDocument } from '@/service/navigationService'
import { preloadRouteViewComponents } from './domain-view-loader'
import { sessionCoordinator } from '@/service/sessionCoordinator'
import { navigateToLogin } from '@/service/authNavigationService'
import { usePermissionStore } from '@/stores/permissionStore'
import { classifyRecoveryFailure, SessionRestoreError } from '@/utils/session-recovery'
import { getLoginRoute } from '@/utils/auth-routes'
import { resolveRouteMigrationUrl } from './route-migration'
import {
  beginRouteRecovery,
  denyRouteAccess,
  failRouteAccess,
  markRouteRedirecting,
  resetRouteAccess,
} from './route-access'

export const isAuthEntryRoute = (to: RouteLocationNormalized): boolean =>
  to.matched.some((record) => record.meta.isAuthEntry === true)

export const isRootOAuthEntry = (to: RouteLocationNormalized): boolean =>
  to.path === '/' &&
  to.query.response_type === 'code' &&
  typeof to.query.client_id === 'string' &&
  typeof to.query.redirect_uri === 'string'

export const shouldRestoreProtectedSession = (to: RouteLocationNormalized): boolean => {
  if (isRootOAuthEntry(to) || isAuthEntryRoute(to) || to.meta.allowGuest === true) return false
  return !(to.meta.allowGuestWhenEmbedded === true && String(to.query.embed ?? '') === '1')
}

export const createProtectedNavigationGuard = (router: Router, profile: SiteProfile) => {
  let navigation = 0
  let approvedIdentity: string | null = null
  return async (to: RouteLocationNormalized) => {
    const attempt = ++navigation
    const started = performance.now()
    const identity = sessionCoordinator.getAuthorizationIdentity()
    const canPreserve = () =>
      approvedIdentity !== null &&
      approvedIdentity === identity &&
      identity === sessionCoordinator.getAuthorizationIdentity() &&
      Boolean(router.currentRoute.value.matched.length)

    // Static hosts do not always rewrite deep links to index.html. The CLI
    // starts OAuth at the identity site's root, which is always a real file.
    if (profile.id === 'identity' && isRootOAuthEntry(to)) {
      resetRouteAccess()
      return { name: 'oauthAuthorize' as const, query: to.query, replace: true }
    }

    const requestedUrl = new URL(to.fullPath, profile.canonicalOrigin)
    const migrationUrl = resolveRouteMigrationUrl(
      to.path,
      requestedUrl.search,
      requestedUrl.hash,
      profile,
    )
    if (migrationUrl) {
      markRouteRedirecting(migrationUrl)
      replaceDocument(migrationUrl)
      return false
    }

    if (isAuthEntryRoute(to)) {
      resetRouteAccess()
      return true
    }

    if (!shouldRestoreProtectedSession(to)) {
      resetRouteAccess()
      return true
    }

    // Start the route module request immediately. It runs in parallel with
    // session restoration and permission hydration, while the guard still
    // prevents the route from mounting until access is approved.
    void preloadRouteViewComponents(to)

    beginRouteRecovery(to.fullPath, canPreserve())
    try {
      const token = await sessionCoordinator.restoreProtectedSession()
      if (attempt !== navigation) return false
      if (!token) {
        if (profile.id === 'identity') {
          resetRouteAccess()
          return getLoginRoute(to.fullPath)
        }

        markRouteRedirecting(to.fullPath)
        await navigateToLogin(router, profile, to.fullPath)
        return false
      }

      const requiredPermission = to.meta.permission
      if (requiredPermission && !usePermissionStore().hasPermission(requiredPermission)) {
        denyRouteAccess(to.fullPath, requiredPermission)
        return false
      }

      approvedIdentity = sessionCoordinator.getAuthorizationIdentity()
      resetRouteAccess()
      return true
    } catch (error) {
      if (attempt !== navigation) return false
      const kind = classifyRecoveryFailure(error)
      if (kind === 'canceled') {
        // The identity changed; never expose the old view with an unconfirmed projection.
        failRouteAccess(to.fullPath, error)
        return false
      }
      failRouteAccess(
        to.fullPath,
        error,
        canPreserve() && (kind === 'transient' || kind === 'offline'),
      )
      void import('@/service/errorReportService')
        .then(({ reportClientError }) =>
          reportClientError({
            errorType: 'SessionRecoveryFailure',
            message: 'Protected navigation recovery failed',
            severity: 'warning',
            route: String(to.name ?? 'unknown'),
            context: {
              kind,
              stage: error instanceof SessionRestoreError ? error.stage : 'authorization',
              attempts: error instanceof SessionRestoreError ? error.attempts : 1,
              durationMs: Math.round(performance.now() - started),
              navigation: attempt,
            },
          }),
        )
        .catch(() => undefined)
      return false
    }
  }
}
