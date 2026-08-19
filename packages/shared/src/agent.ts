export type AgentTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'

export type AgentWorkspaceStatus = 'provisioning' | 'ready' | 'stopping' | 'stopped' | 'failed'

export interface AgentToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  risk: 'read' | 'write' | 'network' | 'destructive'
}

export type AgentStreamEvent =
  | { type: 'task'; taskId: string; status: AgentTaskStatus; done: false }
  | { type: 'assistant_delta'; taskId: string; content: string; done: false }
  | { type: 'tool_call'; taskId: string; stepId: string; call: AgentToolCall; done: false }
  | { type: 'tool_result'; taskId: string; stepId: string; ok: boolean; content: string; done: false }
  | { type: 'approval_required'; taskId: string; approvalId: string; call: AgentToolCall; expiresAt: string; done: false }
  | { type: 'workspace_status'; taskId: string; workspaceId: string; status: AgentWorkspaceStatus; done: false }
  | { type: 'artifact_created'; taskId: string; artifactId: string; name: string; downloadUrl?: string; done: false }
  | { type: 'complete'; taskId: string; content: string; done: true }
  | { type: 'error'; taskId: string; error: string; done: true }

export interface AgentRuntimeHello {
  type: 'hello'
  protocolVersion: 1
  agentId: string
  publicKey: string
  nonce: string
}

export interface AgentRuntimeHeartbeat {
  type: 'heartbeat'
  agentId: string
  timestamp: number
  capabilities: { runtime: 'rootless-docker'; mcp: boolean }
}

export interface AgentRuntimeWorkspaceRequest {
  type: 'workspace.create' | 'workspace.stop' | 'workspace.destroy'
  requestId: string
  workspaceId: string
  limits?: { cpu: number; memoryMb: number; diskMb: number; timeoutSeconds: number }
}

export interface AgentRuntimeToolRequest {
  type: 'tool.execute'
  requestId: string
  taskId: string
  workspaceId: string
  tool: string
  arguments: Record<string, unknown>
}

export interface AgentRuntimeResponse {
  type: 'response'
  requestId: string
  ok: boolean
  content?: string
  data?: Record<string, unknown>
  error?: string
}
