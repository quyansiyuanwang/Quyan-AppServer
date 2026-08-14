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
}

export interface SupportCitationDto {
  slug: string;
  title: string;
  url: string;
}

export interface SupportAvailabilityDto {
  enabled: boolean;
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
