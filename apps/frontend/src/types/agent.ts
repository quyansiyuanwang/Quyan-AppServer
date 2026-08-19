import type { AgentStreamEvent } from '@appserver/shared'

export interface AgentWorkspace {
  id: string
  name: string
  runtime: string
  runtimeStatus: string
  policy: Record<string, unknown>
  limits: Record<string, unknown>
  createTime: string
}

export type AgentEvent = AgentStreamEvent & { sequence?: number }
