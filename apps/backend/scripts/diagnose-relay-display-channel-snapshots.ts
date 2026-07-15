import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { normalizeRelayDisplaySnapshotName } from "../src/util/relay-display-channel.util";

dotenv.config({ path: ".env" });

const prisma = new PrismaClient();
const ACTIVE_STATUS = 1;
const BALANCE_VISIBLE_DAYS = 30;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_CUTOVER_TIME = new Date("2026-07-15T14:35:45.000Z");

const args = process.argv.slice(2);
const batchSizeArg = args.find((arg) => arg.startsWith("--batchSize="));
const cutoverArg = args.find((arg) => arg.startsWith("--cutover="));
const parsedBatchSize = Number.parseInt(batchSizeArg?.slice("--batchSize=".length) || "", 10);
const batchSize = Number.isFinite(parsedBatchSize) && parsedBatchSize > 0 ? parsedBatchSize : DEFAULT_BATCH_SIZE;
const parsedCutoverTime = cutoverArg ? new Date(cutoverArg.slice("--cutover=".length)) : DEFAULT_CUTOVER_TIME;

if (Number.isNaN(parsedCutoverTime.getTime())) {
  console.error("[relay-history-diagnostic] invalid --cutover value; use an ISO-8601 timestamp.");
  process.exit(1);
}

type Counts = Map<string, number>;
type SnapshotFields = {
  displayChannelId: string | null;
  displayChannelName: string | null;
};

const increment = (counts: Counts, key: string): void => {
  counts.set(key, (counts.get(key) || 0) + 1);
};

const mergeCounts = (target: Counts, source: Counts): void => {
  for (const [key, value] of source) target.set(key, (target.get(key) || 0) + value);
};

const printCounts = (scope: string, counts: Counts): void => {
  console.log(`[relay-history-diagnostic] ${scope}`);
  for (const [key, value] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`  ${key}=${value}`);
  }
};

const hasPartialSnapshot = (snapshot: SnapshotFields): boolean =>
  Boolean(snapshot.displayChannelId) !== Boolean(snapshot.displayChannelName?.trim());

const hasPlaceholderSnapshot = (snapshot: SnapshotFields): boolean =>
  Boolean(snapshot.displayChannelName?.trim()) && !normalizeRelayDisplaySnapshotName(snapshot.displayChannelName);

const getUniqueLegacyNames = (records: Array<{ channelName: string | null }>): Set<string> =>
  new Set(records.map((record) => record.channelName?.trim()).filter((name): name is string => Boolean(name)));

const isUsageDescription = (description: string | null): boolean => {
  if (!description) return false;
  return (
    description.startsWith("AI对话 -") ||
    description.startsWith("Web Chat -") ||
    description.startsWith("API调用:") ||
    description.startsWith("月卡抵扣:") ||
    description.startsWith("Monthly pass coverage")
  );
};

const runBalanceDiagnostic = async (): Promise<{ all: Counts; visible: Counts }> => {
  const all: Counts = new Map();
  const visible: Counts = new Map();
  const visibleCutoff = new Date(Date.now() - BALANCE_VISIBLE_DAYS * 24 * 60 * 60 * 1000);
  let cursor: string | undefined;

  for (;;) {
    const records = await prisma.balanceTransaction.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        createTime: true,
        type: true,
        amount: true,
        relatedId: true,
        description: true,
        model: true,
        channelName: true,
        displayChannelId: true,
        displayChannelName: true,
      },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (records.length === 0) break;
    cursor = records[records.length - 1].id;

    const relatedIds = [
      ...new Set(records.map((record) => record.relatedId).filter((id): id is string => Boolean(id))),
    ];
    const [relayUsages, monthlyPassUsages] = await Promise.all([
      prisma.relayUsage.findMany({
        where: { id: { in: relatedIds } },
        select: { id: true, displayChannelId: true, displayChannelName: true },
      }),
      prisma.monthlyPassUsage.findMany({
        where: { relayUsageId: { in: relatedIds } },
        select: { relayUsageId: true, channelName: true },
      }),
    ]);
    const relayUsageById = new Map(relayUsages.map((usage) => [usage.id, usage]));
    const monthlyPassUsagesByRelayUsageId = new Map<string, Array<{ channelName: string | null }>>();
    for (const usage of monthlyPassUsages) {
      if (!usage.relayUsageId) continue;
      const related = monthlyPassUsagesByRelayUsageId.get(usage.relayUsageId) || [];
      related.push({ channelName: usage.channelName });
      monthlyPassUsagesByRelayUsageId.set(usage.relayUsageId, related);
    }

    for (const record of records) {
      const recordCounts: Counts = new Map();
      increment(recordCounts, "rows.total");

      const linkedUsage = record.relatedId ? relayUsageById.get(record.relatedId) : undefined;
      const linkedMonthlyPassNames = getUniqueLegacyNames(
        record.relatedId ? monthlyPassUsagesByRelayUsageId.get(record.relatedId) || [] : [],
      );
      const legacyName = record.channelName?.trim();
      const transactionSnapshotName = normalizeRelayDisplaySnapshotName(record.displayChannelName);
      const linkedSnapshotName = normalizeRelayDisplaySnapshotName(linkedUsage?.displayChannelName);
      const usageLike =
        record.type === "api_usage" ||
        record.type === "monthly_pass_coverage" ||
        (record.type === "recharge" &&
          Number(record.amount) < 0 &&
          (Boolean(record.model) || isUsageDescription(record.description)));
      const candidate =
        usageLike ||
        Boolean(legacyName) ||
        Boolean(record.displayChannelId || record.displayChannelName?.trim()) ||
        Boolean(linkedUsage);

      if (record.relatedId && !linkedUsage) increment(recordCounts, "risk.relatedIdWithoutRelayUsage");
      if (!candidate) {
        increment(recordCounts, "rows.nonRelay");
      } else {
        increment(recordCounts, "rows.relayCandidate");
        if (legacyName) increment(recordCounts, "source.legacyBalanceChannelName");
        else if (linkedMonthlyPassNames.size === 1) increment(recordCounts, "source.linkedMonthlyPassLegacyName");
        else if (transactionSnapshotName) increment(recordCounts, "source.transactionLogicalSnapshot");
        else if (linkedSnapshotName) increment(recordCounts, "source.linkedRelayUsageLogicalSnapshot");
        else if (hasPlaceholderSnapshot(record) || (linkedUsage ? hasPlaceholderSnapshot(linkedUsage) : false))
          increment(recordCounts, "source.placeholderOnly");
        else increment(recordCounts, "source.missing");

        if (linkedMonthlyPassNames.size > 1) increment(recordCounts, "risk.linkedMonthlyPassLegacyNameConflict");
        if (hasPartialSnapshot(record)) increment(recordCounts, "risk.partialTransactionSnapshot");
        if (linkedUsage && hasPartialSnapshot(linkedUsage))
          increment(recordCounts, "risk.partialLinkedRelayUsageSnapshot");
        if (hasPlaceholderSnapshot(record)) increment(recordCounts, "risk.placeholderTransactionSnapshot");
        if (linkedUsage && hasPlaceholderSnapshot(linkedUsage))
          increment(recordCounts, "risk.placeholderLinkedRelayUsageSnapshot");

        const hasResolvedName = Boolean(
          legacyName || linkedMonthlyPassNames.size === 1 || transactionSnapshotName || linkedSnapshotName,
        );
        if (record.createTime >= parsedCutoverTime && !hasResolvedName)
          increment(recordCounts, "risk.postCutoverMissingDisplayName");
      }

      mergeCounts(all, recordCounts);
      if (record.status === ACTIVE_STATUS && record.createTime >= visibleCutoff) mergeCounts(visible, recordCounts);
    }
  }

  return { all, visible };
};

const runMonthlyPassDiagnostic = async (): Promise<Counts> => {
  const counts: Counts = new Map();
  let cursor: string | undefined;

  for (;;) {
    const records = await prisma.monthlyPassUsage.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        createTime: true,
        channelName: true,
        displayChannelId: true,
        displayChannelName: true,
      },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (records.length === 0) break;
    cursor = records[records.length - 1].id;

    for (const record of records) {
      increment(counts, "rows.total");
      if (record.status === ACTIVE_STATUS) increment(counts, "rows.apiVisible");

      const legacyName = record.channelName?.trim();
      const snapshotName = normalizeRelayDisplaySnapshotName(record.displayChannelName);
      if (legacyName) increment(counts, "source.legacyMonthlyPassChannelName");
      else if (snapshotName) increment(counts, "source.logicalSnapshot");
      else if (hasPlaceholderSnapshot(record)) increment(counts, "source.placeholderOnly");
      else increment(counts, "source.missing");

      if (hasPartialSnapshot(record)) increment(counts, "risk.partialSnapshot");
      if (hasPlaceholderSnapshot(record)) increment(counts, "risk.placeholderSnapshot");
      if (record.createTime >= parsedCutoverTime && !legacyName && !snapshotName)
        increment(counts, "risk.postCutoverMissingDisplayName");
    }
  }

  return counts;
};

const run = async (): Promise<void> => {
  console.log("[relay-history-diagnostic] mode=read-only");
  console.log(`[relay-history-diagnostic] batchSize=${batchSize}`);
  console.log(`[relay-history-diagnostic] cutover=${parsedCutoverTime.toISOString()}`);
  console.log(`[relay-history-diagnostic] balanceVisibleDays=${BALANCE_VISIBLE_DAYS}`);

  const [balance, monthlyPass] = await Promise.all([runBalanceDiagnostic(), runMonthlyPassDiagnostic()]);
  printCounts("balance.allRetained", balance.all);
  printCounts("balance.currentApiWindow", balance.visible);
  printCounts("monthlyPass.allRetained", monthlyPass);
  console.log("[relay-history-diagnostic] completed; no data was changed and no record identity was printed.");
};

run()
  .catch((error: unknown) => {
    const code =
      typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : "unknown";
    console.error(`[relay-history-diagnostic] failed (code=${code}); record and connection details were suppressed.`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
