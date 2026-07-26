import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { checkApiResult } from '@/utils/service-utils'
import { createRelayChannelProbeControllerApi } from '@/client/services/relay-channel-probe-controller.gen'
import type {
  ApplyRelayChannelProbeRunsRequest,
  CreateRelayChannelProbeRunRequest,
  CreateRelayChannelProbeRunsRequest,
  UpsertRelayChannelProbeProfileRequest,
} from '@/client/types.gen'

const api = cacheObject(() => createRelayChannelProbeControllerApi(useRequestStore().getAxios()))

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

  async clearProfile(channelId: string): Promise<void> {
    checkApiResult(await api.clearProfile({ path: { channelId } }), false)
  }

  async createRun(channelId: string, body: CreateRelayChannelProbeRunRequest = {}) {
    return checkApiResult<any>(await api.createRun({ path: { channelId }, body }), true).data
  }

  async resetRunState(channelId: string): Promise<void> {
    checkApiResult(await api.resetRunState({ path: { channelId } }), false)
  }

  async createRuns(body: CreateRelayChannelProbeRunsRequest) {
    return checkApiResult<any>(await api.createRuns({ body }), true).data
  }

  async copyProfile(body: {
    sourceChannelId: string
    targetChannelIds: string[]
    overwriteExisting: boolean
  }) {
    return checkApiResult<any>(await api.copyProfile({ body }), true).data
  }

  async listRuns(channelId: string, page = 1, pageSize = 20) {
    return checkApiResult<any>(
      await api.listRuns({ path: { channelId }, params: { page, pageSize } }),
      true,
    ).data
  }

  async clearRunHistory(channelId: string, scope: 'all' | 'failed') {
    return checkApiResult<any>(
      await api.clearRunHistory({ path: { channelId }, params: { scope } }),
      true,
    ).data
  }

  async applyRuns(body: ApplyRelayChannelProbeRunsRequest) {
    return checkApiResult<any>(await api.applyRuns({ body }), true).data
  }
}

export const relayChannelProbeService = new RelayChannelProbeService()
