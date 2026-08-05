import { createBalanceControllerApi } from '@/client/services/balance-controller.gen'
import type { CreateBalanceGiftCodeDto, CreateBalanceTransferDto } from '@/client/types.gen'
import { CustomCode } from '@/constant/custom-code'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { toServiceError } from '@/utils/error-utils'

const balanceApi = cacheObject(() => createBalanceControllerApi(useRequestStore().getAxios()))

class BalanceTransferService {
  private static instance: BalanceTransferService

  static getInstance() {
    if (!this.instance) this.instance = new BalanceTransferService()
    return this.instance
  }

  async getConfig() {
    const result = await balanceApi.getTransferConfig({})
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async listGiftCodes(page = 1, pageSize = 20) {
    const result = await balanceApi.getMyGiftCodes({ params: { page, pageSize } })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async createGiftCode(body: CreateBalanceGiftCodeDto) {
    const result = await balanceApi.createGiftCode({ body })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async cancelGiftCode(id: string) {
    const result = await balanceApi.cancelGiftCode({ path: { id } })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }

  async createTransfer(body: CreateBalanceTransferDto) {
    const result = await balanceApi.createTransfer({ body })
    if (result?.code === CustomCode.OK && result.data) return result.data
    throw toServiceError(result)
  }
}

export const balanceTransferService = BalanceTransferService.getInstance()
