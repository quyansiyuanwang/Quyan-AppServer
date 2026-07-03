import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import type { CreateIpWhitelistDto } from '@/client/types.gen'
import { toServiceError } from '@/utils/error-utils'
import { cacheObject } from '@/utils/common'
import { createIpWhitelistControllerApi } from '@/client/services/ip-whitelist-controller.gen'

const ipWhitelistApi = cacheObject(() =>
  createIpWhitelistControllerApi(useRequestStore().getAxios()),
)

export class IPWhitelistService {
  private static instance: IPWhitelistService | null = null
  private constructor() {}

  static getInstance() {
    if (!this.instance) this.instance = new IPWhitelistService()
    return this.instance
  }

  async getAll(limit?: number, offset?: number) {
    const result = await ipWhitelistApi.getAllIpWhitelists({
      params: { limit, offset },
    })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result, 'Failed to get IP whitelists')
  }

  async add(data: CreateIpWhitelistDto) {
    const result = await ipWhitelistApi.addWhiteIp({ body: data })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result, 'Failed to add IP to whitelist')
  }

  async remove(ip: string) {
    const result = await ipWhitelistApi.removeWhiteIp({
      path: { ip },
    })
    if (result?.code === CustomCode.OK) return true
    throw toServiceError(result, 'Failed to remove IP from whitelist')
  }
}

export const ipWhitelistService = IPWhitelistService.getInstance()
