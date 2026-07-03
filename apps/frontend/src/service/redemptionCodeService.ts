import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { createRedemptionCodeControllerApi } from '@/client/services/redemption-code-controller.gen'

const redemptionCodeApi = cacheObject(() =>
  createRedemptionCodeControllerApi(useRequestStore().getAxios()),
)

class RedemptionCodeService {
  private static instance: RedemptionCodeService

  static getInstance(): RedemptionCodeService {
    if (!RedemptionCodeService.instance) {
      RedemptionCodeService.instance = new RedemptionCodeService()
    }
    return RedemptionCodeService.instance
  }

  async createCodes(amount: number, count?: number, expiresAt?: string) {
    return await redemptionCodeApi.createCodes({
      body: { amount, count, expiresAt },
    })
  }

  async listCodes(page?: number, pageSize?: number) {
    return await redemptionCodeApi.listCodes({
      params: { page, pageSize },
    })
  }

  async redeemCode(code: string) {
    return await redemptionCodeApi.redeemCode({ body: { code } })
  }

  async deleteCode(id: string) {
    return await redemptionCodeApi.deleteCode({ path: { id } })
  }
}

export const redemptionCodeService = RedemptionCodeService.getInstance()
