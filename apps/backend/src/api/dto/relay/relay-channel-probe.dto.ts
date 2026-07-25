export type RelayChannelProbeFormat = "openai" | "anthropic" | "gemini";
export type RelayChannelProbeRunStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled";

export interface RelayChannelProbeWorkflowStepDto {
  name: string;
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  extract?: Record<string, string>;
  balancePath?: string;
}

export interface RelayChannelProbeProfileDto {
  id: string;
  relayChannelId: string;
  enabled: boolean;
  probeFormat: RelayChannelProbeFormat;
  probeModel: string;
  probePayload: Record<string, unknown>;
  upstreamCurrency: string;
  localCurrency: string;
  distributionMultiplier: number;
  workflow: RelayChannelProbeWorkflowStepDto[];
  credentialNames: string[];
  createTime: Date;
  updateTime: Date;
}

export interface UpsertRelayChannelProbeProfileRequest {
  enabled: boolean;
  probeFormat: RelayChannelProbeFormat;
  probeModel: string;
  probePayload: Record<string, unknown>;
  upstreamCurrency?: string;
  localCurrency?: string;
  distributionMultiplier?: number;
  workflow: RelayChannelProbeWorkflowStepDto[];
  credentials?: Record<string, string>;
}

export interface CreateRelayChannelProbeRunRequest {
  distributionMultiplier?: number;
}

export interface RelayChannelProbeRunDto {
  id: string;
  relayChannelId: string;
  profileId: string;
  status: RelayChannelProbeRunStatus;
  queuedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  distributionMultiplier: number;
  upstreamBalanceBefore?: number;
  upstreamBalanceAfter?: number;
  upstreamBalanceDelta?: number;
  localBalanceBefore?: number;
  localBalanceAfter?: number;
  localBalanceDelta?: number;
  baseLocalCost?: number;
  requestTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  suggestedMultiplier?: number;
  sourceChannelMultiplier?: number;
  appliedMultiplier?: number;
  appliedAt?: Date;
  errorMessage?: string;
  requestedByUserId: string;
  createTime: Date;
  updateTime: Date;
}

export interface RelayChannelProbeRunPageDto {
  items: RelayChannelProbeRunDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RelayChannelProbeOverviewItemDto {
  channelId: string;
  channelName: string;
  enabled: boolean;
  multiplier: number;
  profile?: RelayChannelProbeProfileDto;
  latestRun?: RelayChannelProbeRunDto;
}

export interface ApplyRelayChannelProbeRunsRequest {
  runIds: string[];
}

export interface ApplyRelayChannelProbeRunsResponse {
  applied: number;
  rejected: Array<{ runId: string; reason: string }>;
}
