import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { extractLegacyMonthlyPassCoveredAmount } from "../src/util/monthly-pass-coverage.util";

dotenv.config({ path: ".env" });

const prisma = new PrismaClient();

const DEFAULT_BATCH_SIZE = 1000;
const args = process.argv.slice(2);
const apply = args.includes("--apply") && !args.includes("--dry-run");
const tokenIdArg = args.find((arg) => arg.startsWith("--tokenId="));
const batchSizeArg = args.find((arg) => arg.startsWith("--batchSize="));
const tokenId = tokenIdArg?.slice("--tokenId=".length) || undefined;
const parsedBatchSize = Number.parseInt(batchSizeArg?.slice("--batchSize=".length) || "", 10);
const batchSize = Number.isFinite(parsedBatchSize) && parsedBatchSize > 0 ? parsedBatchSize : DEFAULT_BATCH_SIZE;

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

const chunkValues = <T>(values: T[], size: number): T[][] => {
  if (values.length === 0) return [];

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));

  return chunks;
};

const buildLegacyCoveredAmountFallbackMap = async (usageIds: string[]): Promise<Map<string, number>> => {
  if (usageIds.length === 0) return new Map();

  const coveredAmountByUsageId = new Map<string, number>();

  for (const usageIdChunk of chunkValues(usageIds, batchSize)) {
    const transactions = await prisma.balanceTransaction.findMany({
      where: {
        status: 1,
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

      coveredAmountByUsageId.set(
        usageId,
        round4(
          (coveredAmountByUsageId.get(usageId) || 0) + extractLegacyMonthlyPassCoveredAmount(transaction.description),
        ),
      );
    }
  }

  return coveredAmountByUsageId;
};

const run = async (): Promise<void> => {
  console.log(`[relay-token-used-quota] mode=${apply ? "apply" : "dry-run"}`);
  console.log(`[relay-token-used-quota] batchSize=${batchSize}`);
  if (tokenId) console.log(`[relay-token-used-quota] tokenId=${tokenId}`);

  const tokens = await prisma.relayToken.findMany({
    where: tokenId ? { id: tokenId } : undefined,
    select: {
      id: true,
      name: true,
      usedQuota: true,
    },
    orderBy: { createTime: "asc" },
  });

  const usageReferences = await prisma.relayUsage.findMany({
    where: tokenId ? { relayTokenId: tokenId, status: 1 } : { status: 1 },
    select: {
      id: true,
      relayTokenId: true,
    },
  });

  console.log(`[relay-token-used-quota] tokens=${tokens.length}`);
  console.log(`[relay-token-used-quota] relayUsages=${usageReferences.length}`);

  const chargedAmountByUsageId = new Map<string, number>();
  const coveredAmountByUsageId = new Map<string, number>();

  for (const usageChunk of chunkValues(usageReferences, batchSize)) {
    const usageIds = usageChunk.map((usage) => usage.id);
    const [apiUsageGroups, monthlyPassGroups] = await Promise.all([
      prisma.balanceTransaction.groupBy({
        by: ["relatedId"],
        where: {
          status: 1,
          relatedId: { in: usageIds },
          type: "api_usage",
        },
        _sum: {
          amount: true,
        },
      }),
      prisma.monthlyPassUsage.groupBy({
        by: ["relayUsageId"],
        where: {
          status: 1,
          relayUsageId: { in: usageIds },
        },
        _sum: {
          coveredAmount: true,
        },
      }),
    ]);

    for (const item of apiUsageGroups) {
      const usageId = item.relatedId;
      if (!usageId) continue;
      chargedAmountByUsageId.set(
        usageId,
        round4((chargedAmountByUsageId.get(usageId) || 0) + Math.max(0, -Number(item._sum.amount || 0))),
      );
    }

    for (const item of monthlyPassGroups) {
      const usageId = item.relayUsageId;
      if (!usageId) continue;
      coveredAmountByUsageId.set(
        usageId,
        round4((coveredAmountByUsageId.get(usageId) || 0) + Number(item._sum.coveredAmount || 0)),
      );
    }
  }

  const fallbackUsageIds = usageReferences
    .map((usage) => usage.id)
    .filter((usageId) => !coveredAmountByUsageId.has(usageId));
  const fallbackCoveredAmountByUsageId = await buildLegacyCoveredAmountFallbackMap(fallbackUsageIds);

  const totalUsedQuotaByTokenId = new Map<string, number>();
  for (const usage of usageReferences) {
    const chargedAmount = chargedAmountByUsageId.get(usage.id) || 0;
    const coveredAmount = coveredAmountByUsageId.has(usage.id)
      ? coveredAmountByUsageId.get(usage.id) || 0
      : fallbackCoveredAmountByUsageId.get(usage.id) || 0;
    const totalAmount = round4(chargedAmount + coveredAmount);

    totalUsedQuotaByTokenId.set(
      usage.relayTokenId,
      round4((totalUsedQuotaByTokenId.get(usage.relayTokenId) || 0) + totalAmount),
    );
  }

  const updates = tokens.map((token) => ({
    id: token.id,
    name: token.name,
    before: Number(token.usedQuota || 0),
    next: totalUsedQuotaByTokenId.get(token.id) || 0,
  }));

  const changed = updates.filter((item) => round4(item.before) !== round4(item.next));
  const totalBefore = round4(updates.reduce((sum, item) => sum + item.before, 0));
  const totalNext = round4(updates.reduce((sum, item) => sum + item.next, 0));

  console.log(`[relay-token-used-quota] changedTokens=${changed.length}`);
  console.log(`[relay-token-used-quota] totalBefore=${totalBefore}`);
  console.log(`[relay-token-used-quota] totalNext=${totalNext}`);

  if (changed.length > 0) {
    console.log("[relay-token-used-quota] sample changes:");
    changed.slice(0, 20).forEach((item) => {
      console.log(`  - ${item.id} (${item.name || "unnamed"}): ${item.before} -> ${item.next}`);
    });
  }

  if (!apply) {
    console.log("[relay-token-used-quota] dry-run only, no records updated");
    console.log("[relay-token-used-quota] re-run with --apply to persist results");
    await prisma.$disconnect();
    return;
  }

  for (const updateChunk of chunkValues(changed, 200))
    await prisma.$transaction(
      updateChunk.map((item) =>
        prisma.relayToken.update({
          where: { id: item.id },
          data: { usedQuota: item.next },
        }),
      ),
    );

  console.log(`[relay-token-used-quota] updatedTokens=${changed.length}`);
  await prisma.$disconnect();
};

run().catch(async (error) => {
  console.error("[relay-token-used-quota] failed:", error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
