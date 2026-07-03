import { captchaTrustStateService } from '@/service/captchaTrustStateService'
import { captchaTrustService } from '@/service/captchaTrustService'
import { getCaptchaRuntimeConfig, getCaptchaToken } from '@/utils/captcha'
import router from '@/router'

const CAPTCHA_ROUTE_PATH = '/auth/captcha'

const isCaptchaRoutePath = (value: string | undefined): boolean => {
  if (!value) return false
  return value === CAPTCHA_ROUTE_PATH || value.startsWith(`${CAPTCHA_ROUTE_PATH}?`)
}

const normalizeRedirectTarget = (redirect?: string): string => {
  if (redirect && redirect.startsWith('/') && !isCaptchaRoutePath(redirect)) return redirect

  if (typeof window === 'undefined') return '/login'

  const currentPath = window.location.pathname || '/login'
  const currentSearch = window.location.search || ''

  if (currentPath === CAPTCHA_ROUTE_PATH) {
    const currentParams = new URLSearchParams(currentSearch)
    const nestedRedirect = currentParams.get('redirect') || ''
    if (nestedRedirect.startsWith('/') && !isCaptchaRoutePath(nestedRedirect)) {
      return nestedRedirect
    }
    return '/login'
  }

  return `${currentPath}${currentSearch}`
}

const buildCaptchaRoute = (
  action: string,
  redirect?: string,
): { name: 'captchaVerification'; query: { action: string; redirect: string } } => ({
  name: 'captchaVerification',
  query: {
    action,
    redirect: normalizeRedirectTarget(redirect),
  },
})

export async function ensureCaptchaTrust(action = 'login', redirect?: string): Promise<boolean> {
  try {
    const status = await captchaTrustStateService.getTrustStatus()
    if (status.trusted) return true

    const runtimeConfig = await getCaptchaRuntimeConfig()
    const primaryProvider = runtimeConfig.provider
    const fallbackProvider = runtimeConfig.fallbackProvider

    if (!runtimeConfig.enabled || primaryProvider === 'none') return true

    if (primaryProvider === 'recaptcha') {
      try {
        const token = await getCaptchaToken(action, 'recaptcha')
        if (token) {
          await captchaTrustService.verifyAndTrust(token, action, 'recaptcha')
          return true
        }
      } catch {
        // fall through to configured fallback provider
      }

      if (fallbackProvider === 'turnstile') {
        await router.replace(buildCaptchaRoute(action, redirect))
        return false
      }

      return false
    }

    if (primaryProvider === 'turnstile') {
      await router.replace(buildCaptchaRoute(action, redirect))
      return false
    }

    return false
  } catch {
    return false
  }
}

export async function warmupCaptchaTrust(action = 'login'): Promise<void> {
  try {
    const status = await captchaTrustStateService.getTrustStatus()
    if (status.trusted) return

    const runtimeConfig = await getCaptchaRuntimeConfig()
    if (!runtimeConfig.enabled || runtimeConfig.provider !== 'recaptcha') return

    const token = await getCaptchaToken(action, 'recaptcha')
    if (!token) return

    await captchaTrustService.verifyAndTrust(token, action, 'recaptcha')
  } catch {
    // best-effort warmup only; do not block UI or navigate here
  }
}

export const resolveCaptchaPreflightAction = (route: {
  name?: string | symbol | null
  path?: string
  meta?: Record<string, unknown>
  query?: Record<string, unknown>
}): string | null => {
  if (route.name === 'register' || route.path === '/register') {
    return 'register'
  }

  if (route.name === 'login') {
    const mode = typeof route.query?.mode === 'string' ? route.query.mode : 'login'
    return mode === 'register' ? 'register' : 'login'
  }

  const metaAction = route.meta?.captchaAction
  return typeof metaAction === 'string' && metaAction.trim() ? metaAction : null
}
