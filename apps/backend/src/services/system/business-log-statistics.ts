import type { BusinessLogStatsResponse } from "@/api/dto/system/businesslog.dto";
import type { BusinessLogStatsRow, QueryBusinessLogParams } from "@/store/system/businesslog.store";
/** Incremental statistics preserving the legacy business-log response and date semantics. */
export class BusinessLogStatisticsAccumulator {
  private readonly summary = {
    totalLogs: 0,
    successLogs: 0,
    failedLogs: 0,
    uniqueActors: new Set<string>(),
    systemTriggeredLogs: 0,
    uniqueTargets: new Set<string>(),
    uniqueIPs: new Set<string>(),
  };
  private readonly dailyMap = new Map<
    string,
    { date: string; totalLogs: number; successLogs: number; failedLogs: number }
  >();
  private readonly typeMap = new Map<string, number>();
  private readonly categoryMap = new Map<string, number>();
  private readonly successMap = new Map<string, number>();
  private readonly typeDailyMap = new Map<string, { date: string; key: string; label: string; count: number }>();
  private readonly categoryDailyMap = new Map<string, { date: string; key: string; label: string; count: number }>();

  private minDate: Date | null = null;
  private maxDate: Date | null = null;

  constructor(private readonly filters: Pick<QueryBusinessLogParams, "startDate" | "endDate"> = {}) {}
  add(row: BusinessLogStatsRow): void {
    const { summary, dailyMap, typeMap, categoryMap, successMap, typeDailyMap, categoryDailyMap } = this;

    const createTime = new Date(row.createTime);
    const dateKey = createTime.toISOString().slice(0, 10);
    const typeKey = row.operationType || "UNKNOWN";
    const categoryKey = row.operationCategory || "UNKNOWN";
    const successKey = row.success ? "success" : "failed";

    summary.totalLogs += 1;
    if (row.success) summary.successLogs += 1;
    else summary.failedLogs += 1;
    if (row.actorUserId) summary.uniqueActors.add(row.actorUserId);
    else summary.systemTriggeredLogs += 1;
    if (row.targetUserId) summary.uniqueTargets.add(row.targetUserId);
    if (row.ipAddress) summary.uniqueIPs.add(row.ipAddress);

    const daily = dailyMap.get(dateKey) || {
      date: dateKey,
      totalLogs: 0,
      successLogs: 0,
      failedLogs: 0,
    };
    daily.totalLogs += 1;
    if (row.success) daily.successLogs += 1;
    else daily.failedLogs += 1;
    dailyMap.set(dateKey, daily);

    typeMap.set(typeKey, (typeMap.get(typeKey) || 0) + 1);
    categoryMap.set(categoryKey, (categoryMap.get(categoryKey) || 0) + 1);
    successMap.set(successKey, (successMap.get(successKey) || 0) + 1);

    const typeDailyComposite = `${dateKey}::${typeKey}`;
    const typeDaily = typeDailyMap.get(typeDailyComposite) || {
      date: dateKey,
      key: typeKey,
      label: typeKey,
      count: 0,
    };
    typeDaily.count += 1;
    typeDailyMap.set(typeDailyComposite, typeDaily);

    const categoryDailyComposite = `${dateKey}::${categoryKey}`;
    const categoryDaily = categoryDailyMap.get(categoryDailyComposite) || {
      date: dateKey,
      key: categoryKey,
      label: categoryKey,
      count: 0,
    };
    categoryDaily.count += 1;
    categoryDailyMap.set(categoryDailyComposite, categoryDaily);

    if (!this.minDate || createTime < this.minDate) this.minDate = createTime;
    if (!this.maxDate || createTime > this.maxDate) this.maxDate = createTime;
  }
  result(): BusinessLogStatsResponse {
    const {
      summary,
      dailyMap,
      typeMap,
      categoryMap,
      successMap,
      typeDailyMap,
      categoryDailyMap,
      minDate,
      maxDate,
      filters,
    } = this;
    const totalLogs = summary.totalLogs;
    const finalizeBreakdown = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([key, count]) => ({
          key,
          label: key,
          count,
          share: totalLogs > 0 ? Math.round((count / totalLogs) * 10000) / 100 : 0,
        }))
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.label.localeCompare(b.label);
        });

    const resolvedStart = filters?.startDate
      ? new Date(new Date(filters.startDate).setHours(0, 0, 0, 0))
      : minDate
        ? new Date(new Date(minDate).setHours(0, 0, 0, 0))
        : new Date(new Date().setHours(0, 0, 0, 0));
    const resolvedEnd = filters?.endDate
      ? new Date(new Date(filters.endDate).setHours(23, 59, 59, 999))
      : maxDate
        ? new Date(new Date(maxDate).setHours(23, 59, 59, 999))
        : new Date(new Date().setHours(23, 59, 59, 999));

    return {
      range: {
        startDate: resolvedStart.toISOString(),
        endDate: resolvedEnd.toISOString(),
        days: Math.max(1, Math.floor((resolvedEnd.getTime() - resolvedStart.getTime()) / (24 * 60 * 60 * 1000)) + 1),
      },
      summary: {
        totalLogs: summary.totalLogs,
        successLogs: summary.successLogs,
        failedLogs: summary.failedLogs,
        uniqueActors: summary.uniqueActors.size,
        systemTriggeredLogs: summary.systemTriggeredLogs,
        uniqueTargets: summary.uniqueTargets.size,
        uniqueIPs: summary.uniqueIPs.size,
      },
      daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byOperationType: finalizeBreakdown(typeMap),
      byOperationCategory: finalizeBreakdown(categoryMap),
      bySuccess: finalizeBreakdown(successMap).map((item) => ({
        ...item,
        label: item.key === "success" ? "success" : "failed",
      })),
      operationTypeDailyDistribution: [...typeDailyMap.values()].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      }),
      categoryDailyDistribution: [...categoryDailyMap.values()].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      }),
      generatedAt: new Date().toISOString(),
    };
  }
}
