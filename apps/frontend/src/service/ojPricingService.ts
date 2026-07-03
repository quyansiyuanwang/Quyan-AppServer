import { useRequestStore } from '@/stores/request'
import type { CreateOjModelPricingRequest, UpdateOjModelPricingRequest } from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createOjPricingControllerApi } from '@/client/services/oj-pricing-controller.gen'

const ojPricingApi = cacheObject(() => createOjPricingControllerApi(useRequestStore().getAxios()))

export class OJPricingService {
  private static instance: OJPricingService

  static getInstance() {
    if (!this.instance) {
      this.instance = new OJPricingService()
    }
    return this.instance
  }

  async listPricing() {
    const result = await ojPricingApi.listPricing({})
    return result.data
  }

  async getPricing(model: string) {
    const result = await ojPricingApi.getPricing({ path: { model } })
    return result.data
  }

  async createPricing(data: CreateOjModelPricingRequest) {
    const result = await ojPricingApi.createPricing({ body: data })
    return result.data
  }

  async updatePricing(model: string, data: UpdateOjModelPricingRequest) {
    const result = await ojPricingApi.updatePricing({
      path: { model },
      body: data,
    })
    return result.data
  }

  async deletePricing(model: string) {
    await ojPricingApi.deletePricing({ path: { model } })
  }
}
