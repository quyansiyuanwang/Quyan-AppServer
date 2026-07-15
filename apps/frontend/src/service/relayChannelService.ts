import { useRequestStore } from '@/stores/request'
import type {
  BatchDeleteRelayChannelsRequest,
  BatchRelayChannelsResultDto,
  BatchSetRelayChannelStatusRequest,
  CreateRelayChannelRequest,
  DuplicateRelayChannelRequest,
  ExportRelayChannelsRequest,
  ImportRelayChannelsRequest,
  ImportRelayChannelsResponse,
  UpdateRelayChannelRequest,
  RelayChannelDto,
  RelayChannelOptionDto,
  RelayChannelExportResponse,
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

  async listChannelOptions(): Promise<RelayChannelOptionDto[]> {
    const result = await relayChannelApi.listChannelOptions()
    return checkApiResult<any>(result, true).data
  }

  async getChannel(id: string): Promise<RelayChannelDto> {
    const result = await relayChannelApi.getChannel({
      path: { id },
    })
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

  async batchDeleteChannels(
    data: BatchDeleteRelayChannelsRequest,
  ): Promise<BatchRelayChannelsResultDto> {
    const result = await relayChannelApi.batchDeleteChannels({
      body: data,
    })
    return checkApiResult<any>(result, true).data
  }
}

export const relayChannelService = RelayChannelService.getInstance()
