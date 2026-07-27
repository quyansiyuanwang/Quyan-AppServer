import type { RelayUsage } from "@prisma/client";

export type RelayUsageWithTokenName = RelayUsage & {
  relayToken: {
    name: string | null;
    routingMode: string;
    automaticProxyPoolChannel: {
      name: string;
    } | null;
  } | null;
  logicalRequest: {
    requestId: string;
  } | null;
  hasHiddenExecutionChannel: boolean;
  monthlyPassUsages: Array<{
    channelName: string | null;
  }>;
};

export interface RelayUsageCreateInput {
  relayTokenId: string;
  executionChannelId?: string | null;
  displayChannelId?: string | null;
  displayChannelName?: string | null;
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  path: string;
  method: string;
  statusCode: number;
  ipAddress: string;
  totalOutputTime?: number;
  timeToFirstByte?: number | null;
  isStreaming?: boolean;
}

export interface RelayTokenUsageAggregate {
  relayTokenId: string;
  requestCount: number;
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  chargedAmount: number;
  coveredAmount: number;
  lastUsedAt?: Date;
}

export type RelayUsageWithAmounts = RelayUsage & {
  chargedAmount: number;
  coveredAmount: number;
  totalSpend: number;
};

export interface RelayUsageDetailPage {
  total: number;
  usages: RelayUsageWithAmounts[];
}

export interface RelayUsageStore {
  create(data: RelayUsageCreateInput): Promise<RelayUsage>;
  findByRelayTokenId(relayTokenId: string, startDate?: Date, endDate?: Date): Promise<RelayUsage[]>;
  findByIdsWithTokenName(ids: string[]): Promise<RelayUsageWithTokenName[]>;
  aggregateByRelayTokenIds(
    relayTokenIds: string[],
    startDate?: Date,
    endDate?: Date,
  ): Promise<RelayTokenUsageAggregate[]>;
  findUsageDetailPageByRelayTokenId(
    relayTokenId: string,
    startDate?: Date,
    endDate?: Date,
    limit?: number,
    offset?: number,
  ): Promise<RelayUsageDetailPage>;
  findRequestDiagnostics(query: {
    page: number;
    pageSize: number;
    requestId?: string;
    keyword?: string;
    channelId?: string;
    outcome?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{ total: number; records: Array<any> }>;
}
