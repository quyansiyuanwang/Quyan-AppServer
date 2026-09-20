import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import type { IpErrorStatusResponse } from '@/client/types.gen'
import { toServiceError } from '@/utils/error-utils'
import { cacheObject } from '@/utils/common'
import { createIpBlacklistControllerApi } from '@/client/services/ip-blacklist-controller.gen'

const ipBlacklistApi = cacheObject(() =>
  createIpBlacklistControllerApi(useRequestStore().getAxios()),
)

export class IPMonitoringService {
  private static instance: IPMonitoringService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) this.instance = new IPMonitoringService()
    return this.instance
  }

  async getDashboard() {
    const result = await ipBlacklistApi.getMonitoringDashboard({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async getIpErrorStatus(ip: string): Promise<IpErrorStatusResponse> {
    const result = await ipBlacklistApi.getIpErrorStatus({
      path: { ip },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async resetIpErrorWeight(ip: string): Promise<void> {
    const result = await ipBlacklistApi.resetIpErrorWeight({
      path: { ip },
    })
    if (result?.code !== undefined && result.code !== CustomCode.OK) {
      throw toServiceError(result)
    }
  }

  async setIpErrorWeight(ip: string, weight: number): Promise<void> {
    const result = await ipBlacklistApi.setIpErrorWeight({
      path: { ip },
      body: { weight },
    })
    if (result?.code !== undefined && result.code !== CustomCode.OK) {
      throw toServiceError(result)
    }
  }
}

export const ipMonitoringService = IPMonitoringService.getInstance()
