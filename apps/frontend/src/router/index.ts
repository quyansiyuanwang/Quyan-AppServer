import { createRouter, createWebHistory } from 'vue-router'
import { routes } from './routes'
import { authorizationService, AuthorizationService } from '@/service/authorizationService'
import { globalEventBus } from '@/stores/globalInstance'
import { usePermissionStore } from '@/stores/permissionStore'
import { captchaTrustStateService } from '@/service/captchaTrustStateService'
import { resolveCaptchaPreflightAction } from '@/service/captchaDialogService'
import { getLoginRoute } from '@/utils/auth-routes'
import { tracker } from '@/utils/tracker'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: routes,
})

// 全局路由守卫：检查认证状态
router.beforeEach(async (to, from, next) => {
  const allowGuestWhenEmbedded =
    to.meta.allowGuestWhenEmbedded === true && String(to.query.embed ?? '') === '1'
  const allowGuest = to.meta.allowGuest === true

  const requiresCaptchaPreflight = Boolean(to.meta.requiresCaptchaPreflight)

  if (requiresCaptchaPreflight && to.name !== 'captchaVerification') {
    const captchaAction = resolveCaptchaPreflightAction(to)
    if (captchaAction) {
      try {
        const status = await captchaTrustStateService.getTrustStatus()
        if (status.trusted) {
          next()
          return
        }
      } catch {
        // fall through without blocking auth entry pages
      }
    }
  }

  // 如果访问登录页，直接放行
  if (
    to.name === 'login' ||
    to.name === 'register' ||
    to.name === 'forgotPassword' ||
    to.name === 'oauthAuthorize' ||
    to.name === 'authVerification' ||
    to.name === 'captchaVerification'
  ) {
    next()
    return
  }

  const accessToken = AuthorizationService.getAccessToken()
  const token = accessToken || (await authorizationService.bootstrapSession())

  if (!token) {
    if (allowGuestWhenEmbedded || allowGuest) {
      next()
      return
    }

    next(getLoginRoute(to.fullPath))
    return
  }

  const permissionStore = usePermissionStore()
  const requiredPermission = to.meta.permission as string | undefined
  const anyPermissions = to.meta.anyPermissions as string[] | undefined

  if (requiredPermission || (anyPermissions && anyPermissions.length > 0)) {
    try {
      await permissionStore.untilReady()

      const hasRequiredPermission = requiredPermission
        ? permissionStore.hasPermission(requiredPermission)
        : true
      const hasAnyPermission = anyPermissions?.length
        ? permissionStore.hasAnyPermission(...anyPermissions)
        : true

      if (!hasRequiredPermission || !hasAnyPermission) {
        globalEventBus.emit('FORBIDDEN')
        if (from.name) {
          next(false)
          return
        }

        next({ name: 'home' })
        return
      }
    } catch (error) {
      console.error('Failed to initialize permission guard:', error)
    }
  }

  // 其他情况正常导航
  next()
})

router.afterEach((to, from) => {
  tracker.track('view', 'page_view', {
    toPath: to.fullPath,
    toName: String(to.name ?? ''),
    fromPath: from.fullPath,
    title: document.title,
  })
})

export default router
