export interface ConsumptionUsageRow {
  usageId: string;
  userId: string;
  username: string | null;
  createTime: Date;
  model: string;
  channelName: string;
  relayTokenId: string | null;
  relayTokenName: string | null;
  chargedAmount: number;
  coveredAmount: number;
  totalSpend: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ConsumptionStatsFilters {
  userIds?: string[];
  models?: string[];
  channels?: string[];
  relayTokenIds?: string[];
}

export interface ConsumptionStatsStore {
  listUsageRows(startTime: Date, endTime: Date): Promise<ConsumptionUsageRow[]>;
}
