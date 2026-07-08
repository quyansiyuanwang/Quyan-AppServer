import { RelayToken, Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import type {
  RelayChannelConfigUsageUpdateInput,
  RelayChannelSwitchLogInput,
  RelayFailoverConfigInput,
  RelayTokenChannelConfigInput,
  RelayTokenCreateInput,
  RelayTokenPageResult,
  RelayTokenQuotaWindowInput,
  RelayTokenStore,
  RelayTokenTransactionClient,
  RelayTokenUsageSummaryTarget,
  RelayTokenUpdateInput,
} from "./relay-token.store";
import type { RelayTokenWithRelations } from "./relay-token.store";
import { MANAGED_STATUS } from "@/constant/status";

export type { RelayTokenWithRelations } from "./relay-token.store";
export type RelayTokenWithChannel = RelayTokenWithRelations;

const visibleRelayTokenStatuses = [MANAGED_STATUS.DISABLED, MANAGED_STATUS.ENABLED] as const;

const relayTokenInclude = {
  user: true,
  channel: true,
  failoverConfig: true,
  channelConfigs: {
    include: { channel: true },
    orderBy: { priority: "asc" },
  },
  quotaWindows: {
    orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }],
  },
} satisfies Prisma.RelayTokenInclude;

const relayTokenUsageSummarySelect = {
  id: true,
  userId: true,
  user: {
    select: {
      id: true,
      username: true,
      name: true,
    },
  },
  name: true,
  quotaLimit: true,
  usedQuota: true,
  requestCount: true,
  totalTokens: true,
  lastUsedAt: true,
} satisfies Prisma.RelayTokenSelect;

const buildNestedFailoverConfigCreateData = (failoverConfig: RelayFailoverConfigInput) => {
  return {
    enabled: failoverConfig.enabled ?? false,
    maxRetries: failoverConfig.maxRetries ?? 0,
    retryStatusCodes: failoverConfig.retryStatusCodes ?? [],
    failoverThreshold: failoverConfig.failoverThreshold ?? 0,
    failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes ?? 0,
  } satisfies Prisma.RelayTokenFailoverConfigCreateWithoutRelayTokenInput;
};

const buildFailoverConfigCreateData = (relayTokenId: string, failoverConfig: RelayFailoverConfigInput) => {
  return {
    relayTokenId,
    enabled: failoverConfig.enabled ?? false,
    maxRetries: failoverConfig.maxRetries ?? 0,
    retryStatusCodes: failoverConfig.retryStatusCodes ?? [],
    failoverThreshold: failoverConfig.failoverThreshold ?? 0,
    failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes ?? 0,
  } satisfies Prisma.RelayTokenFailoverConfigUncheckedCreateInput;
};

const buildFailoverConfigUpdateData = (failoverConfig: RelayFailoverConfigInput) => {
  return {
    enabled: failoverConfig.enabled,
    maxRetries: failoverConfig.maxRetries,
    retryStatusCodes: failoverConfig.retryStatusCodes,
    failoverThreshold: failoverConfig.failoverThreshold,
    failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes,
  } satisfies Prisma.RelayTokenFailoverConfigUncheckedUpdateInput;
};

const buildChannelConfigCreateManyData = (configs: RelayTokenChannelConfigInput[]) =>
  configs.map((config) => ({
    channelId: config.channelId,
    priority: config.priority,
  }));

const buildQuotaWindowCreateManyData = (quotaWindows: RelayTokenQuotaWindowInput[]) =>
  quotaWindows.map((quotaWindow) => ({
    quotaLimit: quotaWindow.quotaLimit,
    quotaUnit: quotaWindow.quotaUnit,
    quotaWindowHours: quotaWindow.quotaWindowHours,
  }));

export class RelayTokenRepository implements RelayTokenStore {
  private static instance: RelayTokenRepository;

  public static getInstance(): RelayTokenRepository {
    if (!RelayTokenRepository.instance) RelayTokenRepository.instance = new RelayTokenRepository();

    return RelayTokenRepository.instance;
  }

  async withTransaction<T>(callback: (tx: RelayTokenTransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => callback(tx as RelayTokenTransactionClient));
  }

  async create(data: RelayTokenCreateInput, tx?: RelayTokenTransactionClient): Promise<RelayTokenWithRelations> {
    const failoverConfigCreateData = data.failoverConfig
      ? buildNestedFailoverConfigCreateData(data.failoverConfig)
      : undefined;

    const client = tx ?? prisma;

    return client.relayToken.create({
      data: {
        userId: data.userId,
        status: data.status,
        name: data.name,
        token: data.token,
        isCustomKey: data.isCustomKey ?? false,
        expiresAt: data.expiresAt,
        channelId: data.channelId,
        quotaLimit: data.quotaLimit,
        allowedModels: data.allowedModels,
        ipWhitelist: data.ipWhitelist,
        modelMapping: data.modelMapping ?? undefined,
        failoverConfig: failoverConfigCreateData
          ? {
              create: failoverConfigCreateData,
            }
          : undefined,
        channelConfigs:
          data.channelConfigs && data.channelConfigs.length > 0
            ? {
                createMany: {
                  data: buildChannelConfigCreateManyData(data.channelConfigs),
                },
              }
            : undefined,
        quotaWindows:
          data.quotaWindows && data.quotaWindows.length > 0
            ? {
                createMany: {
                  data: buildQuotaWindowCreateManyData(data.quotaWindows),
                },
              }
            : undefined,
      },
      include: relayTokenInclude,
    });
  }

  async findByToken(token: string): Promise<RelayTokenWithRelations | null> {
    return prisma.relayToken.findUnique({
      where: { token },
      include: relayTokenInclude,
    });
  }

  async findById(id: string): Promise<RelayToken | null> {
    return prisma.relayToken.findUnique({ where: { id } });
  }

  async findByIdWithRelations(id: string): Promise<RelayTokenWithRelations | null> {
    return prisma.relayToken.findUnique({
      where: { id },
      include: relayTokenInclude,
    });
  }

  async findByIdWithChannel(id: string): Promise<RelayTokenWithRelations | null> {
    return this.findByIdWithRelations(id);
  }

  async findByUserId(userId: string): Promise<RelayToken[]> {
    return prisma.relayToken.findMany({
      where: { userId, status: { in: [MANAGED_STATUS.DISABLED, MANAGED_STATUS.ENABLED] } },
      orderBy: { createTime: "desc" },
    });
  }

  async findByUserIdWithRelations(userId: string): Promise<RelayTokenWithRelations[]> {
    return prisma.relayToken.findMany({
      where: { userId, status: { in: [...visibleRelayTokenStatuses] } },
      include: relayTokenInclude,
      orderBy: { createTime: "desc" },
    });
  }

  async findByUserIdWithRelationsByIds(
    userId: string,
    tokenIds: string[],
    statuses: number[] = [...visibleRelayTokenStatuses],
  ): Promise<RelayTokenWithRelations[]> {
    if (tokenIds.length === 0) return [];

    return prisma.relayToken.findMany({
      where: {
        userId,
        id: { in: tokenIds },
        status: { in: statuses },
      },
      include: relayTokenInclude,
    });
  }

  async findPageByUserIdWithRelations(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<RelayTokenPageResult<RelayTokenWithRelations>> {
    return this.findPageWithRelations(page, pageSize, userId);
  }

  async findPageWithRelations(
    page: number,
    pageSize: number,
    userId?: string,
  ): Promise<RelayTokenPageResult<RelayTokenWithRelations>> {
    const normalizedPage = Math.max(1, Math.trunc(page));
    const normalizedPageSize = Math.min(100, Math.max(1, Math.trunc(pageSize)));
    const where = {
      ...(userId ? { userId } : {}),
      status: { in: [...visibleRelayTokenStatuses] },
    } satisfies Prisma.RelayTokenWhereInput;

    const total = await prisma.relayToken.count({ where });
    const totalPages = total > 0 ? Math.ceil(total / normalizedPageSize) : 1;
    const currentPage = total > 0 ? Math.min(normalizedPage, totalPages) : 1;

    const items = await prisma.relayToken.findMany({
      where,
      include: relayTokenInclude,
      orderBy: { createTime: "desc" },
      skip: (currentPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
    });

    return {
      items,
      total,
      page: currentPage,
      pageSize: normalizedPageSize,
    };
  }

  async findByUserIdWithChannel(userId: string): Promise<RelayTokenWithRelations[]> {
    return this.findByUserIdWithRelations(userId);
  }

  async findUsageSummaryTargetsByUserId(userId: string): Promise<RelayTokenUsageSummaryTarget[]> {
    return this.findUsageSummaryTargets(undefined, userId);
  }

  async findUsageSummaryTargets(tokenIds?: string[], userId?: string): Promise<RelayTokenUsageSummaryTarget[]> {
    return prisma.relayToken.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(tokenIds?.length ? { id: { in: tokenIds } } : {}),
        status: { in: [...visibleRelayTokenStatuses] },
      },
      select: relayTokenUsageSummarySelect,
      orderBy: { createTime: "desc" },
    });
  }

  async findUsageSummaryTargetsByIds(userId: string, tokenIds: string[]): Promise<RelayTokenUsageSummaryTarget[]> {
    return this.findUsageSummaryTargets(tokenIds, userId);
  }

  async findWithRelationsByIds(
    tokenIds: string[],
    statuses: number[] = [...visibleRelayTokenStatuses],
    userId?: string,
  ): Promise<RelayTokenWithRelations[]> {
    if (tokenIds.length === 0) return [];

    return prisma.relayToken.findMany({
      where: {
        ...(userId ? { userId } : {}),
        id: { in: tokenIds },
        status: { in: statuses },
      },
      include: relayTokenInclude,
    });
  }

  async countCustomKeyTokensByUserId(userId: string): Promise<number> {
    return prisma.relayToken.count({
      where: {
        userId,
        isCustomKey: true,
        status: { in: [...visibleRelayTokenStatuses] },
      },
    });
  }

  async countCustomKeyTokensCreatedSince(userId: string, since: Date): Promise<number> {
    return prisma.relayToken.count({
      where: {
        userId,
        isCustomKey: true,
        createTime: { gte: since },
      },
    });
  }

  async incrementUsageStats(id: string, totalTokens: number): Promise<RelayToken> {
    return prisma.relayToken.update({
      where: { id },
      data: {
        totalTokens: { increment: totalTokens },
        requestCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  async touchRequest(id: string): Promise<RelayToken> {
    return prisma.relayToken.update({
      where: { id },
      data: {
        requestCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  async update(id: string, data: RelayTokenUpdateInput): Promise<RelayToken> {
    const { failoverConfig, channelConfigs, quotaWindows, channelId, modelMapping, ...tokenData } = data;

    return prisma.$transaction(async (tx) => {
      const updatedToken = await tx.relayToken.update({
        where: { id },
        data: {
          ...tokenData,
          ...(channelId !== undefined ? { channelId } : {}),
          ...(modelMapping !== undefined ? { modelMapping: modelMapping as Prisma.InputJsonValue } : {}),
        },
      });

      if (failoverConfig)
        await tx.relayTokenFailoverConfig.upsert({
          where: { relayTokenId: id },
          create: buildFailoverConfigCreateData(id, failoverConfig),
          update: buildFailoverConfigUpdateData(failoverConfig),
        });

      if (channelConfigs)
        await this.replaceChannelConfigsInternal(tx, id, channelId ?? updatedToken.channelId, channelConfigs);

      if (quotaWindows !== undefined) await this.replaceQuotaWindowsInternal(tx, id, quotaWindows);

      return updatedToken;
    });
  }

  async updateStatus(id: string, status: number): Promise<RelayToken> {
    return prisma.relayToken.update({ where: { id }, data: { status } });
  }

  async updateStatusByIds(userId: string, ids: string[], status: number): Promise<number> {
    return this.updateStatusByIdsForScope(ids, status, userId);
  }

  async updateStatusByIdsForScope(ids: string[], status: number, userId?: string): Promise<number> {
    const result = await prisma.relayToken.updateMany({
      where: {
        ...(userId ? { userId } : {}),
        id: { in: ids },
        status: { in: [...visibleRelayTokenStatuses] },
      },
      data: { status },
    });

    return result.count;
  }

  async replaceChannelConfigs(
    relayTokenId: string,
    channelId: string | null,
    configs: RelayTokenChannelConfigInput[],
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await this.replaceChannelConfigsInternal(tx, relayTokenId, channelId, configs);
    });
  }

  async replaceQuotaWindows(relayTokenId: string, quotaWindows: RelayTokenQuotaWindowInput[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await this.replaceQuotaWindowsInternal(tx, relayTokenId, quotaWindows);
    });
  }

  async updateFailoverConfig(relayTokenId: string, failoverConfig: RelayFailoverConfigInput) {
    return prisma.relayTokenFailoverConfig.upsert({
      where: { relayTokenId },
      create: buildFailoverConfigCreateData(relayTokenId, failoverConfig),
      update: buildFailoverConfigUpdateData(failoverConfig),
    });
  }

  async updateChannelConfigUsage(data: RelayChannelConfigUsageUpdateInput) {
    const usedAt = data.usedAt || new Date();

    return prisma.relayTokenChannelConfig.upsert({
      where: {
        relayTokenId_channelId: {
          relayTokenId: data.relayTokenId,
          channelId: data.channelId,
        },
      },
      create: {
        relayTokenId: data.relayTokenId,
        channelId: data.channelId,
        priority: 0,
        lastUsedAt: usedAt,
        successCount: data.success ? 1 : 0,
        failureCount: data.success ? 0 : 1,
        lastSuccessAt: data.success ? usedAt : undefined,
        lastFailureAt: data.success ? undefined : usedAt,
      },
      update: {
        lastUsedAt: usedAt,
        ...(data.success
          ? {
              successCount: { increment: 1 },
              lastSuccessAt: usedAt,
            }
          : {
              failureCount: { increment: 1 },
              lastFailureAt: usedAt,
            }),
      },
    });
  }

  async createSwitchLog(data: RelayChannelSwitchLogInput) {
    return prisma.relayChannelSwitchLog.create({
      data: {
        relayTokenId: data.relayTokenId,
        fromChannelId: data.fromChannelId,
        toChannelId: data.toChannelId,
        triggerStatusCode: data.triggerStatusCode,
        triggerError: data.triggerError,
        attemptNumber: data.attemptNumber,
        requestPath: data.requestPath,
        method: data.method,
        modelName: data.modelName,
      },
    });
  }

  async listSwitchLogs(relayTokenId: string, limit: number = 50) {
    return prisma.relayChannelSwitchLog.findMany({
      where: { relayTokenId },
      orderBy: { createTime: "desc" },
      take: limit,
    });
  }

  async delete(id: string): Promise<RelayToken> {
    return prisma.relayToken.update({
      where: { id },
      data: { status: MANAGED_STATUS.DELETED },
    });
  }

  async deleteByIds(userId: string, ids: string[]): Promise<number> {
    return this.deleteByIdsForScope(ids, userId);
  }

  async deleteByIdsForScope(ids: string[], userId?: string): Promise<number> {
    const result = await prisma.relayToken.updateMany({
      where: {
        ...(userId ? { userId } : {}),
        id: { in: ids },
        status: { in: [...visibleRelayTokenStatuses] },
      },
      data: { status: MANAGED_STATUS.DELETED },
    });

    return result.count;
  }

  private async replaceChannelConfigsInternal(
    tx: Prisma.TransactionClient,
    relayTokenId: string,
    channelId: string | null,
    configs: RelayTokenChannelConfigInput[],
  ): Promise<void> {
    await tx.relayToken.update({
      where: { id: relayTokenId },
      data: { channelId },
    });

    await tx.relayTokenChannelConfig.deleteMany({
      where: { relayTokenId },
    });

    if (configs.length === 0) return;

    await tx.relayTokenChannelConfig.createMany({
      data: configs.map((config) => ({
        relayTokenId,
        channelId: config.channelId,
        priority: config.priority,
      })),
    });
  }

  private async replaceQuotaWindowsInternal(
    tx: Prisma.TransactionClient,
    relayTokenId: string,
    quotaWindows: RelayTokenQuotaWindowInput[],
  ): Promise<void> {
    await tx.relayTokenQuotaWindow.deleteMany({
      where: { relayTokenId },
    });

    if (quotaWindows.length === 0) return;

    await tx.relayTokenQuotaWindow.createMany({
      data: quotaWindows.map((quotaWindow) => ({
        relayTokenId,
        quotaLimit: quotaWindow.quotaLimit,
        quotaUnit: quotaWindow.quotaUnit,
        quotaWindowHours: quotaWindow.quotaWindowHours,
      })),
    });
  }
}
