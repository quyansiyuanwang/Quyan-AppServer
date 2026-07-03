import { API_ENDPOINTS } from '@/client/api-endpoints.gen'

export const EXCLUDED_URLS: string[] = [
  API_ENDPOINTS.AuthControllerLogin.url,
  API_ENDPOINTS.AuthControllerRefresh.url,
  API_ENDPOINTS.AuthControllerVerifyTwoFactorLogin.url,
  API_ENDPOINTS.AuthControllerSendTwoFactorEmailCode.url,
]

export const OPTION_KEYS = {
  SKIP_RETRY: 'X-Skip-Retry',
}
