import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { createBalanceControllerApi } from '@/client/services/balance-controller.gen'
import { isApiUsageRecord } from '@/utils/balance-transaction'

const CONSUMPTION_SUMMARY_PAGE_SIZE = 100

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

  async getConsumptionAmount(startTime: string, endTime: string): Promise<number> {
    let offset = 0
    let amount = 0

    while (true) {
      const result = await this.getMyTransactions({
        startTime,
        endTime,
        limit: CONSUMPTION_SUMMARY_PAGE_SIZE,
        offset,
      })
      if (!result.data) throw new Error('Consumption summary response is missing')

      const { records, total } = result.data
      for (const record of records) {
        if (isApiUsageRecord(record) && Number(record.amount) < 0) {
          amount -= Number(record.amount)
        }
      }
      offset += records.length
      if (offset >= total) return Number(amount.toFixed(8))
      if (records.length < CONSUMPTION_SUMMARY_PAGE_SIZE) {
        throw new Error('Consumption summary is incomplete')
      }
    }
  }
}

export const balanceTransactionService = BalanceTransactionService.getInstance()
