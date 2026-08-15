import type { RelayRequestFormat } from "@appserver/shared";

export interface SupportMessageDto {
  role: "user" | "assistant";
  content: string;
}

export interface SupportPageContextDto {
  site?: string;
  route?: string;
  title?: string;
  url?: string;
  visibleText?: string;
}

export interface SendSupportMessageDto {
  content: string;
  history?: SupportMessageDto[];
  locale?: "zh-CN" | "en";
  page?: SupportPageContextDto;
  /** Platform billing is the default. User Relay mode is accepted only when both administrator flags are enabled. */
  fundingMode?: "platform" | "user-relay";
  /** One-request Relay Token; never persisted in support conversation storage. */
  relayToken?: string;
  /** First-party Relay Base URL shown by the console, without an API path suffix. */
  relayBaseUrl?: string;
  /** Model to request through the user's Relay Token. */
  relayModel?: string;
}

export interface SupportCitationDto {
  slug: string;
  title: string;
  url: string;
}

export interface SupportAvailabilityDto {
  enabled: boolean;
  allowUserBalance: boolean;
  allowUserRelayToken: boolean;
}

export interface SupportConversationDto {
  messages: SupportMessageDto[];
}

export interface SupportHandoffDto {
  title: string;
  description: string;
  sourcePage?: string;
}

export interface SupportHandoffResultDto {
  ticketId: string;
}

export interface SupportAiConfigDto {
  enabled: boolean;
  upstreamUrl: string;
  apiKeyConfigured: boolean;
  model: string;
  requestFormat: RelayRequestFormat;
  systemPrompt: string;
  maxRequests: number;
  windowSeconds: number;
  /** Maximum tool-planning turns before the agent must produce a final answer. */
  maxAgentRounds: number;
  /** Hard upper bound for the final answer returned by the configured upstream. */
  maxOutputTokens: number;
  /** Whether an individual user may opt into charging their own platform balance. Disabled by default. */
  allowUserBalance: boolean;
  /** Whether an individual user may supply a personally owned Relay Token. Disabled by default. */
  allowUserRelayToken: boolean;
  sessionRetentionDays: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export interface UpdateSupportAiConfigDto {
  enabled: boolean;
  upstreamUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
  model: string;
  requestFormat: RelayRequestFormat;
  systemPrompt?: string;
  maxRequests: number;
  windowSeconds: number;
  maxAgentRounds?: number;
  maxOutputTokens?: number;
  allowUserBalance?: boolean;
  allowUserRelayToken?: boolean;
  sessionRetentionDays?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface SupportAiAnalyticsQueryDto {
  page?: number;
  pageSize?: number;
  startAt?: string;
  endAt?: string;
  userId?: string;
}

export interface SupportAiUsageUserDto {
  userId: string;
  username: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  lastRequestAt: Date;
}

export interface SupportAiUsageTrendDto {
  date: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface SupportAiAnalyticsDto {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCost: number;
  trends: SupportAiUsageTrendDto[];
  users: SupportAiUsageUserDto[];
  totalUsers: number;
}
