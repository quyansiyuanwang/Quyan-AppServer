import type { SystemLogStatsDTO } from "@/api/dto/system/system.dto";
import type { APILogStatsRow, ApiLogFilters } from "@/store/system/apilog.store";
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function roundCountShare(count: number, total: number): number {
  return total > 0 ? round2((count / total) * 100) : 0;
}

interface SystemLogStatsSummaryAccumulator {
  totalRequests: number;
  successRequests: number;
  redirectRequests: number;
  clientErrorRequests: number;
  serverErrorRequests: number;
  uniqueUsers: Set<string>;
  uniqueIPs: Set<string>;
  anonymousRequests: number;
}

interface SystemLogStatsDailyAccumulator {
  date: string;
  totalRequests: number;
  successRequests: number;
  clientErrorRequests: number;
  serverErrorRequests: number;
}

function createSystemLogStatsSummaryAccumulator(): SystemLogStatsSummaryAccumulator {
  return {
    totalRequests: 0,
    successRequests: 0,
    redirectRequests: 0,
    clientErrorRequests: 0,
    serverErrorRequests: 0,
    uniqueUsers: new Set<string>(),
    uniqueIPs: new Set<string>(),
    anonymousRequests: 0,
  };
}

function applySystemLogStats(
  acc: SystemLogStatsSummaryAccumulator | SystemLogStatsDailyAccumulator,
  statusCode: number,
): void {
  acc.totalRequests += 1;
  if (statusCode >= 200 && statusCode < 300) acc.successRequests += 1;
  else if (statusCode >= 300 && statusCode < 400 && "redirectRequests" in acc) acc.redirectRequests += 1;
  else if (statusCode >= 400 && statusCode < 500) acc.clientErrorRequests += 1;
  else if (statusCode >= 500) acc.serverErrorRequests += 1;
}

function finalizeSystemLogStatsSummary(acc: SystemLogStatsSummaryAccumulator) {
  return {
    totalRequests: acc.totalRequests,
    successRequests: acc.successRequests,
    redirectRequests: acc.redirectRequests,
    clientErrorRequests: acc.clientErrorRequests,
    serverErrorRequests: acc.serverErrorRequests,
    uniqueUsers: acc.uniqueUsers.size,
    anonymousRequests: acc.anonymousRequests,
    uniqueIPs: acc.uniqueIPs.size,
  };
}

function normalizeTopPaths(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return "unknown";

  const segments = trimmed.split("/").filter(Boolean);
  const normalizedSegments = segments.map((segment) =>
    /^[0-9]+$/.test(segment) || /^[a-z0-9]{16,}$/i.test(segment) ? ":id" : segment,
  );

  return `/${normalizedSegments.join("/")}`;
}
export class SystemLogStatisticsAccumulator {
  private readonly summaryAcc = createSystemLogStatsSummaryAccumulator();
  private readonly dailyMap = new Map<string, SystemLogStatsDailyAccumulator>();
  private readonly methodMap = new Map<string, number>();
  private readonly statusMap = new Map<string, number>();
  private readonly pathMap = new Map<string, number>();
  private readonly methodDailyMap = new Map<string, { date: string; key: string; label: string; count: number }>();
  private readonly statusDailyMap = new Map<string, { date: string; key: string; label: string; count: number }>();

  private minDate: Date | null = null;
  private maxDate: Date | null = null;

  constructor(private readonly filters?: Pick<ApiLogFilters, "startDate" | "endDate">) {}
  add(row: APILogStatsRow): void {
    const createTime = new Date(row.createTime);
    const dateKey = formatDateKey(createTime);
    const methodKey = row.method || "UNKNOWN";
    const statusKey = String(row.statusCode);
    const pathKey = normalizeTopPaths(row.path);

    applySystemLogStats(this.summaryAcc, row.statusCode);
    if (row.userID) this.summaryAcc.uniqueUsers.add(row.userID);
    else this.summaryAcc.anonymousRequests += 1;
    if (row.ipAddress) this.summaryAcc.uniqueIPs.add(row.ipAddress);

    const daily = this.dailyMap.get(dateKey) || {
      date: dateKey,
      totalRequests: 0,
      successRequests: 0,
      clientErrorRequests: 0,
      serverErrorRequests: 0,
    };
    applySystemLogStats(daily, row.statusCode);
    this.dailyMap.set(dateKey, daily);

    this.methodMap.set(methodKey, (this.methodMap.get(methodKey) || 0) + 1);
    this.statusMap.set(statusKey, (this.statusMap.get(statusKey) || 0) + 1);
    this.pathMap.set(pathKey, (this.pathMap.get(pathKey) || 0) + 1);

    const methodDailyComposite = `${dateKey}::${methodKey}`;
    const methodDaily = this.methodDailyMap.get(methodDailyComposite) || {
      date: dateKey,
      key: methodKey,
      label: methodKey,
      count: 0,
    };
    methodDaily.count += 1;
    this.methodDailyMap.set(methodDailyComposite, methodDaily);

    const statusDailyComposite = `${dateKey}::${statusKey}`;
    const statusDaily = this.statusDailyMap.get(statusDailyComposite) || {
      date: dateKey,
      key: statusKey,
      label: statusKey,
      count: 0,
    };
    statusDaily.count += 1;
    this.statusDailyMap.set(statusDailyComposite, statusDaily);

    if (!this.minDate || createTime < this.minDate) this.minDate = createTime;
    if (!this.maxDate || createTime > this.maxDate) this.maxDate = createTime;
  }
  result(): SystemLogStatsDTO {
    const summary = finalizeSystemLogStatsSummary(this.summaryAcc);
    const totalRequests = summary.totalRequests;

    const finalizeBreakdown = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([key, count]) => ({
          key,
          label: key,
          count,
          share: roundCountShare(count, totalRequests),
        }))
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.label.localeCompare(b.label);
        });

    const resolvedStart = this.filters?.startDate
      ? startOfDay(this.filters.startDate)
      : this.minDate
        ? startOfDay(this.minDate)
        : startOfDay(new Date());
    const resolvedEnd = this.filters?.endDate
      ? endOfDay(this.filters.endDate)
      : this.maxDate
        ? endOfDay(this.maxDate)
        : endOfDay(new Date());

    return {
      range: {
        startDate: resolvedStart.toISOString(),
        endDate: resolvedEnd.toISOString(),
        days: Math.max(1, Math.floor((resolvedEnd.getTime() - resolvedStart.getTime()) / (24 * 60 * 60 * 1000)) + 1),
      },
      summary,
      daily: [...this.dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byMethod: finalizeBreakdown(this.methodMap),
      byStatusCode: finalizeBreakdown(this.statusMap),
      byPath: finalizeBreakdown(this.pathMap).slice(0, 12),
      methodDailyDistribution: [...this.methodDailyMap.values()].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      }),
      statusDailyDistribution: [...this.statusDailyMap.values()].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      }),
      generatedAt: new Date().toISOString(),
    };
  }
}
