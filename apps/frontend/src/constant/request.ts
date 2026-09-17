import {
  AuthControllerLogin,
  AuthControllerRefresh,
  AuthControllerVerifyTwoFactorLogin,
  AuthControllerSendTwoFactorEmailCode,
  AuthControllerLogout,
} from '@/client/api-descriptors/auth-controller.gen'

// Import the startup controller only, never the complete generated endpoint registry.
export const EXCLUDED_URLS: readonly string[] = [
  AuthControllerLogin.url,
  AuthControllerRefresh.url,
  AuthControllerVerifyTwoFactorLogin.url,
  AuthControllerSendTwoFactorEmailCode.url,
]

export const READ_ONLY_SESSION_URLS: readonly string[] = [
  AuthControllerRefresh.url,
  AuthControllerLogout.url,
]

export const REQUEST_POLICY = {
  timeoutMs: 60_000,
  expiryBufferSeconds: 3,
  proactiveRefreshBufferSeconds: 2,
} as const

export const OPTION_KEYS = {
  SKIP_RETRY: 'X-Skip-Retry',
}
