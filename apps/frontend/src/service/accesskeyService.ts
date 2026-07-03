import { useRequestStore } from '@/stores/request'
import { checkApiResult } from '@/utils/service-utils'
import { cache } from '@/utils/common'
import type { CreateAccessKeyDto } from '@/client/types.gen'
import { createAccessKeyControllerApi } from '@/client/services/access-key-controller.gen'

const getAccessKeyControllerApi = cache(() =>
  createAccessKeyControllerApi(useRequestStore().getAxios()),
)

export type CreateAccessKeyPayload = Omit<CreateAccessKeyDto, 'verificationCode'> & {
  verificationCode?: string
}

export class AccessKeyService {
  private static instance: AccessKeyService

  static getInstance() {
    if (!this.instance) {
      this.instance = new AccessKeyService()
    }
    return this.instance
  }

  async getAccessKeys() {
    const result = await getAccessKeyControllerApi().listAccessKeys({})
    return checkApiResult(result, true)
  }

  async createAccessKey(data: CreateAccessKeyPayload) {
    const result = await getAccessKeyControllerApi().createAccessKey({
      // Keep request typing compatible until generated client types are refreshed.
      body: data as CreateAccessKeyDto,
    })
    return checkApiResult(result, true)
  }

  async deleteAccessKey(id: string) {
    const result = await getAccessKeyControllerApi().deleteAccessKey({ path: { id } })
    return checkApiResult(result, false)
  }

  async sendVerificationCode() {
    const result = await getAccessKeyControllerApi().sendAccessKeyCreationVerificationCode({})
    return checkApiResult(result, false)
  }
}
