import { useRequestStore } from '@/stores/request'
import type { CreateOjapiKeyRequest, UpdateOjapiKeyRequest } from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createOjapiKeyControllerApi } from '@/client/services/ojapi-key-controller.gen'

const ojapiKeyApi = cacheObject(() => createOjapiKeyControllerApi(useRequestStore().getAxios()))

export class OJAPIKeyService {
  private static instance: OJAPIKeyService

  static getInstance() {
    if (!this.instance) {
      this.instance = new OJAPIKeyService()
    }
    return this.instance
  }

  async listAPIKeys() {
    const result = await ojapiKeyApi.listApiKeys({})
    return result.data
  }

  async createAPIKey(data: CreateOjapiKeyRequest) {
    const result = await ojapiKeyApi.createApiKey({ body: data })
    return result.data
  }

  async getAPIKey(id: string) {
    const result = await ojapiKeyApi.getApiKey({ path: { id } })
    return result.data
  }

  async deleteAPIKey(id: string) {
    await ojapiKeyApi.deleteApiKey({ path: { id } })
  }

  async getAPIKeyStats() {
    const result = await ojapiKeyApi.getApiKeyStats({})
    return result.data
  }

  async updateAPIKey(id: string, data: UpdateOjapiKeyRequest) {
    const result = await ojapiKeyApi.updateApiKey({ path: { id }, body: data })
    return result.data
  }
}
