import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessLogStatisticsAccumulator } from "@/services/system/business-log-statistics";
import type { BusinessLogStatsRow } from "@/store/system/businesslog.store";
const row = (changes: Partial<BusinessLogStatsRow> = {}): BusinessLogStatsRow => ({
  createTime: new Date("2026-10-13T12:00:00Z"),
  operationType: "A",
  operationCategory: "X",
  actorUserId: "actor",
  targetUserId: "target",
  success: true,
  ipAddress: "192.0.2.1",
  ...changes,
});
afterEach(() => vi.useRealTimers());
describe("incremental business log statistics preserve public calculations", () => {
  it("counts distinct actors, targets and addresses and sorts ties deterministically", () => {
    const stats = new BusinessLogStatisticsAccumulator();
    stats.add(row());
    stats.add(
      row({
        operationType: "B",
        operationCategory: "Y",
        actorUserId: null,
        targetUserId: null,
        ipAddress: "",
        success: false,
      }),
    );
    stats.add(
      row({
        createTime: new Date("2026-10-14T12:00:00Z"),
        operationType: "B",
        actorUserId: "actor-2",
        targetUserId: "target-2",
        ipAddress: "192.0.2.2",
      }),
    );
    const result = stats.result();
    expect(result.summary).toEqual({
      totalLogs: 3,
      successLogs: 2,
      failedLogs: 1,
      uniqueActors: 2,
      systemTriggeredLogs: 1,
      uniqueTargets: 2,
      uniqueIPs: 2,
    });
    expect(result.byOperationType).toEqual([
      { key: "B", label: "B", count: 2, share: 66.67 },
      { key: "A", label: "A", count: 1, share: 33.33 },
    ]);
    expect(result.daily).toEqual([
      { date: "2026-10-13", totalLogs: 2, successLogs: 1, failedLogs: 1 },
      { date: "2026-10-14", totalLogs: 1, successLogs: 1, failedLogs: 0 },
    ]);
    expect(result.operationTypeDailyDistribution).toEqual([
      { date: "2026-10-13", key: "A", label: "A", count: 1 },
      { date: "2026-10-13", key: "B", label: "B", count: 1 },
      { date: "2026-10-14", key: "B", label: "B", count: 1 },
    ]);
    expect(result.categoryDailyDistribution).toEqual([
      { date: "2026-10-13", key: "X", label: "X", count: 1 },
      { date: "2026-10-13", key: "Y", label: "Y", count: 1 },
      { date: "2026-10-14", key: "X", label: "X", count: 1 },
    ]);
  });
  it("preserves unknown operation fallbacks and UTC daily keys", () => {
    const stats = new BusinessLogStatisticsAccumulator();
    stats.add(row({ operationType: "", operationCategory: "", createTime: new Date("2026-10-13T23:59:59Z") }));
    expect(stats.result().byOperationType).toEqual([{ key: "UNKNOWN", label: "UNKNOWN", count: 1, share: 100 }]);
    expect(stats.result().daily[0]!.date).toBe("2026-10-13");
  });
  it("preserves requested local-day boundaries even without rows", () => {
    const stats = new BusinessLogStatisticsAccumulator({
      startDate: new Date(2026, 9, 12, 12),
      endDate: new Date(2026, 9, 14, 12),
    });
    const result = stats.result();
    expect(result.range).toEqual({
      startDate: new Date(2026, 9, 12, 0, 0, 0, 0).toISOString(),
      endDate: new Date(2026, 9, 14, 23, 59, 59, 999).toISOString(),
      days: 3,
    });
    expect(result.summary.totalLogs).toBe(0);
    expect(result.bySuccess).toEqual([]);
    expect(result.daily).toEqual([]);
  });
  it("uses today for an empty unbounded result", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 12));
    const result = new BusinessLogStatisticsAccumulator().result();
    expect(result.range).toEqual({
      startDate: new Date(2026, 9, 14).toISOString(),
      endDate: new Date(2026, 9, 14, 23, 59, 59, 999).toISOString(),
      days: 1,
    });
    expect(result.generatedAt).toBe(new Date(2026, 9, 14, 12).toISOString());
  });
});
