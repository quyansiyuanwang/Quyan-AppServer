import { useRequestStore } from '@/stores/request'
import type {
  BatchDeleteRelayChannelsRequest,
  BatchRelayChannelsResultDto,
  BatchSetRelayChannelStatusRequest,
  BatchUpdateRelayChannelsRequest,
  BatchUpdateRelayChannelsResponse,
  CreateRelayChannelRequest,
  DuplicateRelayChannelRequest,
  ExportRelayChannelsRequest,
  ImportRelayChannelsRequest,
  ImportRelayChannelsResponse,
  UpdateRelayChannelRequest,
  RelayChannelDto,
  RelayChannelOptionDto,
  RelayRoutingCatalogOptionDto,
  RelayCatalogOptionDto,
  RelayChannelExportResponse,
  RelayChannelHealthDto,
  RelayAutomaticPoolHealthDto,
  RelayChannelHealthOverviewDto,
  UpdateRelayChannelHealthConfigRequest,
  BatchUpdateRelayChannelHealthConfigRequest,
  PaginatedResponseRelayChannelManagementListItemDto,
  RelayChannelManagementListItemDto,
  ClaimRelayChannelProviderEarningsResponse,
  PaginatedResponseRelayChannelDto,
  RelayChannelProviderEarningsResponse,
  ReviewRelayChannelSubmissionRequest,
  SubmitRelayChannelRequest,
  RelayChannelSubmissionStatus,
  CreateRelayChannelChangeRequest,
  RelayChannelChangeRequestDto,
  RelayChannelChangeRequestStatus,
  ReviewRelayChannelChangeRequest,
  RelayChannelUpstreamModelsRequest,
  RelayChannelUpstreamModelsResponse,
  UpdateRelayChannelProviderConfigRequest,
  UpdateRelayChannelServiceStatusRequest,
} from '@/client/types.gen'
import { checkApiResult } from '@/utils/service-utils'
import { cacheObject } from '@/utils/common'
import { createRelayChannelControllerApi } from '@/client/services/relay-channel-controller.gen'

const relayChannelApi = cacheObject(() =>
  createRelayChannelControllerApi(useRequestStore().getAxios()),
)

class RelayChannelService {
  private static instance: RelayChannelService

  static getInstance(): RelayChannelService {
    if (!RelayChannelService.instance) {
      RelayChannelService.instance = new RelayChannelService()
    }
    return RelayChannelService.instance
  }

  async listChannels(options?: { includeDisabled?: boolean }): Promise<RelayChannelDto[]> {
    const result = await relayChannelApi.listChannels({
      params: {
        includeDisabled: options?.includeDisabled,
      },
    })
    return checkApiResult<any>(result, true).data
  }

  async listManagementChannels(options: {
    page: number
    pageSize: number
    keyword?: string
    channelType?: RelayChannelManagementListItemDto['channelType']
    enabled?: boolean
    submissionStatus?: RelayChannelSubmissionStatus
  }): Promise<PaginatedResponseRelayChannelManagementListItemDto> {
    const result = await relayChannelApi.listManagementChannels({
      params: {
        page: options.page,
        pageSize: options.pageSize,
        keyword: options.keyword?.trim() || undefined,
        channelType: options.channelType,
        enabled: options.enabled,
        submissionStatus: options.submissionStatus,
      },
    })
    return checkApiResult<any>(result, true).data
  }

  async listChannelOptions(
    targetUserId?: string,
    options?: { excludePooled?: boolean },
  ): Promise<RelayChannelOptionDto[]> {
    const result = await relayChannelApi.listChannelOptions({
      params: {
        targetUserId: targetUserId?.trim() || undefined,
        excludePooled: options?.excludePooled === true ? true : undefined,
      },
    })
    return checkApiResult<any>(result, true).data
  }

  /** Safe user routing directory: never contains pooled-member execution nodes. */
  async listRoutingCatalogOptions(targetUserId?: string): Promise<RelayRoutingCatalogOptionDto[]> {
    const result = await relayChannelApi.listRoutingCatalogOptions({
      params: { targetUserId: targetUserId?.trim() || undefined },
    })
    return checkApiResult<any>(result, true).data
  }

  async listCatalogOptions(): Promise<RelayCatalogOptionDto[]> {
    const result = await relayChannelApi.listCatalogOptions()
    return checkApiResult<any>(result, true).data
  }

  async getChannel(id: string): Promise<RelayChannelDto> {
    const result = await relayChannelApi.getChannel({
      path: { id },
    })
    return checkApiResult<any>(result, true).data
  }

  async getChannelHealth(id: string): Promise<RelayChannelHealthDto | RelayAutomaticPoolHealthDto> {
    const result = await relayChannelApi.getChannelHealth({
      path: { id },
    })
    return checkApiResult<any>(result, true).data
  }

  async getChannelHealthOverview(): Promise<RelayChannelHealthOverviewDto> {
    const result = await relayChannelApi.getChannelHealthOverview()
    return checkApiResult<any>(result, true).data
  }

  async getAutomaticPoolHealths(): Promise<RelayAutomaticPoolHealthDto[]> {
    const result = await relayChannelApi.getAutomaticPoolHealths()
    return checkApiResult<any>(result, true).data
  }

  async updateChannelHealthConfig(
    id: string,
    data: UpdateRelayChannelHealthConfigRequest,
  ): Promise<RelayChannelHealthDto> {
    const result = await relayChannelApi.updateChannelHealthConfig({ path: { id }, body: data })
    return checkApiResult<any>(result, true).data
  }

  async clearChannelHealth(id: string): Promise<void> {
    const result = await relayChannelApi.clearChannelHealth({ path: { id } })
    checkApiResult(result, false)
  }

  async batchUpdateChannelHealthConfig(
    data: BatchUpdateRelayChannelHealthConfigRequest,
  ): Promise<BatchRelayChannelsResultDto> {
    const result = await relayChannelApi.batchUpdateChannelHealthConfig({ body: data })
    return checkApiResult<any>(result, true).data
  }

  async batchClearChannelHealth(ids: string[]): Promise<BatchRelayChannelsResultDto> {
    const result = await relayChannelApi.batchClearChannelHealth({ body: { ids } })
    return checkApiResult<any>(result, true).data
  }

  async createChannel(data: CreateRelayChannelRequest): Promise<RelayChannelDto> {
    const result = await relayChannelApi.createChannel({
      body: data,
    })
    return checkApiResult<any>(result, true).data
  }

  async updateChannel(id: string, data: UpdateRelayChannelRequest): Promise<RelayChannelDto> {
    const result = await relayChannelApi.updateChannel({
      path: { id },
      body: data,
    })
    return checkApiResult<any>(result, true).data
  }

  async deleteChannel(id: string): Promise<void> {
    const result = await relayChannelApi.deleteChannel({
      path: { id },
    })
    checkApiResult(result, false)
  }

  async exportChannels(data: ExportRelayChannelsRequest = {}): Promise<RelayChannelExportResponse> {
    const result = await relayChannelApi.exportChannels({
      body: data,
    })
    return checkApiResult<any>(result, true).data
  }

  async importChannels(data: ImportRelayChannelsRequest): Promise<ImportRelayChannelsResponse> {
    const result = await relayChannelApi.importChannels({
      body: data,
    })
    return checkApiResult<any>(result, true).data
  }

  async duplicateChannel(
    id: string,
    data: DuplicateRelayChannelRequest = {},
  ): Promise<RelayChannelDto> {
    const result = await relayChannelApi.duplicateChannel({
      path: { id },
      body: data,
    })
    return checkApiResult<any>(result, true).data
  }

  async batchDuplicateChannels(ids: string[]): Promise<RelayChannelDto[]> {
    const result = await relayChannelApi.batchDuplicateChannels({
      body: { ids },
    })
    return checkApiResult<any>(result, true).data
  }

  async toggleChannelStatus(id: string): Promise<RelayChannelDto> {
    const result = await relayChannelApi.toggleChannelStatus({
      path: { id },
    })
    return checkApiResult<any>(result, true).data
  }

  async batchSetChannelStatus(
    data: BatchSetRelayChannelStatusRequest,
  ): Promise<BatchRelayChannelsResultDto> {
    const result = await relayChannelApi.batchSetChannelStatus({
      body: data,
    })
    return checkApiResult<any>(result, true).data
  }

  async batchUpdateChannels(
    data: BatchUpdateRelayChannelsRequest,
  ): Promise<BatchUpdateRelayChannelsResponse> {
    const result = await relayChannelApi.batchUpdateChannels({ body: data })
    return checkApiResult<any>(result, true).data
  }

  async batchDeleteChannels(
    data: BatchDeleteRelayChannelsRequest,
  ): Promise<BatchRelayChannelsResultDto> {
    const result = await relayChannelApi.batchDeleteChannels({
      body: data,
    })
    return checkApiResult<any>(result, true).data
  }

  async submitChannel(data: SubmitRelayChannelRequest): Promise<RelayChannelDto> {
    const result = await relayChannelApi.submitChannel({ body: data })
    return checkApiResult<any>(result, true).data
  }

  async listMySubmittedChannels(options: {
    page: number
    pageSize: number
  }): Promise<PaginatedResponseRelayChannelDto> {
    const result = await relayChannelApi.listMySubmittedChannels({ params: options })
    return checkApiResult<any>(result, true).data
  }

  async deleteSubmittedChannel(id: string): Promise<void> {
    const result = await relayChannelApi.deleteSubmittedChannel({ path: { id } })
    checkApiResult(result, false)
  }

  async updateSubmittedChannelServiceStatus(
    id: string,
    data: UpdateRelayChannelServiceStatusRequest,
  ): Promise<RelayChannelDto> {
    const result = await relayChannelApi.updateSubmittedChannelServiceStatus({
      path: { id },
      body: data,
    })
    return checkApiResult<any>(result, true).data
  }

  async reviewChannelSubmission(
    id: string,
    data: ReviewRelayChannelSubmissionRequest,
  ): Promise<RelayChannelDto> {
    const result = await relayChannelApi.reviewChannelSubmission({ path: { id }, body: data })
    return checkApiResult<any>(result, true).data
  }

  async updateProviderConfig(id: string, data: UpdateRelayChannelProviderConfigRequest) {
    const result = await relayChannelApi.updateProviderConfig({ path: { id }, body: data })
    return checkApiResult<any>(result, true).data as RelayChannelDto
  }

  async createChangeRequest(id: string, data: CreateRelayChannelChangeRequest) {
    const result = await relayChannelApi.createChangeRequest({ path: { id }, body: data })
    return checkApiResult<any>(result, true).data as RelayChannelChangeRequestDto
  }

  async listMyChangeRequests(options: { page: number; pageSize: number }) {
    const result = await relayChannelApi.listMyChangeRequests({ params: options })
    return checkApiResult<any>(result, true).data as {
      items: RelayChannelChangeRequestDto[]
      total: number
      page: number
      pageSize: number
    }
  }

  async listChangeRequests(options: {
    page: number
    pageSize: number
    reviewStatus?: RelayChannelChangeRequestStatus
  }) {
    const result = await relayChannelApi.listChangeRequests({ params: options })
    return checkApiResult<any>(result, true).data
  }

  async reviewChangeRequest(id: string, data: ReviewRelayChannelChangeRequest) {
    const result = await relayChannelApi.reviewChangeRequest({ path: { id }, body: data })
    return checkApiResult<any>(result, true).data as RelayChannelChangeRequestDto
  }

  async listUpstreamModels(data: RelayChannelUpstreamModelsRequest) {
    const result = await relayChannelApi.listUpstreamModels({ body: data })
    return checkApiResult<any>(result, true).data as RelayChannelUpstreamModelsResponse
  }

  async getMyProviderEarnings(options: {
    page: number
    pageSize: number
  }): Promise<RelayChannelProviderEarningsResponse> {
    const result = await relayChannelApi.getMyProviderEarnings({ params: options })
    return checkApiResult<any>(result, true).data
  }

  async claimMyProviderEarnings(): Promise<ClaimRelayChannelProviderEarningsResponse> {
    const result = await relayChannelApi.claimMyProviderEarnings()
    return checkApiResult<any>(result, true).data
  }
}

export const relayChannelService = RelayChannelService.getInstance()
