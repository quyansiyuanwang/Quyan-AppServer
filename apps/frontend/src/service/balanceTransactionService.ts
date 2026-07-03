import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { createBalanceControllerApi } from '@/client/services/balance-controller.gen'

const balanceApi = cacheObject(() => createBalanceControllerApi(useRequestStore().getAxios()))

class BalanceTransactionService {
  private static instance: BalanceTransactionService

  static getInstance(): BalanceTransactionService {
    if (!BalanceTransactionService.instance) {
      BalanceTransactionService.instance = new BalanceTransactionService()
    }
    return BalanceTransactionService.instance
  }

  async getMyTransactions(params?: {
    type?: string
    limit?: number
    offset?: number
    model?: string
    tokenName?: string
    startTime?: string
    endTime?: string
  }) {
    return await balanceApi.getMyTransactions({
      params: params || {},
    })
  }

  async getMyBalance() {
    return await balanceApi.getMyBalance({})
  }

  async getAllTransactions(params?: {
    userId?: string
    type?: string
    limit?: number
    offset?: number
    model?: string
    tokenName?: string
    startTime?: string
    endTime?: string
  }) {
    return await balanceApi.getAllTransactions({
      params: params || {},
    })
  }

  async getUserBalance(userId: string) {
    return await balanceApi.getUserBalance({ path: { userId } })
  }

  async getBatchBalances(userIds: string[]) {
    return await balanceApi.getBatchBalances({ body: { userIds } })
  }

  async recharge(data: {
    userId: string
    amount: number
    description?: string
    countAsStatistics?: boolean
  }) {
    return await balanceApi.recharge({ body: data })
  }

  async getUsageStatistics() {
    return await balanceApi.getUsage({})
  }
}

export const balanceTransactionService = BalanceTransactionService.getInstance()
