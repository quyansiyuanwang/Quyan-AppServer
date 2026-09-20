import { describe, expect, it, vi } from "vitest";
import {
  ChinaHolidayCalendarService,
  getChinaCalendarDate,
  parseChinaHolidayYear,
} from "@/services/relay/china-holiday-calendar.service";

// Deliberately minimal provider fixture, not a production calendar.
const fixture = () => ({
  code: 0,
  holiday: {
    "01-01": { date: "2026-01-01", holiday: true },
    "05-01": { date: "2026-05-01", holiday: true },
    "10-01": { date: "2026-10-01", holiday: true },
    "01-04": { date: "2026-01-04", holiday: false },
  },
});
function setup() {
  let now = Date.parse("2026-09-20T00:00:00Z");
  const deps = {
    now: () => now,
    load: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    fetchYear: vi.fn().mockResolvedValue(fixture()),
    warn: vi.fn(),
  };
  return {
    deps,
    service: new ChinaHolidayCalendarService(deps),
    advance: () => {
      now += 25 * 60 * 60 * 1000;
    },
  };
}

describe("Chinese holiday calendar", () => {
  it("uses Shanghai date and midnight independent of server timezone", () => {
    expect(getChinaCalendarDate(new Date("2026-09-30T16:00:00Z"))).toEqual({
      date: "2026-10-01",
      dayOfWeek: 4,
      minutes: 0,
    });
  });

  it("validates annual dates, publication and fixed holidays", () => {
    expect(parseChinaHolidayYear(fixture(), 2026)).toEqual(fixture());
    expect(() => parseChinaHolidayYear(fixture(), 2027)).toThrow();
    expect(() => parseChinaHolidayYear({ code: 0, holiday: {} }, 2026)).toThrow();
    expect(() => parseChinaHolidayYear({ code: -1, holiday: fixture().holiday }, 2026)).toThrow();
    expect(() =>
      parseChinaHolidayYear(
        { code: 0, holiday: { ...fixture().holiday, "02-30": { holiday: true, date: "2026-02-30" } } },
        2026,
      ),
    ).toThrow();
    expect(() => parseChinaHolidayYear({ code: 0, holiday: { "01-01": fixture().holiday["01-01"] } }, 2026)).toThrow();
  });

  it("coalesces fetches, saves validated data, and distinguishes holidays from makeup workdays", async () => {
    const { service, deps } = setup();
    await Promise.all([service.refreshYear(2026), service.refreshYear(2026)]);
    expect(deps.fetchYear).toHaveBeenCalledTimes(1);
    expect(deps.save).toHaveBeenCalledTimes(1);
    expect(service.isHoliday("2026-01-01")).toBe(true);
    expect(service.isHoliday("2026-01-04")).toBe(false);
    expect(service.isHoliday("2026-06-29")).toBe(false);
    expect(service.isHoliday("2027-01-01")).toBeUndefined();
    await service.refreshYear(2026);
    expect(deps.fetchYear).toHaveBeenCalledTimes(1);
  });

  it("hydrates fresh Redis data without a provider request", async () => {
    const { service, deps } = setup();
    deps.load.mockResolvedValue(JSON.stringify({ fetchedAt: deps.now() - 1000, payload: fixture() }));
    await service.refreshYear(2026);
    expect(deps.fetchYear).not.toHaveBeenCalled();
    expect(service.isHoliday("2026-10-01")).toBe(true);
  });

  it("keeps a stale valid snapshot on provider failure", async () => {
    const { service, deps } = setup();
    deps.load.mockResolvedValue(JSON.stringify({ fetchedAt: deps.now() - 2 * 86400000, payload: fixture() }));
    deps.fetchYear.mockRejectedValue(new Error("offline"));
    await service.refreshYear(2026);
    expect(service.isHoliday("2026-10-01")).toBe(true);
    expect(deps.warn).toHaveBeenCalled();
  });

  it("does not overwrite good data with an unpublished/empty refresh", async () => {
    const { service, deps, advance } = setup();
    await service.refreshYear(2026);
    advance();
    deps.fetchYear.mockResolvedValue({ code: 0, holiday: {} });
    await service.refreshYear(2026);
    expect(service.isHoliday("2026-10-01")).toBe(true);
    expect(deps.save).toHaveBeenCalledTimes(1);
  });

  it("fetches after corrupt cache and retains memory if cache persistence fails", async () => {
    const { service, deps } = setup();
    deps.load.mockResolvedValue("invalid-json");
    deps.save.mockRejectedValue(new Error("redis offline"));
    await service.refreshYear(2026);
    expect(service.isHoliday("2026-10-01")).toBe(true);
  });

  it("prefetches the next year, starts once, and stops background work", async () => {
    vi.useFakeTimers();
    const { service, deps, advance } = setup();
    deps.fetchYear.mockImplementation(async (year: number) =>
      JSON.parse(JSON.stringify(fixture()).replaceAll("2026", String(year))),
    );
    try {
      service.start();
      service.start();
      await Promise.all([service.refreshYear(2026), service.refreshYear(2027)]);
      expect(deps.fetchYear).toHaveBeenCalledTimes(2);
      expect(service.isHoliday("2027-01-01")).toBe(true);
      // Request-path lookups must never perform cache or network I/O.
      deps.load.mockClear();
      for (let i = 0; i < 100; i++) service.isHoliday("2026-10-01");
      expect(deps.load).not.toHaveBeenCalled();
      expect(deps.fetchYear).toHaveBeenCalledTimes(2);
      await service.stop();
      advance();
      await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000);
      expect(deps.fetchYear).toHaveBeenCalledTimes(2);
    } finally {
      await service.stop();
      vi.useRealTimers();
    }
  });

  it("returns unknown and rate limits warnings/retries without a valid snapshot", async () => {
    const { service, deps, advance } = setup();
    deps.fetchYear.mockRejectedValue(new Error("timeout"));
    await service.refreshYear(2026);
    deps.warn.mockClear();
    expect(service.isHoliday("2026-10-01")).toBeUndefined();
    expect(service.isHoliday("2026-10-02")).toBeUndefined();
    expect(deps.warn).toHaveBeenCalledTimes(1);
    await service.refreshYear(2026);
    expect(deps.fetchYear).toHaveBeenCalledTimes(1);
    advance();
    deps.fetchYear.mockResolvedValue(fixture());
    await service.refreshYear(2026);
    expect(service.isHoliday("2026-10-01")).toBe(true);
  });
});
