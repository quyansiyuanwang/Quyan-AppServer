import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env" });

const DEFAULT_RETENTION_DAYS = 30;
const USAGE_TRANSACTION_TYPES = ["api_usage", "monthly_pass_coverage"] as const;
const USAGE_LIKE_RECHARGE_SQL =
  "type = 'recharge' AND amount < 0 AND (model IS NOT NULL OR description LIKE 'AI对话 -%' OR description LIKE 'Web Chat -%' OR description LIKE 'API调用:/chat/conversations/%')";

const args = process.argv.slice(2);
const apply = args.includes("--apply") && !args.includes("--dry-run");
const retentionDaysArg = args.find((arg) => arg.startsWith("--days="));
const parsedRetentionDays = Number.parseInt(retentionDaysArg?.slice("--days=".length) || "", 10);
const retentionDays =
  Number.isFinite(parsedRetentionDays) && parsedRetentionDays > 0 ? parsedRetentionDays : DEFAULT_RETENTION_DAYS;

const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

const prisma = new PrismaClient();

const buildUsageTransactionWhereSql = (cutoffIso: string): string => {
  return `
    status = 1
    AND createTime < '${cutoffIso}'
    AND (
      type IN ('${USAGE_TRANSACTION_TYPES.join("','")}')
      OR (${USAGE_LIKE_RECHARGE_SQL})
    )
  `;
};

const run = async (): Promise<void> => {
  const cutoffIso = cutoff.toISOString();

  console.log(`[cleanup-old-consumption-records] mode=${apply ? "apply" : "dry-run"}`);
  console.log(`[cleanup-old-consumption-records] retentionDays=${retentionDays}`);
  console.log(`[cleanup-old-consumption-records] cutoff=${cutoffIso}`);

  const usageLikeRecharges = await prisma.balanceTransaction.count({
    where: {
      status: 1,
      createTime: { lt: cutoff },
      type: "recharge",
      amount: { lt: 0 },
      OR: [
        { model: { not: null } },
        { description: { startsWith: "AI对话 -" } },
        { description: { startsWith: "Web Chat -" } },
        { description: { startsWith: "API调用:/chat/conversations/" } },
      ],
    },
  });

  const monthlyPassUsageToDelete = await prisma.monthlyPassUsage.count({
    where: {
      status: 1,
      createTime: { lt: cutoff },
    },
  });

  const relayUsageToDelete = await prisma.relayUsage.count({
    where: {
      status: 1,
      createTime: { lt: cutoff },
    },
  });

  const balanceTransactionsToDelete = await prisma.balanceTransaction.count({
    where: {
      status: 1,
      createTime: { lt: cutoff },
      OR: [
        { type: { in: [...USAGE_TRANSACTION_TYPES] } },
        {
          type: "recharge",
          amount: { lt: 0 },
          OR: [
            { model: { not: null } },
            { description: { startsWith: "AI对话 -" } },
            { description: { startsWith: "Web Chat -" } },
            { description: { startsWith: "API调用:/chat/conversations/" } },
          ],
        },
      ],
    },
  });

  console.log(`[cleanup-old-consumption-records] monthlyPassUsage candidates=${monthlyPassUsageToDelete}`);
  console.log(`[cleanup-old-consumption-records] relayUsage candidates=${relayUsageToDelete}`);
  console.log(`[cleanup-old-consumption-records] balanceTransaction candidates=${balanceTransactionsToDelete}`);
  console.log(`[cleanup-old-consumption-records] usage-like recharge subset=${usageLikeRecharges}`);

  if (!apply) {
    console.log("[cleanup-old-consumption-records] dry-run only, no records deleted");
    console.log("[cleanup-old-consumption-records] re-run with --apply to execute deletion");
    await prisma.$disconnect();
    return;
  }

  const deletedCounts = await prisma.$transaction(async (tx) => {
    const deletedMonthlyPassUsage = await tx.monthlyPassUsage.deleteMany({
      where: {
        status: 1,
        createTime: { lt: cutoff },
      },
    });

    const deletedRelayUsage = await tx.relayUsage.deleteMany({
      where: {
        status: 1,
        createTime: { lt: cutoff },
      },
    });

    const usageTransactionWhereSql = buildUsageTransactionWhereSql(cutoffIso);
    const deletedUsageTransactions = await tx.$executeRawUnsafe(
      `DELETE FROM balance_transactions WHERE ${usageTransactionWhereSql}`,
    );

    return {
      monthlyPassUsage: deletedMonthlyPassUsage.count,
      relayUsage: deletedRelayUsage.count,
      balanceTransactions: Number(deletedUsageTransactions),
    };
  });

  console.log("[cleanup-old-consumption-records] deleted summary:");
  console.log(`  monthlyPassUsage=${deletedCounts.monthlyPassUsage}`);
  console.log(`  relayUsage=${deletedCounts.relayUsage}`);
  console.log(`  balanceTransactions=${deletedCounts.balanceTransactions}`);

  await prisma.$disconnect();
};

run().catch(async (error) => {
  console.error("[cleanup-old-consumption-records] failed:", error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
