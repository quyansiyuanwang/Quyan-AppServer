import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import type {
  BatchDeleteRelayTokensRequest,
  BatchDuplicateRelayTokensRequest,
  BatchRelayTokensResultDto,
  BatchSetRelayTokenStatusRequest,
  CreateRelayTokenDto,
  DuplicateRelayTokenRequest,
  ExportRelayTokensRequest,
  ImportRelayTokensRequest,
  ImportRelayTokensResponse,
  RelayTokenCurrentQuotaDto,
  RelayTokenExportResponse,
  RelayTokenAvailableModelsDto,
  RelayTokenPageDto,
  RelayTokenUsageDetailDto,
  RelayTokenUsageSummaryBatchDto,
  RelayTokenDto,
  RelayTokenSwitchLogsDto,
  UpdateRelayTokenDto,
} from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createRelayControllerApi } from '@/client/services/relay-controller.gen'

const relayApi = cacheObject(() => createRelayControllerApi(useRequestStore().getAxios()))

class RelayTokenService {
  private static instance: RelayTokenService

  private normalizeTargetUserId(targetUserId?: string) {
    return targetUserId?.trim() || undefined
  }

  private unwrapResponse<T>(result: { code?: number; message?: string; data?: T } | T): T {
    if (!result) {
      throw new Error('Request failed')
    }

    if (typeof result === 'object' && result !== null && 'code' in result) {
      if (result.code !== CustomCode.OK) {
        throw new Error(result.message || 'Request failed')
      }

      return result.data as T
    }

    if (typeof result === 'object' && result !== null && 'data' in result) {
      return result.data as T
    }

    return result as T
  }

  async getRequestDiagnostics(params: Record<string, string | number | undefined>) {
    return this.unwrapResponse(await relayApi.getRequestDiagnostics({ params }))
  }

  async getRequestRouteTrace(requestId: string) {
    return this.unwrapResponse(await relayApi.getRequestRouteTrace({ path: { requestId } }))
  }

  private assertSuccess(result: { code?: number; message?: string } | null | undefined) {
    if (!result) {
      throw new Error('Request failed')
    }

    if (typeof result === 'object' && result !== null && 'code' in result) {
      if (result.code !== CustomCode.OK) {
        throw new Error(result.message || 'Request failed')
      }
    }
  }

  static getInstance(): RelayTokenService {
    if (!RelayTokenService.instance) {
      RelayTokenService.instance = new RelayTokenService()
    }
    return RelayTokenService.instance
  }

  async createRelayToken(data: CreateRelayTokenDto): Promise<RelayTokenDto> {
    const result = await relayApi.createToken({ body: data })
    return this.unwrapResponse(result)
  }

  async exportTokens(data: ExportRelayTokensRequest): Promise<RelayTokenExportResponse> {
    const result = await relayApi.exportTokens({ body: data })
    return this.unwrapResponse(result)
  }

  async importTokens(data: ImportRelayTokensRequest): Promise<ImportRelayTokensResponse> {
    const result = await relayApi.importTokens({ body: data })
    return this.unwrapResponse(result)
  }

  async getRelayTokens(options?: {
    page?: number
    pageSize?: number
    targetUserId?: string
  }): Promise<RelayTokenPageDto> {
    const result = await relayApi.listTokens({
      params: {
        page: options?.page,
        pageSize: options?.pageSize,
        targetUserId: this.normalizeTargetUserId(options?.targetUserId),
      },
    })
    return this.unwrapResponse(result)
  }

  async getRelayTokenById(id: string, targetUserId?: string): Promise<RelayTokenDto> {
    const result = await relayApi.getToken({ path: { id }, params: { targetUserId } })
    return this.unwrapResponse(result)
  }

  async deleteRelayToken(id: string, targetUserId?: string) {
    await relayApi.deleteToken({ path: { id }, params: { targetUserId } })
  }

  async updateTokenChannel(
    id: string,
    channelId: string,
    targetUserId?: string,
  ): Promise<RelayTokenDto> {
    const result = await relayApi.updateTokenChannel({
      path: { id },
      body: { channelId, targetUserId: this.normalizeTargetUserId(targetUserId) },
    })
    return this.unwrapResponse(result)
  }

  async updateToken(id: string, data: UpdateRelayTokenDto): Promise<RelayTokenDto> {
    const result = await relayApi.updateToken({
      path: { id },
      body: data,
    })
    return this.unwrapResponse(result)
  }

  async duplicateToken(id: string, data: DuplicateRelayTokenRequest = {}): Promise<RelayTokenDto> {
    const result = await relayApi.duplicateToken({
      path: { id },
      body: data,
    })
    return this.unwrapResponse(result)
  }

  async batchDuplicateTokens(data: BatchDuplicateRelayTokensRequest): Promise<RelayTokenDto[]> {
    const result = await relayApi.batchDuplicateTokens({ body: data })
    return this.unwrapResponse(result)
  }

  async refreshRelayToken(id: string, targetUserId?: string): Promise<RelayTokenDto> {
    void targetUserId
    const result = await relayApi.refreshToken({
      path: { id },
    })
    return this.unwrapResponse(result)
  }

  async toggleTokenStatus(id: string, targetUserId?: string): Promise<RelayTokenDto> {
    void targetUserId
    const result = await relayApi.toggleTokenStatus({
      path: { id },
    })
    return this.unwrapResponse(result)
  }

  async batchSetTokenStatus(
    data: BatchSetRelayTokenStatusRequest,
  ): Promise<BatchRelayTokensResultDto> {
    const result = await relayApi.batchSetTokenStatus({ body: data })
    return this.unwrapResponse(result)
  }

  async batchDeleteTokens(data: BatchDeleteRelayTokensRequest): Promise<BatchRelayTokensResultDto> {
    const result = await relayApi.batchDeleteTokens({ body: data })
    return this.unwrapResponse(result)
  }

  async getRelayTokenUsage(
    id: string,
    startDate?: string,
    endDate?: string,
    targetUserId?: string,
  ) {
    const result = await relayApi.getUsage({
      path: { id },
      params: { startDate, endDate, targetUserId: this.normalizeTargetUserId(targetUserId) },
    })
    return result.data
  }

  async getRelayTokenUsageSummaries(
    tokenIds?: string[],
    startDate?: string,
    endDate?: string,
    targetUserId?: string,
  ): Promise<RelayTokenUsageSummaryBatchDto> {
    const result = await relayApi.getUsageSummaries({
      params: {
        tokenIds: tokenIds?.length ? tokenIds.join(',') : undefined,
        startDate,
        endDate,
        targetUserId: this.normalizeTargetUserId(targetUserId),
      },
    })
    return this.unwrapResponse(result)
  }

  async getRelayTokenUsageSummary(
    id: string,
    options?: {
      startDate?: string
      endDate?: string
      limit?: number
      offset?: number
      targetUserId?: string
    },
  ): Promise<RelayTokenUsageDetailDto> {
    const result = await relayApi.getUsageSummary({
      path: { id },
      params: {
        startDate: options?.startDate,
        endDate: options?.endDate,
        limit: options?.limit,
        offset: options?.offset,
        targetUserId: this.normalizeTargetUserId(options?.targetUserId),
      },
    })
    return this.unwrapResponse(result)
  }

  async getTokenAvailableModels(
    id: string,
    targetUserId?: string,
  ): Promise<RelayTokenAvailableModelsDto> {
    const result = await relayApi.getTokenAvailableModels({
      path: { id },
      params: { targetUserId: this.normalizeTargetUserId(targetUserId) },
    })
    return this.unwrapResponse(result)
  }

  async getTokenSwitchLogs(
    id: string,
    limit: number = 50,
    targetUserId?: string,
  ): Promise<RelayTokenSwitchLogsDto> {
    const result = await relayApi.getTokenSwitchLogs({
      path: { id },
      params: { limit, targetUserId: this.normalizeTargetUserId(targetUserId) },
    })
    return this.unwrapResponse(result)
  }

  async getCurrentRelayTokenQuotaSummary(token: string): Promise<RelayTokenCurrentQuotaDto> {
    const result = await relayApi.getCurrentTokenQuotaSummary(undefined, {
      customHeaders: {
        Authorization: `Bearer ${token}`,
      },
      retry: false,
    })

    return this.unwrapResponse(result) as RelayTokenCurrentQuotaDto
  }
}

export const relayTokenService = RelayTokenService.getInstance()
