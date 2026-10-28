import type { Prisma } from "@prisma/client";
import { MANAGED_STATUS } from "@/constant/status";
import type { MonthlyPassQuotaUnit, MonthlyPassUsageSummary, MonthlyPassUsageSummaryRule } from "./monthly-pass.store";
const getUsageSummaryPassHoursKey = (passId: string, quotaWindowHours: number): string =>
  `${passId}:${quotaWindowHours}`;
const getUsageSummaryRuleKey = (passId: string, quotaUnit: MonthlyPassQuotaUnit, quotaWindowHours: number): string =>
  `${passId}:${quotaWindowHours}:${quotaUnit}`;

export async function summarizeMonthlyPassWindowUsage(
  tx: Pick<Prisma.TransactionClient, "monthlyPassUsage">,
  quotaWindowRules: MonthlyPassUsageSummaryRule[],
  endAt: Date,
): Promise<Record<string, MonthlyPassUsageSummary>> {
  if (quotaWindowRules.length === 0) return {};

  const uniquePassIds = [...new Set(quotaWindowRules.map((item) => item.passId))];
  const uniqueWindowHours = [...new Set(quotaWindowRules.map((item) => Number(item.quotaWindowHours)))];
  const summaryByPassHoursKey: Record<string, MonthlyPassUsageSummary> = {};

  await Promise.all(
    uniqueWindowHours.map(async (windowHours) => {
      const startAt = new Date(endAt.getTime() - windowHours * 60 * 60 * 1000);
      const grouped = await tx.monthlyPassUsage.groupBy({
        by: ["userMonthlyPassId"],
        where: {
          status: MANAGED_STATUS.ENABLED,
          userMonthlyPassId: { in: uniquePassIds },
          createTime: {
            gte: startAt,
            lte: endAt,
          },
        },
        _sum: {
          coveredAmount: true,
          coveredRequests: true,
          coveredTokens: true,
        },
      });

      for (const item of grouped)
        summaryByPassHoursKey[getUsageSummaryPassHoursKey(item.userMonthlyPassId, windowHours)] = {
          coveredAmount: Number(item._sum.coveredAmount || 0),
          coveredRequests: Number(item._sum.coveredRequests || 0),
          coveredTokens: Number(item._sum.coveredTokens || 0),
        };
    }),
  );

  const result: Record<string, MonthlyPassUsageSummary> = {};
  for (const rule of quotaWindowRules) {
    const summary = summaryByPassHoursKey[getUsageSummaryPassHoursKey(rule.passId, Number(rule.quotaWindowHours))];
    if (summary) result[getUsageSummaryRuleKey(rule.passId, rule.quotaUnit, Number(rule.quotaWindowHours))] = summary;
  }

  return result;
}
