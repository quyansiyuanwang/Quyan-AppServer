import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { createOjqaControllerApi } from '@/client/services/ojqa-controller.gen'

const ojqaApi = cacheObject(() => createOjqaControllerApi(useRequestStore().getAxios()))

export class OJUsageService {
  private static instance: OJUsageService

  static getInstance() {
    if (!this.instance) {
      this.instance = new OJUsageService()
    }
    return this.instance
  }

  async getUsageStats(params?: {
    page?: number
    pageSize?: number
    startTime?: string
    endTime?: string
  }) {
    const result = await ojqaApi.getUsageStats({
      params: params || {},
    })
    return result.data
  }
}
