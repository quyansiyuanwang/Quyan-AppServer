import { authEventBus, globalEventBus, customCodeBus } from '@/stores/globalInstance'
import { Notification } from '@/utils/notification'
import { i18ns } from '@/locales'
import { ElMessageBox } from 'element-plus'
import { useUserInfoStore } from '@/stores/userInfoStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { useImpersonationStore } from '@/stores/impersonationStore'
import router from '@/router'

const SESSION_EXPIRED_UNLOCK_DELAY_MS = 1200
const TWO_FACTOR_REDIRECT_UNLOCK_DELAY_MS = 1200

let sessionExpiredHandling = false
let sessionExpiredUnlockTimer: ReturnType<typeof setTimeout> | null = null
let twoFactorRedirecting = false
let twoFactorRedirectUnlockTimer: ReturnType<typeof setTimeout> | null = null

type TwoFactorMethod = 'passkey' | 'code' | 'email'
type TwoFactorPurpose = 'login' | 'disable2fa' | 'stepup'

interface TwoFactorRequiredPayload {
  challengeToken: string
  method?: string
  purpose?: string
  redirect?: string
  expiresIn?: number
}

const loadAuthorizationService = () => import('@/service/authorizationService')

const scheduleSessionExpiredUnlock = () => {
  if (sessionExpiredUnlockTimer) clearTimeout(sessionExpiredUnlockTimer)
  sessionExpiredUnlockTimer = setTimeout(() => {
    sessionExpiredHandling = false
    sessionExpiredUnlockTimer = null
  }, SESSION_EXPIRED_UNLOCK_DELAY_MS)
}

const scheduleTwoFactorRedirectUnlock = () => {
  if (twoFactorRedirectUnlockTimer) clearTimeout(twoFactorRedirectUnlockTimer)
  twoFactorRedirectUnlockTimer = setTimeout(() => {
    twoFactorRedirecting = false
    twoFactorRedirectUnlockTimer = null
  }, TWO_FACTOR_REDIRECT_UNLOCK_DELAY_MS)
}

const triggerSessionExpiredLogout = (message: string) => {
  if (sessionExpiredHandling) return

  sessionExpiredHandling = true

  Notification.notify(i18ns.t('message.warning.sessionExpired'), message, 'warning')

  // 获取当前路径作为 redirect（排除登录页和验证页）
  const currentPath = router.currentRoute.value?.fullPath
  const redirectPath =
    currentPath && currentPath !== '/login' && !currentPath.startsWith('/auth/verify')
      ? currentPath
      : undefined

  void loadAuthorizationService()
    .then(({ authorizationService }) => authorizationService.logout(redirectPath))
    .catch((error) => {
      console.warn('[events] Failed to process session-expired logout:', error)
    })
    .finally(() => {
      scheduleSessionExpiredUnlock()
    })
}

const normalizeTwoFactorMethod = (value: unknown): TwoFactorMethod => {
  if (value === 'passkey' || value === 'email') return value
  return 'code'
}

const normalizeTwoFactorPurpose = (value: unknown): TwoFactorPurpose => {
  if (value === 'disable2fa' || value === 'login') return value
  return 'stepup'
}

const getTwoFactorPayload = (raw: any): TwoFactorRequiredPayload | null => {
  if (!raw || typeof raw !== 'object') return null

  const candidate = raw?.data && typeof raw.data === 'object' ? raw.data : raw
  const challengeToken =
    typeof candidate.challengeToken === 'string' ? candidate.challengeToken.trim() : ''

  if (!challengeToken) return null

  return {
    challengeToken,
    method: candidate.method,
    purpose: candidate.purpose,
    redirect: candidate.redirect,
    expiresIn: candidate.expiresIn,
  }
}

const getSafeRedirect = (providedRedirect?: string): string | undefined => {
  if (providedRedirect && providedRedirect.startsWith('/')) {
    if (providedRedirect === '/login' || providedRedirect.startsWith('/auth/verify'))
      return undefined
    return providedRedirect
  }

  const currentPath = router.currentRoute.value?.fullPath
  if (!currentPath || currentPath === '/login' || currentPath.startsWith('/auth/verify'))
    return undefined
  return currentPath
}

const redirectToTwoFactorVerification = (raw: any) => {
  const payload = getTwoFactorPayload(raw)
  if (!payload) {
    Notification.notify(i18ns.t('error'), i18ns.t('twoFactor.challengeMissingHint'), 'error')
    return
  }

  if (twoFactorRedirecting) return
  twoFactorRedirecting = true

  const purpose = normalizeTwoFactorPurpose(payload.purpose)
  const method = normalizeTwoFactorMethod(payload.method)
  const redirect = getSafeRedirect(payload.redirect)

  void loadAuthorizationService()
    .then(({ authorizationService }) => {
      authorizationService.setPendingTwoFactorChallenge(payload.challengeToken, redirect, 'login')

      const currentRoute = router.currentRoute.value
      if (currentRoute?.name === 'authVerification') {
        scheduleTwoFactorRedirectUnlock()
        return
      }

      return router.push({
        name: 'authVerification',
        query: {
          purpose,
          method,
          authEntry: 'login',
          ...(redirect ? { redirect } : {}),
        },
      })
    })
    .catch((error) => {
      console.warn('[events] Failed to redirect to two-factor verification:', error)
    })
    .finally(() => {
      scheduleTwoFactorRedirectUnlock()
    })
}

/**
 * 注册认证相关的全局事件监听器
 */
export function registerAuthEvents() {
  authEventBus.on('FORCE_LOGOUT_DETECTED', () => {
    const impersonationStore = useImpersonationStore()
    if (impersonationStore.isImpersonating) return

    triggerSessionExpiredLogout(i18ns.t('message.warning.autoRedirectToLogin'))
  })

  authEventBus.on('USER_LOGGED_OUT', () => {
    useUserInfoStore().clear()
    usePermissionStore().clearCurrentUserPermissions()
  })

  // 注册 token 刷新事件监听器
  authEventBus.on(
    'REQUEST_REFRESH_TOKEN',
    (token) => {
      void loadAuthorizationService()
        .then(({ authorizationService }) => authorizationService.refreshToken(token))
        .catch((error) => {
          console.error('Refresh token flow failed unexpectedly:', error)
        })
    },
    false,
  )

  authEventBus.on('ACCESS_TOKEN_REFRESH_FAILED', () => {
    // 如果当前处于模拟会话中，刷新失败意味着模拟 token 已过期，由 ImpersonationService 处理
    const impersonationStore = useImpersonationStore()
    if (impersonationStore.isImpersonating) return

    triggerSessionExpiredLogout(i18ns.t('message.warning.autoRedirectToLogin'))
  })
}

export function registerCustomCodeEvents() {
  // 监听通用的custom code事件
  customCodeBus.on('TOKEN_EXPIRED_DUE_TO_UPDATE', () => {
    triggerSessionExpiredLogout(i18ns.t('message.warning.permissionUpdated'))
  })

  customCodeBus.on('TWO_FACTOR_REQUIRED', (resp) => {
    redirectToTwoFactorVerification(resp)
  })

  customCodeBus.on('IP_BLACKLISTED', (resp) => {
    const data = resp.data
    const expireTime = data?.expireTime
      ? new Date(data.expireTime).toLocaleString()
      : i18ns.t('message.error.ipBlacklistPermanent')
    const reason = data?.reason || i18ns.t('message.error.ipBlacklistDefaultReason')
    void ElMessageBox.alert(
      i18ns.t('message.error.ipBlacklisted', { reason, expireTime }),
      i18ns.t('message.error.accessLimited'),
      {
        confirmButtonText: i18ns.t('button.confirm'),
        type: 'error',
        closeOnClickModal: false,
        closeOnPressEscape: false,
      },
    ).catch(() => {
      // Ignore dialog open failures.
    })
  })

  customCodeBus.on('REQUIRE_REPLAY_PROTECTION', () => {
    Notification.notify(
      i18ns.t('error'),
      i18ns.t('message.error.replayProtectionRequired'),
      'error',
    )
  })

  customCodeBus.on('REPLAY_PROTECTION_FAILED', (resp) => {
    const message = (resp as any)?.message || i18ns.t('message.error.replayProtectionFailed')
    Notification.notify(i18ns.t('error'), message, 'error')
  })

  customCodeBus.on('AUTH_FAILED', () => globalEventBus.emit('UNAUTHORIZED'))
  customCodeBus.on('PERMISSION_DENIED', () => globalEventBus.emit('FORBIDDEN'))
}

export function registerWebEvents() {
  // webEventBus.on('Forbidden', (error?) => {
  //   Notification.notify(
  //     i18ns.t('error'),
  //     i18ns.tf('message.error.forbiddenWithMessage', {
  //       msg: ((error as AxiosError)?.response?.data as any)?.message ?? '',
  //     }),
  //     'error',
  //   )
  // })
}

export function registerGlobalEvents() {
  globalEventBus.on('FORBIDDEN', (msg?) => {
    const suffix = typeof msg === 'string' && msg.trim() ? `: ${msg}` : ''
    Notification.notify(i18ns.t('error'), `${i18ns.t('message.error.forbidden')}${suffix}`, 'error')
  })

  globalEventBus.on('UNAUTHORIZED', (msg?) => {
    const suffix = typeof msg === 'string' && msg.trim() ? `: ${msg}` : ''
    Notification.notify(
      i18ns.t('error'),
      `${i18ns.t('message.error.unauthorized')}${suffix}`,
      'error',
    )
  })
}

export function registerAllEvents() {
  registerAuthEvents()
  registerCustomCodeEvents()
  registerWebEvents()
  registerGlobalEvents()
}
