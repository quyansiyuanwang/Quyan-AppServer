import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import { toServiceError } from '@/utils/error-utils'
import { cacheObject } from '@/utils/common'
import { createJsonEndpointControllerApi } from '@/client/services/json-endpoint-controller.gen'
import { createPublicJsonControllerApi } from '@/client/services/public-json-controller.gen'

const publicJsonApi = cacheObject(() => createPublicJsonControllerApi(useRequestStore().getAxios()))

const jsonEndpointApi = cacheObject(() =>
  createJsonEndpointControllerApi(useRequestStore().getAxios()),
)

interface CreateJsonEndpointRequest {
  name: string
  slug: string
  description?: string
  jsonContent: any
  isPublic: boolean
  password?: string
}

interface UpdateJsonEndpointRequest {
  name?: string
  description?: string
  jsonContent?: any
  isPublic?: boolean
  password?: string
}

export class JsonEndpointService {
  private static instance: JsonEndpointService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new JsonEndpointService()
    }
    return this.instance
  }

  async getEndpoints() {
    const result = await jsonEndpointApi.listEndpoints({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async getEndpoint(id: string) {
    const result = await jsonEndpointApi.getEndpoint({
      path: { id },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async createEndpoint(data: CreateJsonEndpointRequest) {
    const result = await jsonEndpointApi.createEndpoint({
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async updateEndpoint(id: string, data: UpdateJsonEndpointRequest) {
    const result = await jsonEndpointApi.updateEndpoint({
      path: { id },
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async deleteEndpoint(id: string) {
    const result = await jsonEndpointApi.deleteEndpoint({
      path: { id },
    })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async accessPublicEndpoint(slug: string, _password?: string) {
    // Note: X-Access-Password header should be added via axios interceptor if needed
    const result = await publicJsonApi.accessEndpoint({
      path: { slug },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }
}

export const jsonEndpointService = JsonEndpointService.getInstance()
