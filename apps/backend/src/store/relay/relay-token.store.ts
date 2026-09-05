import type {
  Prisma,
  RelayToken,
  RelayTokenChannelConfig,
  RelayTokenFailoverConfig,
  RelayChannelSwitchLog,
  RelayTokenQuotaWindow,
} from "@prisma/client";
import type { ContentSafetyPolicyOverride, RelayRequestFormatTransform } from "@quyan/shared";
import type { RelayTokenNormalizerConfig } from "@/util/anthropic-token-normalizer.util";

export type RelayTokenQuotaUnit = "amount" | "request" | "token";

const _relayChannelWithPoolInclude = {
  poolMembers: {
    include: { memberChannel: true },
    orderBy: { priority: "asc" },
  },
} satisfies Prisma.RelayChannelInclude;

export type RelayTokenWithRelations = Prisma.RelayTokenGetPayload<{
  include: {
    user: true;
    channel: {
      include: typeof _relayChannelWithPoolInclude;
    };
    automaticProxyPoolChannel: {
      include: typeof _relayChannelWithPoolInclude;
    };
    failoverConfig: true;
    channelConfigs: {
      include: {
        channel: {
          include: typeof _relayChannelWithPoolInclude;
        };
      };
      orderBy: { priority: "asc" };
    };
    quotaWindows: {
      orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }];
    };
  };
}>;

export type RelayTokenChannelConfigWithChannel = Prisma.RelayTokenChannelConfigGetPayload<{
  include: {
    channel: {
      include: typeof _relayChannelWithPoolInclude;
    };
  };
}>;

export type RelayTokenWithChannel = RelayTokenWithRelations;
export type RelayTokenTransactionClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
export type RelayTokenUsageSummaryTarget = Pick<
  RelayToken,
  "id" | "name" | "quotaLimit" | "usedQuota" | "requestCount" | "totalTokens" | "lastUsedAt"
> & {
  userId: string;
  user?: {
    id: string;
    username: string;
    name: string | null;
  } | null;
};

export type RelayTokenQuotaWindowSnapshot = Pick<
  RelayTokenQuotaWindow,
  "id" | "quotaLimit" | "quotaUnit" | "quotaWindowHours"
>;

export interface RelayTokenPageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RelayFailoverConfigInput {
  enabled?: boolean;
  maxRetries?: number;
  retryStatusCodes?: string[];
  failoverThreshold?: number;
  failbackCooldownMinutes?: number;
  maxAcceptedChannelMultiplier?: number | null;
}

export interface RelayTokenChannelConfigInput {
  channelId: string;
  priority: number;
}

export interface RelayTokenQuotaWindowInput {
  quotaLimit: number;
  quotaUnit: RelayTokenQuotaUnit;
  quotaWindowHours: number;
}

export interface RelayTokenCreateInput {
  userId: string;
  status?: number;
  name?: string | null;
  token: string;
  isCustomKey?: boolean;
  expiresAt?: Date | null;
  channelId?: string;
  routingMode?: "ordered" | "automatic-pool";
  automaticProxyPoolChannelId?: string;
  blockedAutomaticProxyPoolChannelIds?: string[];
  quotaLimit?: number | null;
  quotaWindows?: RelayTokenQuotaWindowInput[];
  allowedModels?: string | null;
  requestFormatTransforms?: RelayRequestFormatTransform[] | null;
  normalizerConfig?: RelayTokenNormalizerConfig | null;
  contentSafetyConfig?: ContentSafetyPolicyOverride | null;
  ipWhitelist?: string | null;
  modelMapping?: Record<string, string> | null;
  failoverConfig?: RelayFailoverConfigInput;
  channelConfigs?: RelayTokenChannelConfigInput[];
}

export type RelayTokenUpdateInput = Partial<{
  name: string | null;
  token: string;
  isCustomKey: boolean;
  balance: number;
  totalTokens: number;
  requestCount: number;
  lastUsedAt: Date;
  status: number;
  expiresAt: Date | null;
  quotaLimit: number | null;
  quotaWindows: RelayTokenQuotaWindowInput[];
  allowedModels: string | null;
  requestFormatTransforms: RelayRequestFormatTransform[] | null;
  normalizerConfig: RelayTokenNormalizerConfig | null;
  contentSafetyConfig: ContentSafetyPolicyOverride | null;
  ipWhitelist: string | null;
  modelMapping: Record<string, string> | null;
}> & {
  channelId?: string | null;
  routingMode?: "ordered" | "automatic-pool";
  automaticProxyPoolChannelId?: string | null;
  blockedAutomaticProxyPoolChannelIds?: string[];
  failoverConfig?: RelayFailoverConfigInput;
  channelConfigs?: RelayTokenChannelConfigInput[];
};

export interface RelayChannelConfigUsageUpdateInput {
  relayTokenId: string;
  channelId: string;
  success: boolean;
  usedAt?: Date;
}

export interface RelayChannelSwitchLogInput {
  relayTokenId: string;
  fromChannelId: string;
  fromDisplayChannelId?: string | null;
  fromDisplayChannelName?: string | null;
  toChannelId: string;
  toDisplayChannelId?: string | null;
  toDisplayChannelName?: string | null;
  triggerStatusCode?: number;
  triggerError?: string;
  attemptNumber: number;
  requestPath: string;
  method: string;
  modelName?: string;
}

export interface RelayTokenStore {
  create(data: RelayTokenCreateInput, tx?: RelayTokenTransactionClient): Promise<RelayTokenWithRelations>;
  withTransaction<T>(callback: (tx: RelayTokenTransactionClient) => Promise<T>): Promise<T>;
  withSerializableTransaction<T>(callback: (tx: RelayTokenTransactionClient) => Promise<T>): Promise<T>;
  findByToken(token: string): Promise<RelayTokenWithRelations | null>;
  findById(id: string): Promise<RelayToken | null>;
  findByIdWithRelations(id: string): Promise<RelayTokenWithRelations | null>;
  findByIdWithChannel(id: string): Promise<RelayTokenWithChannel | null>;
  findByUserId(userId: string): Promise<RelayToken[]>;
  findByUserIdWithRelations(userId: string): Promise<RelayTokenWithRelations[]>;
  findByUserIdWithRelationsByIds(
    userId: string,
    tokenIds: string[],
    statuses?: number[],
  ): Promise<RelayTokenWithRelations[]>;
  findPageByUserIdWithRelations(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<RelayTokenPageResult<RelayTokenWithRelations>>;
  findPageWithRelations(
    page: number,
    pageSize: number,
    userId?: string,
  ): Promise<RelayTokenPageResult<RelayTokenWithRelations>>;
  findByUserIdWithChannel(userId: string): Promise<RelayTokenWithChannel[]>;
  findUsageSummaryTargetsByUserId(userId: string): Promise<RelayTokenUsageSummaryTarget[]>;
  findUsageSummaryTargetsByIds(userId: string, tokenIds: string[]): Promise<RelayTokenUsageSummaryTarget[]>;
  findWithRelationsByIds(tokenIds: string[], statuses?: number[], userId?: string): Promise<RelayTokenWithRelations[]>;
  findUsageSummaryTargets(tokenIds?: string[], userId?: string): Promise<RelayTokenUsageSummaryTarget[]>;
  countCustomKeyTokensByUserId(userId: string): Promise<number>;
  countCustomKeyTokensCreatedSince(userId: string, since: Date): Promise<number>;
  update(id: string, data: RelayTokenUpdateInput): Promise<RelayToken>;
  updateStatus(id: string, status: number): Promise<RelayToken>;
  updateStatusByIds(userId: string, ids: string[], status: number): Promise<number>;
  replaceChannelConfigs(
    relayTokenId: string,
    channelId: string | null,
    configs: RelayTokenChannelConfigInput[],
    tx?: RelayTokenTransactionClient,
  ): Promise<void>;
  replaceQuotaWindows(relayTokenId: string, quotaWindows: RelayTokenQuotaWindowInput[]): Promise<void>;
  updateFailoverConfig(
    relayTokenId: string,
    failoverConfig: RelayFailoverConfigInput,
  ): Promise<RelayTokenFailoverConfig>;
  updateChannelConfigUsage(data: RelayChannelConfigUsageUpdateInput): Promise<RelayTokenChannelConfig | null>;
  createSwitchLog(data: RelayChannelSwitchLogInput): Promise<RelayChannelSwitchLog>;
  listSwitchLogs(relayTokenId: string, limit?: number): Promise<RelayChannelSwitchLog[]>;
  delete(id: string): Promise<RelayToken>;
  deleteByIds(userId: string, ids: string[]): Promise<number>;
  deleteByIdsForScope(ids: string[], userId?: string): Promise<number>;
  updateStatusByIdsForScope(ids: string[], status: number, userId?: string): Promise<number>;
  updateContentSafetyConfigByIdsForScope(
    ids: string[],
    config: ContentSafetyPolicyOverride | null,
    userId?: string,
  ): Promise<number>;
}
