import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cache } from '@/utils/common'
import { createOAuthControllerApi } from '@/client/services/o-auth-controller.gen'
import { sessionCoordinator } from '@/service/sessionCoordinator'

export interface OAuthAuthorizeQuery {
  response_type: 'code'
  client_id: string
  redirect_uri: string
  scope?: string
  state?: string
  code_challenge?: string
  code_challenge_method?: 'S256' | 'plain'
  nonce?: string
}

export interface OAuthAuthorizationPreview {
  client: {
    clientId: string
    name: string
    description?: string
    logoUrl?: string
    homepageUrl?: string
    policyUrl?: string
    tosUrl?: string
  }
  requestedScopes: string[]
  previouslyGrantedScopes: string[]
  missingScopes: string[]
  requireConsent: boolean
  redirectUri: string
  state?: string
  scopeDetails: OAuthAuthorizationScopeDetail[]
  unavailableScopes: string[]
}

export interface OAuthAuthorizationScopeDetail {
  scope: string
  category: string
  riskLevel: 'normal' | 'high'
  labelKey: string
  descriptionKey: string
  isNew: boolean
  grantable: boolean
}

export interface OAuthAuthorizationDecisionResponse {
  redirectTo: string
}

const getOAuthControllerApi = cache(() => createOAuthControllerApi(useRequestStore().getAxios()))

/**
 * The authorization page is commonly opened on auth.<root-domain> while the
 * API lives on api.<root-domain>. Development uses a same-origin Vite proxy,
 * so relying only on the Axios interceptor can hide missing bearer headers.
 * Resolve the session here and pass the header explicitly for this protected
 * OAuth flow. The backend remains the authority and still validates the JWT.
 */
const getAuthorizationRequestOptions = async () => {
  const token = await sessionCoordinator.ensureSession()
  if (!token) throw new Error('OAuth authorization requires an authenticated session')

  return {
    customHeaders: {
      Authorization: `Bearer ${token}`,
    },
  }
}

export class OAuthAuthorizationFrontendService {
  private static instance: OAuthAuthorizationFrontendService

  static getInstance() {
    if (!this.instance) {
      this.instance = new OAuthAuthorizationFrontendService()
    }
    return this.instance
  }

  async getPreview(query: OAuthAuthorizeQuery) {
    const result = await getOAuthControllerApi().authorize(
      { params: query },
      await getAuthorizationRequestOptions(),
    )
    return checkApiResult<{ data: OAuthAuthorizationPreview }>(result, true)
  }

  async decide(query: OAuthAuthorizeQuery, approve: boolean) {
    const result = await getOAuthControllerApi().decideAuthorization(
      {
        body: {
          ...query,
          approve,
        },
      },
      await getAuthorizationRequestOptions(),
    )
    return checkApiResult<{ data: OAuthAuthorizationDecisionResponse }>(result, true)
  }
}
