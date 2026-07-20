import { prisma } from "@/config/database";
import { RECORD_STATUS } from "@/constant/status";
import { normalizeRelayDisplaySnapshotName, UNATTRIBUTED_RELAY_CHANNEL_NAME } from "@/util/relay-display-channel.util";
import type { ConsumptionStatsStore, ConsumptionUsageRow } from "./consumption-stats.store";
import { extractLegacyMonthlyPassCoveredAmount } from "@/util/monthly-pass-coverage.util";

const normalizeLegacyChannelName = (value?: string | null): string | undefined => value?.trim() || undefined;

export class ConsumptionStatsRepository implements ConsumptionStatsStore {
  private static instance: ConsumptionStatsRepository;

  public static getInstance(): ConsumptionStatsRepository {
    if (!ConsumptionStatsRepository.instance) ConsumptionStatsRepository.instance = new ConsumptionStatsRepository();

    return ConsumptionStatsRepository.instance;
  }

  public async listUsageRows(startTime: Date, endTime: Date): Promise<ConsumptionUsageRow[]> {
    const transactions = await prisma.balanceTransaction.findMany({
      where: {
        status: RECORD_STATUS.ACTIVE,
        createTime: {
          gte: startTime,
          lte: endTime,
        },
        relatedId: { not: null },
        type: {
          in: ["api_usage", "monthly_pass_coverage"],
        },
      },
      select: {
        relatedId: true,
        userId: true,
        createTime: true,
        type: true,
        amount: true,
        model: true,
        tokens: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true,
        channelName: true,
        displayChannelName: true,
        description: true,
      },
      orderBy: {
        createTime: "asc",
      },
    });

    const monthlyPassUsages = await prisma.monthlyPassUsage.findMany({
      where: {
        status: RECORD_STATUS.ACTIVE,
        createTime: {
          gte: startTime,
          lte: endTime,
        },
      },
      select: {
        createTime: true,
        relayUsageId: true,
        coveredAmount: true,
        coveredTokens: true,
        userId: true,
        model: true,
        channelName: true,
        displayChannelName: true,
      },
    });

    const usageIds = [
      ...new Set([
        ...transactions.map((item) => item.relatedId).filter((item): item is string => Boolean(item)),
        ...monthlyPassUsages.map((item) => item.relayUsageId).filter((item): item is string => Boolean(item)),
      ]),
    ];

    const relayUsageRows = usageIds.length
      ? await prisma.relayUsage.findMany({
          where: {
            status: RECORD_STATUS.ACTIVE,
            id: { in: usageIds },
          },
          select: {
            id: true,
            relayTokenId: true,
            displayChannelName: true,
            relayToken: {
              select: {
                name: true,
              },
            },
          },
        })
      : [];

    const relayUsageMap = new Map(
      relayUsageRows.map((item) => [
        item.id,
        {
          relayTokenId: item.relayTokenId,
          relayTokenName: item.relayToken?.name ?? null,
          displayChannelName: normalizeRelayDisplaySnapshotName(item.displayChannelName),
        },
      ]),
    );

    const userIds = [
      ...new Set([...transactions.map((item) => item.userId), ...monthlyPassUsages.map((item) => item.userId)]),
    ];

    const usernameRows = userIds.length
      ? await prisma.user.findMany({
          where: {
            status: RECORD_STATUS.ACTIVE,
            id: { in: userIds },
          },
          select: {
            id: true,
            username: true,
          },
        })
      : [];

    const usernameMap = new Map(usernameRows.map((item) => [item.id, item.username]));

    const monthlyPassByUsageId = new Map<
      string,
      { coveredAmount: number; coveredTokens: number; legacyChannelNames: Set<string>; displayChannelName?: string }
    >();
    for (const item of monthlyPassUsages) {
      if (!item.relayUsageId) continue;
      const existing = monthlyPassByUsageId.get(item.relayUsageId) || {
        coveredAmount: 0,
        coveredTokens: 0,
        legacyChannelNames: new Set<string>(),
      };
      const legacyChannelName = normalizeLegacyChannelName(item.channelName);
      if (legacyChannelName) existing.legacyChannelNames.add(legacyChannelName);
      monthlyPassByUsageId.set(item.relayUsageId, {
        coveredAmount: existing.coveredAmount + Number(item.coveredAmount || 0),
        coveredTokens: existing.coveredTokens + Number(item.coveredTokens || 0),
        legacyChannelNames: existing.legacyChannelNames,
        displayChannelName: existing.displayChannelName ?? normalizeRelayDisplaySnapshotName(item.displayChannelName),
      });
    }

    const usageRowMap = new Map<string, ConsumptionUsageRow>();

    for (const tx of transactions) {
      const usageId = tx.relatedId;
      if (!usageId) continue;

      const existing = usageRowMap.get(usageId);
      const relayUsageMeta = relayUsageMap.get(usageId);
      const chargedAmount = tx.type === "api_usage" ? Math.max(0, -Number(tx.amount)) : (existing?.chargedAmount ?? 0);
      const fallbackMonthlyPass =
        tx.type === "monthly_pass_coverage" ? extractLegacyMonthlyPassCoveredAmount(tx.description) : 0;
      const coveredMeta = monthlyPassByUsageId.get(usageId);
      const coveredAmount = coveredMeta?.coveredAmount ?? fallbackMonthlyPass;
      const linkedLegacyMonthlyPassChannelName =
        coveredMeta?.legacyChannelNames.size === 1 ? [...coveredMeta.legacyChannelNames][0] : undefined;
      const resolvedChannelName =
        normalizeLegacyChannelName(tx.channelName) ??
        linkedLegacyMonthlyPassChannelName ??
        normalizeRelayDisplaySnapshotName(tx.displayChannelName) ??
        coveredMeta?.displayChannelName ??
        relayUsageMeta?.displayChannelName ??
        UNATTRIBUTED_RELAY_CHANNEL_NAME;
      const totalTokens = Number(tx.tokens ?? 0);
      const inputTokens = Number(tx.inputTokens ?? 0);
      const outputTokens = Number(tx.outputTokens ?? 0);
      const cacheCreationTokens = Number(tx.cacheCreationTokens ?? 0);
      const cacheReadTokens = Number(tx.cacheReadTokens ?? 0);

      usageRowMap.set(usageId, {
        usageId,
        userId: tx.userId,
        username: existing?.username ?? usernameMap.get(tx.userId) ?? null,
        createTime: existing?.createTime ?? tx.createTime,
        model:
          existing && existing.model !== "unknown"
            ? existing.model
            : tx.model || (existing ? existing.model : undefined) || "unknown",
        channelName:
          existing && existing.channelName !== UNATTRIBUTED_RELAY_CHANNEL_NAME
            ? existing.channelName
            : resolvedChannelName,
        relayTokenId: existing?.relayTokenId ?? relayUsageMeta?.relayTokenId ?? null,
        relayTokenName: existing?.relayTokenName ?? relayUsageMeta?.relayTokenName ?? null,
        chargedAmount,
        coveredAmount,
        totalSpend: chargedAmount + coveredAmount,
        totalTokens: existing ? existing.totalTokens : totalTokens,
        inputTokens: existing ? existing.inputTokens : inputTokens,
        outputTokens: existing ? existing.outputTokens : outputTokens,
        cacheCreationTokens: existing ? existing.cacheCreationTokens : cacheCreationTokens,
        cacheReadTokens: existing ? existing.cacheReadTokens : cacheReadTokens,
      });
    }

    for (const usage of monthlyPassUsages) {
      const usageId = usage.relayUsageId;
      if (!usageId || usageRowMap.has(usageId)) continue;

      const coveredAmount = Number(usage.coveredAmount || 0);
      const coveredTokens = Number(usage.coveredTokens || 0);
      const relayUsageMeta = relayUsageMap.get(usageId);
      const resolvedChannelName =
        normalizeLegacyChannelName(usage.channelName) ??
        normalizeRelayDisplaySnapshotName(usage.displayChannelName) ??
        relayUsageMeta?.displayChannelName ??
        UNATTRIBUTED_RELAY_CHANNEL_NAME;

      usageRowMap.set(usageId, {
        usageId,
        userId: usage.userId,
        username: usernameMap.get(usage.userId) ?? null,
        createTime: usage.createTime,
        model: usage.model || "unknown",
        channelName: resolvedChannelName,
        relayTokenId: relayUsageMeta?.relayTokenId ?? null,
        relayTokenName: relayUsageMeta?.relayTokenName ?? null,
        chargedAmount: 0,
        coveredAmount,
        totalSpend: coveredAmount,
        totalTokens: coveredTokens,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
    }

    return [...usageRowMap.values()];
  }
}
