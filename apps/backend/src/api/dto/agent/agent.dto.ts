import type { AgentTaskStatus, AgentWorkspaceStatus, AgentToolCall } from "@quyan/shared";

export interface AgentWorkspacePolicyDto {
  allowedCommands?: string[];
  allowedPaths?: string[];
  allowedHosts?: string[];
  autoApproveReadOnly?: boolean;
}

export interface AgentWorkspaceLimitsDto {
  cpu?: number;
  memoryMb?: number;
  diskMb?: number;
  timeoutSeconds?: number;
  maxSteps?: number;
  budget?: number;
}

export interface CreateAgentWorkspaceRequest {
  name: string;
  policy?: AgentWorkspacePolicyDto;
  limits?: AgentWorkspaceLimitsDto;
  machineId?: string;
}

export interface AgentWorkspaceResponse {
  id: string;
  name: string;
  runtime: string;
  runtimeStatus: AgentWorkspaceStatus;
  policy: AgentWorkspacePolicyDto;
  limits: AgentWorkspaceLimitsDto;
  createTime: Date;
  machineId?: string;
  machineName?: string;
  machineStatus?: string;
}

export interface CreateAgentMachineRequest {
  name: string;
}

export interface AgentMachineResponse {
  id: string;
  name: string;
  runtime: string;
  runtimeStatus: string;
  agentId?: string;
  capabilities: Record<string, unknown>;
  lastHeartbeatAt?: Date;
  registrationToken?: string;
}

export interface BindAgentWorkspaceMachineRequest {
  machineId: string | null;
}

export interface CreateAgentRunRequest {
  content: string;
  model: string;
  relayTokenId?: string;
  workspaceId: string;
  maxSteps?: number;
  budget?: number;
}

export interface AgentRunResponse {
  id: string;
  workspaceId: string;
  status: AgentTaskStatus;
  model: string;
  stepCount: number;
  createTime: Date;
}

export interface AgentEventResponse {
  sequence: number;
  event: unknown;
  createTime: Date;
}

export interface AgentApprovalResponse {
  id: string;
  taskId: string;
  status: string;
  toolCall: AgentToolCall;
  expiresAt: Date;
}

export interface DecideAgentApprovalRequest {
  decision: "approved" | "rejected";
}

export interface CreateMcpServerRequest {
  name: string;
  endpoint?: string;
  transport?: "streamable-http" | "sse";
  toolAllowlist?: string[];
  credential?: Record<string, string>;
}

export interface McpServerResponse {
  id: string;
  name: string;
  endpoint?: string;
  transport: string;
  enabled: boolean;
  toolAllowlist: string[];
  hasCredential: boolean;
}
