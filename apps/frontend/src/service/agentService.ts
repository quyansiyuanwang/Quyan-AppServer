import { useRequestStore } from '@/stores/request'
import { createAgentControllerApi } from '@/client/services/agent-controller.gen'
import { createAgentRunControllerApi } from '@/client/services/agent-run-controller.gen'
import type { AgentEvent, AgentWorkspace, AgentMachine } from '@/types/agent'
import { createSseClient } from '@/utils/streaming/sseStream'
import { getAccessToken, isTokenExpired } from '@/stores/request'
import { authorizationService } from '@/service/authorizationService'

function unwrap<T>(response: unknown): T | undefined {
  if (!response || typeof response !== 'object') return undefined
  const data = (response as { data?: unknown }).data
  if (data && typeof data === 'object' && 'data' in data) return (data as { data?: T }).data
  return data as T
}

const streamClient = createSseClient()

export class AgentService {
  private static instance: AgentService
  static getInstance() {
    return (this.instance ??= new AgentService())
  }

  private getApis() {
    const axiosInstance = useRequestStore().getAxios()
    return {
      api: createAgentControllerApi(axiosInstance),
      runs: createAgentRunControllerApi(axiosInstance),
    }
  }

  async listWorkspaces(): Promise<AgentWorkspace[]> {
    return unwrap<AgentWorkspace[]>(await this.getApis().api.listWorkspaces()) ?? []
  }

  async listMachines(): Promise<AgentMachine[]> {
    return unwrap<AgentMachine[]>(await this.getApis().api.listMachines()) ?? []
  }

  async createMachine(name: string): Promise<AgentMachine | undefined> {
    return unwrap<AgentMachine>(await this.getApis().api.createMachine({ body: { name } }))
  }

  async deleteMachine(id: string) {
    await this.getApis().api.deleteMachine({ path: { machineId: id } })
  }

  async createWorkspace(name: string, machineId?: string): Promise<AgentWorkspace | undefined> {
    return unwrap<AgentWorkspace>(
      await this.getApis().api.createWorkspace({ body: { name, machineId } }),
    )
  }

  async createRun(
    conversationId: string,
    body: {
      content: string
      model: string
      relayTokenId?: string
      workspaceId: string
      maxSteps?: number
      budget?: number
    },
  ) {
    return unwrap<{ id: string }>(
      await this.getApis().runs.createRun({ path: { conversationId }, body }),
    )
  }

  async cancelRun(taskId: string) {
    await this.getApis().api.cancelRun({ path: { taskId } })
  }

  async *stream(
    taskId: string,
    options: { signal?: AbortSignal; after?: number } = {},
  ): AsyncGenerator<AgentEvent> {
    if (isTokenExpired()) await authorizationService.refreshToken()
    const path = `/v1/agent/runs/${encodeURIComponent(taskId)}/events`
    for await (const transportEvent of streamClient.stream<AgentEvent>({
      url: path,
      init: {
        method: 'GET',
        headers: { ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}) },
        credentials: 'include',
      },
      context: undefined,
      decode: (data) => JSON.parse(data) as AgentEvent,
      signal: options.signal,
    })) {
      if (transportEvent.type === 'data') yield transportEvent.value
    }
  }
}

export const agentService = AgentService.getInstance()
