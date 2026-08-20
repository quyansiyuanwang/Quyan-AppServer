import type { AgentStreamEvent } from '@appserver/shared'

export interface AgentWorkspace {
  id: string
  name: string
  runtime: string
  runtimeStatus: string
  policy: Record<string, unknown>
  limits: Record<string, unknown>
  createTime: string
  machineId?: string
  machineName?: string
  machineStatus?: string
}

export interface AgentMachine {
  id: string
  name: string
  runtime: string
  runtimeStatus: string
  agentId?: string
  capabilities: Record<string, unknown>
  lastHeartbeatAt?: string
  registrationToken?: string
}

export type AgentEvent = AgentStreamEvent & { sequence?: number }
