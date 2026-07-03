import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cache } from '@/utils/common'
import type {
  CreateOAuthClientDto,
  OAuthClientControllerListClientsForReviewData,
  OAuthClientDto,
  ReviewOAuthClientDto,
  UpdateOAuthClientDto,
} from '@/client/types.gen'
import { createOAuthClientControllerApi } from '@/client/services/o-auth-client-controller.gen'

const getOAuthClientControllerApi = cache(() =>
  createOAuthClientControllerApi(useRequestStore().getAxios()),
)

export class OAuthClientService {
  private static instance: OAuthClientService

  static getInstance() {
    if (!this.instance) {
      this.instance = new OAuthClientService()
    }
    return this.instance
  }

  async getOAuthClients() {
    const result = await getOAuthClientControllerApi().listClients({})
    return checkApiResult(result, true)
  }

  async getOAuthClient(id: string) {
    const result = await getOAuthClientControllerApi().getClient({ path: { id } })
    return checkApiResult(result, true)
  }

  async createOAuthClient(data: CreateOAuthClientDto) {
    const result = await getOAuthClientControllerApi().createClient({ body: data })
    return checkApiResult(result, true)
  }

  async listClientsForReview(query?: OAuthClientControllerListClientsForReviewData['query']) {
    const result = await getOAuthClientControllerApi().listClientsForReview({ params: query ?? {} })
    return checkApiResult(result, true)
  }

  async updateOAuthClient(id: string, data: UpdateOAuthClientDto) {
    const result = await getOAuthClientControllerApi().updateClient({ path: { id }, body: data })
    return checkApiResult(result, true)
  }

  async submitReview(id: string) {
    const result = await getOAuthClientControllerApi().submitReview({ path: { id } })
    return checkApiResult(result, false)
  }

  async reviewClient(id: string, data: ReviewOAuthClientDto) {
    const result = await getOAuthClientControllerApi().reviewClient({ path: { id }, body: data })
    return checkApiResult(result, false)
  }

  async deleteClientForReview(id: string) {
    const result = await getOAuthClientControllerApi().deleteClientForReview({ path: { id } })
    return checkApiResult(result, false)
  }

  async regenerateSecret(id: string) {
    const result = await getOAuthClientControllerApi().regenerateSecret({ path: { id } })
    return checkApiResult(result, true)
  }

  async deleteOAuthClient(id: string) {
    const result = await getOAuthClientControllerApi().deleteClient({ path: { id } })
    return checkApiResult(result, false)
  }

  buildRedirectUrisText(client?: Pick<OAuthClientDto, 'redirectUris'> | null) {
    return client?.redirectUris?.join('\n') ?? ''
  }

  buildScopesText(client?: Pick<OAuthClientDto, 'scopes'> | null) {
    return client?.scopes?.join('\n') ?? ''
  }
}
