import { useRequestStore } from '@/stores/request'
import { createAgentControllerApi } from '@/client/services/agent-controller.gen'
import { createAgentRunControllerApi } from '@/client/services/agent-run-controller.gen'
import type { AgentEvent, AgentWorkspace } from '@/types/agent'
import { createSseClient, SseStreamError } from '@/utils/streaming/sseStream'
import { getAccessToken, isTokenExpired } from '@/stores/request'
import { authorizationService } from '@/service/authorizationService'

const api = createAgentControllerApi(useRequestStore().getAxios())
const runs = createAgentRunControllerApi(useRequestStore().getAxios())

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

  async listWorkspaces(): Promise<AgentWorkspace[]> {
    return unwrap<AgentWorkspace[]>(await api.listWorkspaces()) ?? []
  }

  async createWorkspace(name: string): Promise<AgentWorkspace | undefined> {
    return unwrap<AgentWorkspace>(await api.createWorkspace({ body: { name } }))
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
    return unwrap<{ id: string }>(await runs.createRun({ path: { conversationId }, body }))
  }

  async cancelRun(taskId: string) {
    await api.cancelRun({ path: { taskId } })
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
