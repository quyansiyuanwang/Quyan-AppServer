import { createRemoteTerminalControllerApi } from '@/client/services/remote-terminal-controller.gen'
import type {
  CreateRemoteTerminalSessionRequest,
  RemoteTerminalAgentPreferencesDto,
  RemoteTerminalDirectoryBrowseDto,
  RemoteTerminalDeviceDto,
  RemoteTerminalDeviceProbeResponseDto,
  RemoteTerminalSessionDto,
  RemoteTerminalSessionSummaryDto,
  RemoteTerminalUsageSummaryDto,
  UpdateRemoteTerminalAgentPreferencesRequest,
} from '@/client/types.gen'
import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'

const remoteTerminalApi = cacheObject(() =>
  createRemoteTerminalControllerApi(useRequestStore().getAxios()),
)

class RemoteTerminalService {
  private static instance: RemoteTerminalService

  static getInstance() {
    if (!this.instance) {
      this.instance = new RemoteTerminalService()
    }

    return this.instance
  }

  async listDevices(): Promise<RemoteTerminalDeviceDto[]> {
    const response = await remoteTerminalApi.listDevices({})
    return response.data.items
  }

  async probeDevices(): Promise<RemoteTerminalDeviceProbeResponseDto> {
    const response = await remoteTerminalApi.probeDevices({ body: {} as never })
    return response.data
  }

  async listSessions(): Promise<RemoteTerminalSessionSummaryDto[]> {
    const response = await remoteTerminalApi.listSessions({})
    return response.data.items
  }

  async getUsageSummary(): Promise<RemoteTerminalUsageSummaryDto> {
    const response = await remoteTerminalApi.getUsageSummary({})
    return response.data
  }

  async browseDirectories(
    deviceId: string,
    path?: string,
  ): Promise<RemoteTerminalDirectoryBrowseDto> {
    const response = await remoteTerminalApi.browseDirectories({
      params: {
        deviceId,
        path: path ?? '',
      },
    })
    return response.data
  }

  async getAgentPreferences(deviceId: string): Promise<RemoteTerminalAgentPreferencesDto> {
    const response = await remoteTerminalApi.getAgentPreferences({
      params: {
        deviceId,
      },
    })
    return response.data
  }

  async updateAgentPreferences(
    body: UpdateRemoteTerminalAgentPreferencesRequest,
  ): Promise<RemoteTerminalAgentPreferencesDto> {
    const response = await remoteTerminalApi.updateAgentPreferences({ body })
    return response.data
  }

  async createSession(body: CreateRemoteTerminalSessionRequest): Promise<RemoteTerminalSessionDto> {
    const response = await remoteTerminalApi.createSession({ body })
    return response.data
  }
}

export const remoteTerminalService = RemoteTerminalService.getInstance()
