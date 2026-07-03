import { useRequestStore } from '@/stores/request'
import type { RelayConfigDto, UpdateRelayConfigRequest, UptimeResponse } from '@/client/types.gen'
import { cacheObject } from '@/utils/common'
import { createRelayConfigControllerApi } from '@/client/services/relay-config-controller.gen'
import { createRootControllerApi } from '@/client/services/root-controller.gen'

const rootApi = cacheObject(() => createRootControllerApi(useRequestStore().getAxios()))

const relayConfigApi = cacheObject(() =>
  createRelayConfigControllerApi(useRequestStore().getAxios()),
)

class RelayConfigService {
  private static instance: RelayConfigService

  static getInstance() {
    if (!this.instance) {
      this.instance = new RelayConfigService()
    }
    return this.instance
  }

  async getRelayConfig(): Promise<RelayConfigDto> {
    const response = await relayConfigApi.getRelayConfig({})
    return response.data
  }

  async updateRelayConfig(data: UpdateRelayConfigRequest): Promise<RelayConfigDto> {
    const response = await relayConfigApi.updateRelayConfig({
      body: data,
    })
    return response.data
  }

  async getUptimeStatus(): Promise<UptimeResponse> {
    const response = await relayConfigApi.getUptimeStatus({})
    return response.data
  }

  async pingServer(): Promise<void> {
    await rootApi.ping(undefined, {
      retry: false,
      directRequest: true,
      directCacheBust: true,
      directCredentials: 'omit',
    })
  }
}

export const relayConfigService = RelayConfigService.getInstance()
