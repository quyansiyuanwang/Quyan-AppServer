import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { checkApiResult } from '@/utils/service-utils'
import { createRelayChannelProbeControllerApi } from '@/client/services/relay-channel-probe-controller.gen'
import type {
  ApplyRelayChannelProbeRunsRequest,
  CreateRelayChannelProbeRunRequest,
  UpsertRelayChannelProbeProfileRequest,
} from '@/client/types.gen'

const api = cacheObject(() =>
  createRelayChannelProbeControllerApi(useRequestStore().getAxios()),
)

class RelayChannelProbeService {
  async listOverview() {
    return checkApiResult<any>(await api.listOverview(), true).data
  }

  async getProfile(channelId: string) {
    return checkApiResult<any>(await api.getProfile({ path: { channelId } }), true).data
  }

  async saveProfile(channelId: string, body: UpsertRelayChannelProbeProfileRequest) {
    return checkApiResult<any>(await api.upsertProfile({ path: { channelId }, body }), true).data
  }

  async createRun(channelId: string, body: CreateRelayChannelProbeRunRequest = {}) {
    return checkApiResult<any>(await api.createRun({ path: { channelId }, body }), true).data
  }

  async listRuns(channelId: string, page = 1, pageSize = 20) {
    return checkApiResult<any>(await api.listRuns({ path: { channelId }, params: { page, pageSize } }), true).data
  }

  async applyRuns(body: ApplyRelayChannelProbeRunsRequest) {
    return checkApiResult<any>(await api.applyRuns({ body }), true).data
  }
}

export const relayChannelProbeService = new RelayChannelProbeService()
