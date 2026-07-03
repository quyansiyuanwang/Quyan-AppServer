import { CustomCode } from '@/constant/custom-code'
import { useRequestStore } from '@/stores/request'
import { toServiceError } from '@/utils/error-utils'
import type { GenerateReUrlResponse } from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createReUrlControllerApi } from '@/client/services/re-url-controller.gen'

const reUrlApi = cacheObject(() => createReUrlControllerApi(useRequestStore().getAxios()))

export class SwaggerDocsService {
  private static instance: SwaggerDocsService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new SwaggerDocsService()
    }
    return this.instance
  }

  async generateAccessLink(ttl = 60): Promise<GenerateReUrlResponse> {
    const result = await reUrlApi.generateReUrl({
      body: { ttl },
    })

    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }

    throw toServiceError(result)
  }

  buildReurlUrl(resourceUrl: string, reurl: string) {
    const url = new URL(resourceUrl, window.location.origin)
    url.searchParams.set('token', `reurl:${reurl}`)
    return url.toString()
  }

  buildDocsUrl(docsUrl: string, reurl: string) {
    return this.buildReurlUrl(docsUrl, reurl)
  }
}

export const swaggerDocsService = SwaggerDocsService.getInstance()
