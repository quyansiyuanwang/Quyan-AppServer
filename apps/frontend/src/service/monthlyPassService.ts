import { useRequestStore } from '@/stores/request'
import type {
  AssignBatchUserMonthlyPassRequest,
  AssignUserMonthlyPassRequest,
  BatchAssignUserMonthlyPassResponse,
  ClaimMonthlyPassResultDto,
  ClaimMonthlyPassTemplateRequest,
  CreateMonthlyPassTemplateRequest,
  MonthlyPassFilterOptionsDto,
  MonthlyPassTemplateDto,
  MonthlyPassTemplateListResponse,
  MonthlyPassUsageListResponse,
  UpdateMonthlyPassTemplateRequest,
  UpdateUserMonthlyPassRequest,
  UserMonthlyPassDto,
  UserMonthlyPassListResponse,
} from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createMonthlyPassControllerApi } from '@/client/services/monthly-pass-controller.gen'

const monthlyPassApi = cacheObject(() =>
  createMonthlyPassControllerApi(useRequestStore().getAxios()),
)

class MonthlyPassService {
  private static instance: MonthlyPassService

  static getInstance() {
    if (!this.instance) {
      this.instance = new MonthlyPassService()
    }
    return this.instance
  }

  async listTemplates(params?: {
    page?: number
    pageSize?: number
    status?: number
    keyword?: string
  }): Promise<MonthlyPassTemplateListResponse> {
    const result = await monthlyPassApi.listTemplates({
      params: params || {},
    })
    return result.data
  }

  async listPublishedTemplates(): Promise<MonthlyPassTemplateDto[]> {
    const result = await monthlyPassApi.listPublishedTemplates()
    return result.data
  }

  async getFilterOptions(): Promise<MonthlyPassFilterOptionsDto> {
    const result = await monthlyPassApi.getFilterOptions()
    return result.data
  }

  async createTemplate(data: CreateMonthlyPassTemplateRequest): Promise<MonthlyPassTemplateDto> {
    const result = await monthlyPassApi.createTemplate({
      body: data,
    })
    return result.data
  }

  async updateTemplate(
    id: string,
    data: UpdateMonthlyPassTemplateRequest,
  ): Promise<MonthlyPassTemplateDto> {
    const result = await monthlyPassApi.updateTemplate({
      path: { id },
      body: data,
    })
    return result.data
  }

  async publishTemplate(id: string): Promise<MonthlyPassTemplateDto> {
    const result = await monthlyPassApi.publishTemplate({
      path: { id },
    })
    return result.data
  }

  async unpublishTemplate(id: string): Promise<MonthlyPassTemplateDto> {
    const result = await monthlyPassApi.unpublishTemplate({
      path: { id },
    })
    return result.data
  }

  async deleteTemplate(id: string): Promise<void> {
    await monthlyPassApi.deleteTemplate({
      path: { id },
    })
  }

  async listUserPasses(params?: {
    page?: number
    pageSize?: number
    userId?: string
    templateId?: string
    status?: number
  }): Promise<UserMonthlyPassListResponse> {
    const result = await monthlyPassApi.listUserPasses({
      params: params || {},
    })
    return result.data
  }

  async listMyUserPasses(params?: {
    page?: number
    pageSize?: number
    status?: number
  }): Promise<UserMonthlyPassListResponse> {
    const result = await monthlyPassApi.listCurrentUserPasses({
      params: params || {},
    })
    return result.data
  }

  async claimPublishedTemplate(
    data: ClaimMonthlyPassTemplateRequest,
  ): Promise<ClaimMonthlyPassResultDto> {
    const result = await monthlyPassApi.claimPublishedTemplate({
      body: data,
    })
    return result.data
  }

  async assignUserPass(data: AssignUserMonthlyPassRequest): Promise<UserMonthlyPassDto> {
    const result = await monthlyPassApi.assignUserPass({
      body: data,
    })
    return result.data
  }

  async assignUserPassBatch(
    data: AssignBatchUserMonthlyPassRequest,
  ): Promise<BatchAssignUserMonthlyPassResponse> {
    const result = await monthlyPassApi.assignUserPassBatch({
      body: data,
    })
    return result.data
  }

  async updateUserPass(
    id: string,
    data: UpdateUserMonthlyPassRequest,
  ): Promise<UserMonthlyPassDto> {
    const result = await monthlyPassApi.updateUserPass({
      path: { id },
      body: data,
    })
    return result.data
  }

  async deleteUserPass(id: string): Promise<void> {
    await monthlyPassApi.deleteUserPass({
      path: { id },
    })
  }

  async listUsages(params?: {
    page?: number
    pageSize?: number
    userId?: string
    templateId?: string
    model?: string
    startTime?: string
    endTime?: string
  }): Promise<MonthlyPassUsageListResponse> {
    const result = await monthlyPassApi.listUsages({
      params: params || {},
    })
    return result.data
  }
}

export const monthlyPassService = MonthlyPassService.getInstance()
