import dotenv from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env" });

const prisma = new PrismaClient();

const DEFAULT_BATCH_SIZE = 500;
const UPDATE_BATCH_SIZE = 100;
const LEGACY_POOL_DISPLAY_NAME = "历史混池渠道";
const UNKNOWN_HISTORY_DISPLAY_NAME = "历史渠道（未记录）";

const args = process.argv.slice(2);
const apply = args.includes("--apply") && !args.includes("--dry-run");
const batchSizeArg = args.find((arg) => arg.startsWith("--batchSize="));
const tokenIdArg = args.find((arg) => arg.startsWith("--tokenId="));
const parsedBatchSize = Number.parseInt(batchSizeArg?.slice("--batchSize=".length) || "", 10);
const batchSize = Number.isFinite(parsedBatchSize) && parsedBatchSize > 0 ? parsedBatchSize : DEFAULT_BATCH_SIZE;
const tokenId = tokenIdArg?.slice("--tokenId=".length) || undefined;

type DisplaySnapshot = {
  displayChannelId: string | null;
  displayChannelName: string;
  source: "logical-channel" | "legacy-name" | "ambiguous-pool" | "unknown";
};

type ChannelInfo = {
  id: string;
  name: string;
};

type TokenChannelConfig = {
  channelIds: string[];
};

const chunkValues = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

const addCount = (counts: Map<string, number>, key: string) => counts.set(key, (counts.get(key) || 0) + 1);

const printCounts = (label: string, counts: Map<string, number>) => {
  const summary = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
  console.log(`[relay-display-snapshots] ${label}: ${summary || "none"}`);
};

const isPrismaPromise = (value: Prisma.PrismaPromise<unknown> | null): value is Prisma.PrismaPromise<unknown> =>
  value !== null;

const run = async (): Promise<void> => {
  console.log(`[relay-display-snapshots] mode=${apply ? "apply" : "dry-run"}`);
  console.log(`[relay-display-snapshots] batchSize=${batchSize}`);
  if (tokenId) console.log(`[relay-display-snapshots] tokenId=${tokenId}`);
  console.log("[relay-display-snapshots] Existing non-null display snapshots are never overwritten.");

  const [channels, members, relayTokens] = await Promise.all([
    prisma.relayChannel.findMany({
      select: { id: true, name: true },
    }),
    prisma.relayChannelMember.findMany({
      select: { relayChannelId: true, memberChannelId: true },
    }),
    prisma.relayToken.findMany({
      where: tokenId ? { id: tokenId } : undefined,
      select: {
        id: true,
        channelId: true,
        channelConfigs: {
          select: { channelId: true },
          orderBy: { priority: "asc" },
        },
      },
    }),
  ]);

  const channelById = new Map<string, ChannelInfo>(channels.map((channel) => [channel.id, channel]));
  const channelIdsByName = new Map<string, string[]>();
  for (const channel of channels) {
    const normalizedName = channel.name.trim();
    if (!normalizedName) continue;
    const ids = channelIdsByName.get(normalizedName) || [];
    ids.push(channel.id);
    channelIdsByName.set(normalizedName, ids);
  }

  const parentPoolsByMemberId = new Map<string, string[]>();
  for (const member of members) {
    const parentIds = parentPoolsByMemberId.get(member.memberChannelId) || [];
    parentIds.push(member.relayChannelId);
    parentPoolsByMemberId.set(member.memberChannelId, parentIds);
  }

  const ancestorPoolIdsByChannelId = new Map<string, Set<string>>();
  const getAncestorPoolIds = (channelId: string, visited = new Set<string>()): Set<string> => {
    const cached = ancestorPoolIdsByChannelId.get(channelId);
    if (cached) return cached;
    if (visited.has(channelId)) return new Set();

    visited.add(channelId);
    const ancestors = new Set<string>();
    for (const parentPoolId of parentPoolsByMemberId.get(channelId) || []) {
      ancestors.add(parentPoolId);
      for (const ancestorPoolId of getAncestorPoolIds(parentPoolId, new Set(visited))) ancestors.add(ancestorPoolId);
    }
    ancestorPoolIdsByChannelId.set(channelId, ancestors);
    return ancestors;
  };

  const tokenConfigsById = new Map<string, TokenChannelConfig>();
  for (const token of relayTokens) {
    const channelIds = token.channelConfigs.length
      ? token.channelConfigs.map((config) => config.channelId)
      : token.channelId
        ? [token.channelId]
        : [];
    tokenConfigsById.set(token.id, { channelIds: [...new Set(channelIds)] });
  }

  const resolveSnapshot = (params: {
    physicalChannelId?: string | null;
    relayTokenId?: string | null;
    legacyChannelName?: string | null;
  }): DisplaySnapshot => {
    let physicalChannelId = params.physicalChannelId || null;
    const legacyName = params.legacyChannelName?.trim() || null;

    if (!physicalChannelId && legacyName) {
      const matchingIds = channelIdsByName.get(legacyName) || [];
      if (matchingIds.length === 1) physicalChannelId = matchingIds[0];
      else if (matchingIds.some((id) => getAncestorPoolIds(id).size > 0))
        return {
          displayChannelId: null,
          displayChannelName: LEGACY_POOL_DISPLAY_NAME,
          source: "ambiguous-pool",
        };
      else return { displayChannelId: null, displayChannelName: legacyName, source: "legacy-name" };
    }

    const tokenChannelIds = params.relayTokenId ? tokenConfigsById.get(params.relayTokenId)?.channelIds || [] : [];
    if (physicalChannelId && channelById.has(physicalChannelId)) {
      const possibleDisplayIds = new Set([physicalChannelId, ...getAncestorPoolIds(physicalChannelId)]);
      const configuredMatches = tokenChannelIds.filter((channelId) => possibleDisplayIds.has(channelId));

      if (configuredMatches.length === 1) {
        const displayChannel = channelById.get(configuredMatches[0]);
        if (displayChannel)
          return {
            displayChannelId: displayChannel.id,
            displayChannelName: displayChannel.name,
            source: "logical-channel",
          };
      }

      const ancestorPoolIds = [...getAncestorPoolIds(physicalChannelId)];
      if (ancestorPoolIds.length === 1) {
        const displayChannel = channelById.get(ancestorPoolIds[0]);
        if (displayChannel)
          return {
            displayChannelId: displayChannel.id,
            displayChannelName: displayChannel.name,
            source: "logical-channel",
          };
      }

      if (ancestorPoolIds.length > 1)
        return {
          displayChannelId: null,
          displayChannelName: LEGACY_POOL_DISPLAY_NAME,
          source: "ambiguous-pool",
        };

      const physicalChannel = channelById.get(physicalChannelId)!;
      return {
        displayChannelId: physicalChannel.id,
        displayChannelName: physicalChannel.name,
        source: "logical-channel",
      };
    }

    if (tokenChannelIds.length === 1) {
      const displayChannel = channelById.get(tokenChannelIds[0]);
      if (displayChannel)
        return {
          displayChannelId: displayChannel.id,
          displayChannelName: displayChannel.name,
          source: "logical-channel",
        };
    }

    if (legacyName) return { displayChannelId: null, displayChannelName: legacyName, source: "legacy-name" };
    return {
      displayChannelId: null,
      displayChannelName: UNKNOWN_HISTORY_DISPLAY_NAME,
      source: "unknown",
    };
  };

  const updatesByTable = new Map<string, number>();
  const sourcesByTable = new Map<string, Map<string, number>>();
  const countUpdate = (table: string, source: DisplaySnapshot["source"]) => {
    addCount(updatesByTable, table);
    const sourceCounts = sourcesByTable.get(table) || new Map<string, number>();
    addCount(sourceCounts, source);
    sourcesByTable.set(table, sourceCounts);
  };

  let usageCursor: string | undefined;
  while (true) {
    const usages = await prisma.relayUsage.findMany({
      where: {
        displayChannelId: null,
        displayChannelName: null,
        ...(tokenId ? { relayTokenId: tokenId } : {}),
        ...(usageCursor ? { id: { gt: usageCursor } } : {}),
      },
      select: {
        id: true,
        relayTokenId: true,
        executionChannelId: true,
      },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (usages.length === 0) break;
    usageCursor = usages[usages.length - 1].id;

    const usageIds = usages.map((usage) => usage.id);
    const [transactions, monthlyPassUsages] = await Promise.all([
      prisma.balanceTransaction.findMany({
        where: {
          relatedId: { in: usageIds },
          displayChannelId: null,
          displayChannelName: null,
        },
        select: { id: true, relatedId: true, channelName: true },
      }),
      prisma.monthlyPassUsage.findMany({
        where: {
          relayUsageId: { in: usageIds },
          displayChannelId: null,
          displayChannelName: null,
        },
        select: { id: true, relayUsageId: true, channelId: true, channelName: true },
      }),
    ]);

    const physicalIdsByUsageId = new Map<string, Set<string>>();
    const legacyNamesByUsageId = new Map<string, Set<string>>();
    for (const monthlyPassUsage of monthlyPassUsages) {
      if (!monthlyPassUsage.relayUsageId) continue;
      if (monthlyPassUsage.channelId) {
        const ids = physicalIdsByUsageId.get(monthlyPassUsage.relayUsageId) || new Set<string>();
        ids.add(monthlyPassUsage.channelId);
        physicalIdsByUsageId.set(monthlyPassUsage.relayUsageId, ids);
      }
      if (monthlyPassUsage.channelName?.trim()) {
        const names = legacyNamesByUsageId.get(monthlyPassUsage.relayUsageId) || new Set<string>();
        names.add(monthlyPassUsage.channelName.trim());
        legacyNamesByUsageId.set(monthlyPassUsage.relayUsageId, names);
      }
    }
    for (const transaction of transactions) {
      if (!transaction.relatedId || !transaction.channelName?.trim()) continue;
      const names = legacyNamesByUsageId.get(transaction.relatedId) || new Set<string>();
      names.add(transaction.channelName.trim());
      legacyNamesByUsageId.set(transaction.relatedId, names);
    }

    const usageSnapshots = new Map<string, DisplaySnapshot>();
    const usageUpdates = usages.map((usage) => {
      const inferredIds = [...(physicalIdsByUsageId.get(usage.id) || [])];
      const inferredNames = [...(legacyNamesByUsageId.get(usage.id) || [])];
      const physicalChannelId = usage.executionChannelId || (inferredIds.length === 1 ? inferredIds[0] : null);
      const snapshot = resolveSnapshot({
        physicalChannelId,
        relayTokenId: usage.relayTokenId,
        legacyChannelName: inferredNames.length === 1 ? inferredNames[0] : null,
      });
      usageSnapshots.set(usage.id, snapshot);
      countUpdate("relayUsages", snapshot.source);
      return prisma.relayUsage.update({
        where: { id: usage.id },
        data: {
          ...(usage.executionChannelId || !physicalChannelId ? {} : { executionChannelId: physicalChannelId }),
          displayChannelId: snapshot.displayChannelId,
          displayChannelName: snapshot.displayChannelName,
        },
      });
    });

    const transactionUpdates = transactions.map((transaction) => {
      const snapshot = transaction.relatedId ? usageSnapshots.get(transaction.relatedId) : null;
      if (!snapshot) return null;
      countUpdate("balanceTransactions", snapshot.source);
      return prisma.balanceTransaction.update({
        where: { id: transaction.id },
        data: {
          displayChannelId: snapshot.displayChannelId,
          displayChannelName: snapshot.displayChannelName,
        },
      });
    });

    const monthlyPassUpdates = monthlyPassUsages.map((monthlyPassUsage) => {
      const snapshot = monthlyPassUsage.relayUsageId
        ? usageSnapshots.get(monthlyPassUsage.relayUsageId) ||
          resolveSnapshot({
            physicalChannelId: monthlyPassUsage.channelId,
            legacyChannelName: monthlyPassUsage.channelName,
          })
        : resolveSnapshot({
            physicalChannelId: monthlyPassUsage.channelId,
            legacyChannelName: monthlyPassUsage.channelName,
          });
      countUpdate("monthlyPassUsages", snapshot.source);
      return prisma.monthlyPassUsage.update({
        where: { id: monthlyPassUsage.id },
        data: {
          displayChannelId: snapshot.displayChannelId,
          displayChannelName: snapshot.displayChannelName,
        },
      });
    });

    const pendingUpdates = [
      ...usageUpdates,
      ...transactionUpdates.filter(isPrismaPromise),
      ...monthlyPassUpdates,
    ] as Prisma.PrismaPromise<any>[];

    if (apply)
      for (const updates of chunkValues(pendingUpdates, UPDATE_BATCH_SIZE))
        await prisma.$transaction(updates);
  }

  if (!tokenId) {
    let orphanMonthlyPassUsageCursor: string | undefined;
    while (true) {
      const monthlyPassUsages = await prisma.monthlyPassUsage.findMany({
        where: {
          relayUsageId: null,
          displayChannelId: null,
          displayChannelName: null,
          ...(orphanMonthlyPassUsageCursor ? { id: { gt: orphanMonthlyPassUsageCursor } } : {}),
        },
        select: { id: true, channelId: true, channelName: true },
        orderBy: { id: "asc" },
        take: batchSize,
      });
      if (monthlyPassUsages.length === 0) break;
      orphanMonthlyPassUsageCursor = monthlyPassUsages[monthlyPassUsages.length - 1].id;

      const updates = monthlyPassUsages.map((monthlyPassUsage) => {
        const snapshot = resolveSnapshot({
          physicalChannelId: monthlyPassUsage.channelId,
          legacyChannelName: monthlyPassUsage.channelName,
        });
        countUpdate("monthlyPassUsages", snapshot.source);
        return prisma.monthlyPassUsage.update({
          where: { id: monthlyPassUsage.id },
          data: {
            displayChannelId: snapshot.displayChannelId,
            displayChannelName: snapshot.displayChannelName,
          },
        });
      });
      if (apply)
        for (const updateChunk of chunkValues(updates, UPDATE_BATCH_SIZE)) await prisma.$transaction(updateChunk);
    }
  }

  let transactionCursor: string | undefined;
  while (!tokenId) {
    const transactions = await prisma.balanceTransaction.findMany({
      where: {
        displayChannelId: null,
        displayChannelName: null,
        channelName: { not: null },
        ...(transactionCursor ? { id: { gt: transactionCursor } } : {}),
      },
      select: { id: true, channelName: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (transactions.length === 0) break;
    transactionCursor = transactions[transactions.length - 1].id;

    const updates = transactions.map((transaction) => {
      const snapshot = resolveSnapshot({ legacyChannelName: transaction.channelName });
      countUpdate("balanceTransactions", snapshot.source);
      return prisma.balanceTransaction.update({
        where: { id: transaction.id },
        data: {
          displayChannelId: snapshot.displayChannelId,
          displayChannelName: snapshot.displayChannelName,
        },
      });
    });
    if (apply) for (const updateChunk of chunkValues(updates, UPDATE_BATCH_SIZE)) await prisma.$transaction(updateChunk);
  }

  let switchLogCursor: string | undefined;
  while (true) {
    const switchLogs = await prisma.relayChannelSwitchLog.findMany({
      where: {
        OR: [
          { fromDisplayChannelId: null, fromDisplayChannelName: null },
          { toDisplayChannelId: null, toDisplayChannelName: null },
        ],
        ...(switchLogCursor ? { id: { gt: switchLogCursor } } : {}),
        ...(tokenId ? { relayTokenId: tokenId } : {}),
      },
      select: {
        id: true,
        relayTokenId: true,
        fromChannelId: true,
        fromDisplayChannelId: true,
        fromDisplayChannelName: true,
        toChannelId: true,
        toDisplayChannelId: true,
        toDisplayChannelName: true,
      },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (switchLogs.length === 0) break;
    switchLogCursor = switchLogs[switchLogs.length - 1].id;

    const updates = switchLogs.map((switchLog) => {
      const fromSnapshot =
        switchLog.fromDisplayChannelId || switchLog.fromDisplayChannelName
          ? null
          : resolveSnapshot({
              physicalChannelId: switchLog.fromChannelId,
              relayTokenId: switchLog.relayTokenId,
            });
      const toSnapshot =
        switchLog.toDisplayChannelId || switchLog.toDisplayChannelName
          ? null
          : resolveSnapshot({
              physicalChannelId: switchLog.toChannelId,
              relayTokenId: switchLog.relayTokenId,
            });
      if (fromSnapshot) countUpdate("switchLogs.from", fromSnapshot.source);
      if (toSnapshot) countUpdate("switchLogs.to", toSnapshot.source);
      return prisma.relayChannelSwitchLog.update({
        where: { id: switchLog.id },
        data: {
          ...(fromSnapshot
            ? {
                fromDisplayChannelId: fromSnapshot.displayChannelId,
                fromDisplayChannelName: fromSnapshot.displayChannelName,
              }
            : {}),
          ...(toSnapshot
            ? {
                toDisplayChannelId: toSnapshot.displayChannelId,
                toDisplayChannelName: toSnapshot.displayChannelName,
              }
            : {}),
        },
      });
    });
    if (apply) for (const updateChunk of chunkValues(updates, UPDATE_BATCH_SIZE)) await prisma.$transaction(updateChunk);
  }

  printCounts("planned updates", updatesByTable);
  for (const [table, sourceCounts] of sourcesByTable) printCounts(`${table} resolution`, sourceCounts);

  if (!apply) {
    console.log("[relay-display-snapshots] dry-run only; no data was changed.");
    console.log("[relay-display-snapshots] Review the summary, then re-run with --apply to write only empty snapshots.");
  } else console.log("[relay-display-snapshots] completed; legacy fields and all non-empty snapshots were preserved.");

  await prisma.$disconnect();
};

run().catch(async (error) => {
  console.error("[relay-display-snapshots] failed:", error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
