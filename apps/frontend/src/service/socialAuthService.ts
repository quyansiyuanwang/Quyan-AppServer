import { createAuthControllerApi } from '@/client/services/auth-controller.gen'
import type {
  AuthData,
  BindExternalIdentityDto,
  CreateQrLoginSessionResponse,
  ExternalAuthAction,
  ExternalAuthBindingRequiredData,
  ExternalAuthProvider,
  ExternalIdentityItem,
  QrLoginSessionStatusResponse,
  StartExternalAuthResponse,
} from '@/client/types.gen'
import { CustomCode } from '@/constant/custom-code'
import { getBackendLocale } from '@/locales'
import { SSEStream, type SSEOptions } from '@/service/streaming/sse'
import { useRequestStore } from '@/stores/request'
import { cache } from '@/utils/common'
import { toServiceError } from '@/utils/error-utils'

const getAuthControllerApi = cache(() => createAuthControllerApi(useRequestStore().getAxios()))

type ServiceResultLike = {
  code?: number
  message?: string
  data?: unknown
}

const isAuthData = (value: unknown): value is AuthData => {
  return !!value && typeof value === 'object' && 'access_token' in value && 'user' in value
}

const isBindingRequiredData = (value: unknown): value is ExternalAuthBindingRequiredData => {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { requiresBinding?: unknown }).requiresBinding === true &&
    'bindingToken' in value
  )
}

export class SocialAuthService {
  private static instance: SocialAuthService | null = null

  private buildBackendUrl(path: string): string {
    const baseUrl = String(import.meta.env.VITE_BACKEND_URL || window.location.origin).trim()
    return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
  }

  static getInstance() {
    if (!this.instance) this.instance = new SocialAuthService()
    return this.instance
  }

  async startExternalAuth(
    provider: ExternalAuthProvider,
    action: ExternalAuthAction = 'login',
    redirectUri?: string,
  ): Promise<StartExternalAuthResponse> {
    const result = await getAuthControllerApi().startExternalAuth({
      body: { provider, action, redirectUri },
    })

    if (result.code === CustomCode.OK && result.data)
      return result.data as StartExternalAuthResponse

    throw toServiceError(result)
  }

  async externalAuthCallback(
    provider: ExternalAuthProvider,
    code: string,
    state: string,
  ): Promise<AuthData | ExternalAuthBindingRequiredData | ExternalIdentityItem> {
    const result = await getAuthControllerApi().externalAuthCallback({
      path: { provider },
      params: { code, state },
    })

    if (result.code === CustomCode.OK && result.data) return result.data as any

    throw toServiceError(result)
  }

  async listExternalIdentities(): Promise<ExternalIdentityItem[]> {
    const result = await getAuthControllerApi().listExternalIdentities({})
    if (result.code === CustomCode.OK && Array.isArray(result.data))
      return result.data as ExternalIdentityItem[]
    return []
  }

  async bindExternalIdentity(
    provider: ExternalAuthProvider,
    bindingToken: string,
  ): Promise<ExternalIdentityItem> {
    const result = await getAuthControllerApi().bindExternalIdentity({
      body: { provider, bindingToken } satisfies BindExternalIdentityDto,
    })

    if (result.code === CustomCode.OK && result.data) return result.data as ExternalIdentityItem

    throw toServiceError(result)
  }

  async unbindExternalIdentity(provider: ExternalAuthProvider): Promise<boolean> {
    const result = await getAuthControllerApi().unbindExternalIdentity({ body: { provider } })
    return result.code === CustomCode.OK
  }

  async createQrLoginSession(): Promise<CreateQrLoginSessionResponse> {
    const result = await getAuthControllerApi().createQrLoginSession({})
    if (result.code === CustomCode.OK && result.data)
      return result.data as CreateQrLoginSessionResponse
    throw toServiceError(result)
  }

  async scanQrLogin(sessionId: string): Promise<QrLoginSessionStatusResponse> {
    const result = await getAuthControllerApi().scanQrLogin({ body: { sessionId } })
    if (result.code === CustomCode.OK && result.data)
      return result.data as QrLoginSessionStatusResponse
    throw toServiceError(result)
  }

  async confirmQrLogin(sessionId: string, approve: boolean): Promise<QrLoginSessionStatusResponse> {
    const result = await getAuthControllerApi().confirmQrLogin({ body: { sessionId, approve } })
    if (result.code === CustomCode.OK && result.data)
      return result.data as QrLoginSessionStatusResponse
    throw toServiceError(result)
  }

  async getQrLoginStatus(sessionId: string): Promise<QrLoginSessionStatusResponse> {
    const result = await getAuthControllerApi().getQrLoginStatus({ params: { sessionId } })
    if (result.code === CustomCode.OK && result.data)
      return result.data as QrLoginSessionStatusResponse
    throw toServiceError(result)
  }

  async consumeQrLoginSession(sessionId: string): Promise<QrLoginSessionStatusResponse> {
    const result = await getAuthControllerApi().consumeQrLogin({
      body: { sessionId },
    })

    if (result.code === CustomCode.OK && result.data)
      return result.data as QrLoginSessionStatusResponse

    throw toServiceError(result)
  }

  streamQrLoginStatus(sessionId: string, callbacks: SSEOptions): SSEStream {
    const stream = new SSEStream()
    void stream.connect(
      this.buildBackendUrl(`/v1/auth/qr-login/stream?sessionId=${encodeURIComponent(sessionId)}`),
      {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'text/event-stream',
          ...(getBackendLocale() ? { 'X-Locale': getBackendLocale() } : {}),
        },
      },
      callbacks,
    )
    return stream
  }

  isAuthData(data: unknown): data is AuthData {
    return isAuthData(data)
  }

  isBindingRequiredData(data: unknown): data is ExternalAuthBindingRequiredData {
    return isBindingRequiredData(data)
  }
}

export const socialAuthService = SocialAuthService.getInstance()
