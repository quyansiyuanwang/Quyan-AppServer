import { createBalanceControllerApi } from '@/client/services/balance-controller.gen'
import type { BalanceAccountResponse } from '@/client/types.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'

const balanceApi = cacheObject(() => createBalanceControllerApi(useRequestStore().getAxios()))

class BalanceService {
  private static instance: BalanceService

  static getInstance() {
    if (!this.instance) {
      this.instance = new BalanceService()
    }

    return this.instance
  }

  async getMyBalance(): Promise<BalanceAccountResponse> {
    const result = await balanceApi.getMyBalance({})
    return result.data
  }
}

export const balanceService = BalanceService.getInstance()
