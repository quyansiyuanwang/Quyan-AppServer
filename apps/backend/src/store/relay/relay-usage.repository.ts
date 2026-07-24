import { RelayUsage } from "@prisma/client";
import { prisma } from "@/config/database";
import type {
  RelayTokenUsageAggregate,
  RelayUsageCreateInput,
  RelayUsageDetailPage,
  RelayUsageStore,
  RelayUsageWithAmounts,
  RelayUsageWithTokenName,
} from "./relay-usage.store";
import { RECORD_STATUS } from "@/constant/status";
import { extractLegacyMonthlyPassCoveredAmount } from "@/util/monthly-pass-coverage.util";

export type { RelayUsageWithTokenName } from "./relay-usage.store";

export class RelayUsageRepository implements RelayUsageStore {
  private static instance: RelayUsageRepository;
  private static readonly BILLING_QUERY_CHUNK_SIZE = 1000;

  private constructor() {}

  public static getInstance(): RelayUsageRepository {
    if (!RelayUsageRepository.instance) RelayUsageRepository.instance = new RelayUsageRepository();

    return RelayUsageRepository.instance;
  }

  async create(data: RelayUsageCreateInput): Promise<RelayUsage> {
    return prisma.relayUsage.create({ data });
  }

  async findByRelayTokenId(relayTokenId: string, startDate?: Date, endDate?: Date): Promise<RelayUsage[]> {
    const where: any = { relayTokenId, status: RECORD_STATUS.ACTIVE };
    if (startDate || endDate) {
      where.createTime = {};
      if (startDate) where.createTime.gte = startDate;
      if (endDate) where.createTime.lte = endDate;
    }
    return prisma.relayUsage.findMany({
      where,
      orderBy: { createTime: "desc" },
    });
  }

  async findByIdsWithTokenName(ids: string[]): Promise<RelayUsageWithTokenName[]> {
    if (ids.length === 0) return [];

    const uniqueIds = [...new Set(ids)];
    const usages: Array<Omit<RelayUsageWithTokenName, "monthlyPassUsages">> = [];
    const monthlyPassUsagesByRelayUsageId = new Map<string, Array<{ channelName: string | null }>>();

    for (let index = 0; index < uniqueIds.length; index += RelayUsageRepository.BILLING_QUERY_CHUNK_SIZE) {
      const idChunk = uniqueIds.slice(index, index + RelayUsageRepository.BILLING_QUERY_CHUNK_SIZE);
      const [usageChunk, monthlyPassUsageChunk] = await Promise.all([
        prisma.relayUsage.findMany({
          where: { id: { in: idChunk } },
          include: {
            relayToken: {
              select: { name: true },
            },
          },
        }),
        prisma.monthlyPassUsage.findMany({
          where: { relayUsageId: { in: idChunk } },
          select: { relayUsageId: true, channelName: true },
        }),
      ]);

      usages.push(...usageChunk);
      for (const monthlyPassUsage of monthlyPassUsageChunk) {
        if (!monthlyPassUsage.relayUsageId) continue;
        const relatedUsages = monthlyPassUsagesByRelayUsageId.get(monthlyPassUsage.relayUsageId) || [];
        relatedUsages.push({ channelName: monthlyPassUsage.channelName });
        monthlyPassUsagesByRelayUsageId.set(monthlyPassUsage.relayUsageId, relatedUsages);
      }
    }

    return usages.map((usage) => ({
      ...usage,
      monthlyPassUsages: monthlyPassUsagesByRelayUsageId.get(usage.id) || [],
    }));
  }

  async aggregateByRelayTokenIds(
    relayTokenIds: string[],
    startDate?: Date,
    endDate?: Date,
  ): Promise<RelayTokenUsageAggregate[]> {
    if (relayTokenIds.length === 0) return [];

    const where = this.buildRelayUsageWhere(relayTokenIds, startDate, endDate);
    const logicalRequestWhere = {
      relayTokenId: { in: relayTokenIds },
      countedAt: { not: null },
      ...(startDate || endDate
        ? {
            createTime: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
    };

    const [aggregateRows, usageReferences, logicalRequestRows] = await Promise.all([
      prisma.relayUsage.groupBy({
        by: ["relayTokenId"],
        where,
        _count: {
          _all: true,
        },
        _sum: {
          requestTokens: true,
          responseTokens: true,
          totalTokens: true,
          cacheCreationTokens: true,
          cacheReadTokens: true,
        },
        _max: {
          createTime: true,
        },
      }),
      prisma.relayUsage.findMany({
        where,
        select: {
          id: true,
          relayTokenId: true,
        },
      }),
      prisma.relayLogicalRequest.groupBy({
        by: ["relayTokenId"],
        where: logicalRequestWhere,
        _count: { _all: true },
      }),
    ]);

    if (aggregateRows.length === 0) return [];

    const billingMap = await this.buildBillingAmountMap(usageReferences.map((usage) => usage.id));
    const logicalRequestCountByRelayTokenId = new Map(
      logicalRequestRows.map((row) => [row.relayTokenId, Number(row._count._all || 0)]),
    );
    const billingTotalsByRelayTokenId = new Map<string, { chargedAmount: number; coveredAmount: number }>();

    for (const usage of usageReferences) {
      const billing = billingMap.get(usage.id) || { chargedAmount: 0, coveredAmount: 0 };
      const current = billingTotalsByRelayTokenId.get(usage.relayTokenId) || { chargedAmount: 0, coveredAmount: 0 };

      current.chargedAmount += billing.chargedAmount;
      current.coveredAmount += billing.coveredAmount;
      billingTotalsByRelayTokenId.set(usage.relayTokenId, current);
    }

    return aggregateRows.map((row) => ({
      relayTokenId: row.relayTokenId,
      requestCount: logicalRequestCountByRelayTokenId.get(row.relayTokenId) || 0,
      requestTokens: Number(row._sum.requestTokens || 0),
      responseTokens: Number(row._sum.responseTokens || 0),
      totalTokens: Number(row._sum.totalTokens || 0),
      cacheCreationTokens: Number(row._sum.cacheCreationTokens || 0),
      cacheReadTokens: Number(row._sum.cacheReadTokens || 0),
      chargedAmount: billingTotalsByRelayTokenId.get(row.relayTokenId)?.chargedAmount || 0,
      coveredAmount: billingTotalsByRelayTokenId.get(row.relayTokenId)?.coveredAmount || 0,
      lastUsedAt: row._max.createTime ?? undefined,
    }));
  }

  async findUsageDetailPageByRelayTokenId(
    relayTokenId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 20,
    offset: number = 0,
  ): Promise<RelayUsageDetailPage> {
    const where = this.buildRelayUsageWhere([relayTokenId], startDate, endDate);
    const [total, usages] = await Promise.all([
      prisma.relayUsage.count({ where }),
      prisma.relayUsage.findMany({
        where,
        orderBy: { createTime: "desc" },
        skip: offset,
        take: limit,
      }),
    ]);

    if (usages.length === 0) return { total, usages: [] };

    const billingMap = await this.buildBillingAmountMap(usages.map((usage) => usage.id));

    const usageRows: RelayUsageWithAmounts[] = usages.map((usage) => {
      const billing = billingMap.get(usage.id) || { chargedAmount: 0, coveredAmount: 0 };
      return {
        ...usage,
        chargedAmount: billing.chargedAmount,
        coveredAmount: billing.coveredAmount,
        totalSpend: billing.chargedAmount + billing.coveredAmount,
      };
    });

    return {
      total,
      usages: usageRows,
    };
  }

  private buildRelayUsageWhere(relayTokenIds: string[], startDate?: Date, endDate?: Date) {
    const where: {
      relayTokenId: { in: string[] };
      status: number;
      createTime?: { gte?: Date; lte?: Date };
    } = {
      relayTokenId: { in: relayTokenIds },
      status: RECORD_STATUS.ACTIVE,
    };

    if (startDate || endDate) {
      where.createTime = {};
      if (startDate) where.createTime.gte = startDate;
      if (endDate) where.createTime.lte = endDate;
    }

    return where;
  }

  private async buildBillingAmountMap(
    usageIds: string[],
  ): Promise<Map<string, { chargedAmount: number; coveredAmount: number }>> {
    if (usageIds.length === 0) return new Map();

    const coveredAmountByUsageId = new Map<string, number>();
    const chargedAmountByUsageId = new Map<string, number>();

    for (const usageIdChunk of this.chunkValues(usageIds, RelayUsageRepository.BILLING_QUERY_CHUNK_SIZE)) {
      const [apiUsageGroups, monthlyPassGroups] = await Promise.all([
        prisma.balanceTransaction.groupBy({
          by: ["relatedId"],
          where: {
            status: RECORD_STATUS.ACTIVE,
            relatedId: { in: usageIdChunk },
            type: "api_usage",
          },
          _sum: {
            amount: true,
          },
        }),
        prisma.monthlyPassUsage.groupBy({
          by: ["relayUsageId"],
          where: {
            status: RECORD_STATUS.ACTIVE,
            relayUsageId: { in: usageIdChunk },
          },
          _sum: {
            coveredAmount: true,
          },
        }),
      ]);

      for (const item of monthlyPassGroups) {
        if (!item.relayUsageId) continue;
        coveredAmountByUsageId.set(
          item.relayUsageId,
          (coveredAmountByUsageId.get(item.relayUsageId) || 0) + Number(item._sum.coveredAmount || 0),
        );
      }

      for (const transaction of apiUsageGroups) {
        const usageId = transaction.relatedId;
        if (!usageId) continue;

        chargedAmountByUsageId.set(
          usageId,
          (chargedAmountByUsageId.get(usageId) || 0) + Math.max(0, -Number(transaction._sum.amount || 0)),
        );
      }
    }

    const fallbackUsageIds = usageIds.filter((usageId) => !coveredAmountByUsageId.has(usageId));
    const fallbackCoveredAmountByUsageId = await this.buildLegacyCoveredAmountFallbackMap(fallbackUsageIds);

    const billingMap = new Map<string, { chargedAmount: number; coveredAmount: number }>();
    for (const usageId of usageIds) {
      const coveredAmount = coveredAmountByUsageId.has(usageId)
        ? coveredAmountByUsageId.get(usageId) || 0
        : fallbackCoveredAmountByUsageId.get(usageId) || 0;

      billingMap.set(usageId, {
        chargedAmount: chargedAmountByUsageId.get(usageId) || 0,
        coveredAmount,
      });
    }

    return billingMap;
  }

  private async buildLegacyCoveredAmountFallbackMap(usageIds: string[]): Promise<Map<string, number>> {
    if (usageIds.length === 0) return new Map();

    const fallbackCoveredAmountByUsageId = new Map<string, number>();

    for (const usageIdChunk of this.chunkValues(usageIds, RelayUsageRepository.BILLING_QUERY_CHUNK_SIZE)) {
      const transactions = await prisma.balanceTransaction.findMany({
        where: {
          status: RECORD_STATUS.ACTIVE,
          relatedId: { in: usageIdChunk },
          type: "monthly_pass_coverage",
        },
        select: {
          relatedId: true,
          description: true,
        },
      });

      for (const transaction of transactions) {
        const usageId = transaction.relatedId;
        if (!usageId) continue;

        fallbackCoveredAmountByUsageId.set(
          usageId,
          (fallbackCoveredAmountByUsageId.get(usageId) || 0) +
            extractLegacyMonthlyPassCoveredAmount(transaction.description),
        );
      }
    }

    return fallbackCoveredAmountByUsageId;
  }

  private chunkValues<T>(values: T[], chunkSize: number): T[][] {
    if (values.length === 0) return [];

    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += chunkSize) chunks.push(values.slice(index, index + chunkSize));

    return chunks;
  }
}
