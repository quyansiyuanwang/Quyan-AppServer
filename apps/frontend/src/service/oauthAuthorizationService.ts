import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cache } from '@/utils/common'
import { createOAuthControllerApi } from '@/client/services/o-auth-controller.gen'

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
}

export interface OAuthAuthorizationDecisionResponse {
  redirectTo: string
}

const getOAuthControllerApi = cache(() => createOAuthControllerApi(useRequestStore().getAxios()))

export class OAuthAuthorizationFrontendService {
  private static instance: OAuthAuthorizationFrontendService

  static getInstance() {
    if (!this.instance) {
      this.instance = new OAuthAuthorizationFrontendService()
    }
    return this.instance
  }

  async getPreview(query: OAuthAuthorizeQuery) {
    const result = await getOAuthControllerApi().authorize({ params: query })
    return checkApiResult<{ data: OAuthAuthorizationPreview }>(result, true)
  }

  async decide(query: OAuthAuthorizeQuery, approve: boolean) {
    const result = await getOAuthControllerApi().decideAuthorization({
      body: {
        ...query,
        approve,
      },
    })
    return checkApiResult<{ data: OAuthAuthorizationDecisionResponse }>(result, true)
  }
}
