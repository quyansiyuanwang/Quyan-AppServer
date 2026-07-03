import type {
  ModelPricingDto,
  CreateModelPricingRequest,
  UpdateModelPricingRequest,
} from '@/client/types.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { createModelPricingControllerApi } from '@/client/services/model-pricing-controller.gen'

const modelPricingApi = cacheObject(() =>
  createModelPricingControllerApi(useRequestStore().getAxios()),
)

class ModelPricingService {
  private static instance: ModelPricingService

  static getInstance() {
    if (!this.instance) {
      this.instance = new ModelPricingService()
    }
    return this.instance
  }

  async getModelPricing(): Promise<ModelPricingDto[]> {
    const response = await modelPricingApi.getModelPricing({})
    return response.data?.models || []
  }

  async createModelPricing(data: CreateModelPricingRequest): Promise<ModelPricingDto> {
    const response = await modelPricingApi.createModelPricing({
      body: data,
    })
    return response.data?.data
  }

  async updateModelPricing(id: string, data: UpdateModelPricingRequest): Promise<ModelPricingDto> {
    const response = await modelPricingApi.updateModelPricing({
      path: { id },
      body: data,
    })
    return response.data?.data
  }

  async deleteModelPricing(id: string): Promise<void> {
    await modelPricingApi.deleteModelPricing({ path: { id } })
  }
}

export const modelPricingService = ModelPricingService.getInstance()
