// Keep only the four transport exclusion paths in the initial bundle. Importing
// the complete generated endpoint registry made every route's metadata eager.
export const EXCLUDED_URLS: string[] = [
  '/v1/auth/login',
  '/v1/auth/refresh',
  '/v1/auth/verify-2fa',
  '/v1/auth/send-2fa-email-code',
]

export const OPTION_KEYS = {
  SKIP_RETRY: 'X-Skip-Retry',
}
