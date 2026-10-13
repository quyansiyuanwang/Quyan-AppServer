import { describe, expect, it } from "vitest";
import { SystemLogStatisticsAccumulator, startOfDay, endOfDay } from "@/services/system/system-log-statistics";
import type { APILogStatsRow } from "@/store/system/apilog.store";
const row = (extra: Partial<APILogStatsRow> = {}): APILogStatsRow => ({
  createTime: new Date(2026, 9, 14, 12),
  method: "GET",
  path: "/api/users/123",
  statusCode: 200,
  userID: "alice",
  ipAddress: "192.0.2.1",
  ...extra,
});
describe("incremental API log statistics preserve the public report", () => {
  it("retains all status families, anonymous counts, deduplication, percentages and local days", () => {
    const stats = new SystemLogStatisticsAccumulator();
    for (const item of [
      row(),
      row({ statusCode: 302 }),
      row({ statusCode: 404, userID: null, method: "POST" }),
      row({ statusCode: 503, userID: "bob", ipAddress: "192.0.2.2", createTime: new Date(2026, 9, 15, 12) }),
      row({ statusCode: 100, method: "", ipAddress: "" }),
    ])
      stats.add(item);
    const result = stats.result();
    expect(result.summary).toEqual({
      totalRequests: 5,
      successRequests: 1,
      redirectRequests: 1,
      clientErrorRequests: 1,
      serverErrorRequests: 1,
      uniqueUsers: 2,
      anonymousRequests: 1,
      uniqueIPs: 2,
    });
    expect(result.daily).toEqual([
      { date: "2026-10-14", totalRequests: 4, successRequests: 1, clientErrorRequests: 1, serverErrorRequests: 0 },
      { date: "2026-10-15", totalRequests: 1, successRequests: 0, clientErrorRequests: 0, serverErrorRequests: 1 },
    ]);
    expect(result.byMethod).toEqual([
      { key: "GET", label: "GET", count: 3, share: 60 },
      { key: "POST", label: "POST", count: 1, share: 20 },
      { key: "UNKNOWN", label: "UNKNOWN", count: 1, share: 20 },
    ]);
    expect(result.byPath).toEqual([{ key: "/api/users/:id", label: "/api/users/:id", count: 5, share: 100 }]);
    expect(result.range).toEqual({
      startDate: startOfDay(new Date(2026, 9, 14)).toISOString(),
      endDate: endOfDay(new Date(2026, 9, 15)).toISOString(),
      days: 2,
    });
    expect(result.statusDailyDistribution.reduce((sum, item) => sum + item.count, 0)).toBe(5);
    expect(result.methodDailyDistribution.reduce((sum, item) => sum + item.count, 0)).toBe(5);
  });
  it("preserves an explicit empty date range and zero totals", () => {
    const startDate = new Date(2026, 9, 13, 8),
      endDate = new Date(2026, 9, 15, 17),
      result = new SystemLogStatisticsAccumulator({ startDate, endDate }).result();
    expect(result.range).toEqual({
      startDate: startOfDay(startDate).toISOString(),
      endDate: endOfDay(endDate).toISOString(),
      days: 3,
    });
    expect(result.summary.totalRequests).toBe(0);
    expect(result.daily).toEqual([]);
    expect(result.byMethod).toEqual([]);
  });
  it("normalizes long identifiers, rounds shares and returns at most twelve top paths", () => {
    const stats = new SystemLogStatisticsAccumulator();
    stats.add(row({ path: "/api/a/abcdefghijklmnop" }));
    stats.add(row({ path: "/api/a/0123456789012345" }));
    stats.add(row({ path: "/api/b" }));
    expect(stats.result().byPath).toEqual([
      { key: "/api/a/:id", label: "/api/a/:id", count: 2, share: 66.67 },
      { key: "/api/b", label: "/api/b", count: 1, share: 33.33 },
    ]);
    for (let i = 0; i < 20; i++) stats.add(row({ path: "/unique/label" + String.fromCharCode(97 + i) }));
    expect(stats.result().byPath).toHaveLength(12);
  });
  it("gives the same report regardless of incremental batch order", () => {
    const rows = [
      row(),
      row({ statusCode: 403, method: "PATCH" }),
      row({ statusCode: 500, userID: null, createTime: new Date(2026, 9, 15, 12) }),
    ];
    const first = new SystemLogStatisticsAccumulator(),
      second = new SystemLogStatisticsAccumulator();
    rows.forEach((item) => first.add(item));
    [...rows].reverse().forEach((item) => second.add(item));
    const { generatedAt: _first, ...a } = first.result(),
      { generatedAt: _second, ...b } = second.result();
    expect(a).toEqual(b);
  });
});
