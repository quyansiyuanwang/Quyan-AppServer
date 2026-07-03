import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cache } from '@/utils/common'
import type {
  AuthCenterClientDto,
  AuthCenterClientReviewStatus,
  CreateAuthCenterClientDto,
  ReviewAuthCenterClientDto,
  UpdateAuthCenterClientDto,
} from '@/client/types.gen'
import { createAuthCenterClientControllerApi } from '@/client/services/auth-center-client-controller.gen'

const getAuthCenterClientControllerApi = cache(() =>
  createAuthCenterClientControllerApi(useRequestStore().getAxios()),
)

export type AuthCenterClientReviewQuery = {
  page?: number
  pageSize?: number
  reviewStatus?: AuthCenterClientReviewStatus
  keyword?: string
}

export class AuthCenterClientService {
  private static instance: AuthCenterClientService

  static getInstance() {
    if (!this.instance) {
      this.instance = new AuthCenterClientService()
    }
    return this.instance
  }

  async getAuthCenterClients() {
    const result = await getAuthCenterClientControllerApi().listClients({})
    return checkApiResult(result, true)
  }

  async getAuthCenterClient(id: string) {
    const result = await getAuthCenterClientControllerApi().getClient({ path: { id } })
    return checkApiResult(result, true)
  }

  async createAuthCenterClient(data: CreateAuthCenterClientDto) {
    const result = await getAuthCenterClientControllerApi().createClient({ body: data })
    return checkApiResult(result, true)
  }

  async listClientsForReview(query?: AuthCenterClientReviewQuery) {
    const result = await getAuthCenterClientControllerApi().listClientsForReview({
      params: query ?? {},
    })
    return checkApiResult(result, true)
  }

  async updateAuthCenterClient(id: string, data: UpdateAuthCenterClientDto) {
    const result = await getAuthCenterClientControllerApi().updateClient({
      path: { id },
      body: data,
    })
    return checkApiResult(result, true)
  }

  async submitReview(id: string) {
    const result = await getAuthCenterClientControllerApi().submitReview({ path: { id } })
    return checkApiResult(result, false)
  }

  async reviewClient(id: string, data: ReviewAuthCenterClientDto) {
    const result = await getAuthCenterClientControllerApi().reviewClient({
      path: { id },
      body: data,
    })
    return checkApiResult(result, false)
  }

  async deleteClientForReview(id: string) {
    const result = await getAuthCenterClientControllerApi().deleteClientForReview({
      path: { id },
    })
    return checkApiResult(result, false)
  }

  async regenerateSecret(id: string) {
    const result = await getAuthCenterClientControllerApi().regenerateSecret({ path: { id } })
    return checkApiResult(result, true)
  }

  async deleteAuthCenterClient(id: string) {
    const result = await getAuthCenterClientControllerApi().deleteClient({ path: { id } })
    return checkApiResult(result, false)
  }

  buildRedirectUrisText(client?: Pick<AuthCenterClientDto, 'redirectUris'> | null) {
    return client?.redirectUris?.join('\n') ?? ''
  }

  buildScopesText(client?: Pick<AuthCenterClientDto, 'scopes'> | null) {
    return client?.scopes?.join('\n') ?? ''
  }
}
