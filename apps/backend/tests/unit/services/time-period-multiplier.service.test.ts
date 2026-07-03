import { describe, expect, it } from "vitest";
import { computeMultiplierForTime, TimePeriodRule } from "@/services/relay/time-period-multiplier.service";

function makeRule(overrides: Partial<TimePeriodRule> = {}): TimePeriodRule {
  return {
    name: "test-rule",
    enabled: true,
    dayOfWeek: "1,2,3,4,5",
    startTime: "09:00",
    endTime: "18:00",
    multiplier: 2,
    ...overrides,
  };
}

function dateFrom(dayOfWeek: number, hours: number, minutes = 0): Date {
  // 2026-06-29 is a Monday (6/29 = Mon, 6/30 = Tue, 7/1 = Wed, ...)
  // Use a known Monday as base, then offset
  const base = new Date("2026-06-29T00:00:00");
  base.setDate(base.getDate() + (dayOfWeek - 1));
  base.setHours(hours, minutes, 0, 0);
  return base;
}

describe("computeMultiplierForTime", () => {
  it("returns 1.0 when no rules provided", () => {
    expect(computeMultiplierForTime([], dateFrom(1, 10, 0))).toBe(1.0);
  });

  it("returns 1.0 when all rules are disabled", () => {
    const rules = [makeRule({ enabled: false })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 10, 0))).toBe(1.0);
  });

  it("applies multiplier when day and time match", () => {
    const rules = [makeRule({ multiplier: 2 })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 10, 0))).toBe(2);
  });

  it("returns 1.0 when day does not match", () => {
    const rules = [makeRule({ dayOfWeek: "1,2,3,4,5" })];
    // Saturday (day 6) should not match
    expect(computeMultiplierForTime(rules, dateFrom(6, 10, 0))).toBe(1.0);
  });

  it("returns 1.0 when time is before range", () => {
    const rules = [makeRule({ startTime: "09:00", endTime: "18:00" })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 8, 59))).toBe(1.0);
  });

  it("returns 1.0 when time is after range", () => {
    const rules = [makeRule({ startTime: "09:00", endTime: "18:00" })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 18, 0))).toBe(1.0);
  });

  it("applies multiplier at exact start boundary", () => {
    const rules = [makeRule({ startTime: "09:00", endTime: "18:00" })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 9, 0))).toBe(2);
  });

  it("returns 1.0 at exact end boundary (endMinutes is exclusive)", () => {
    const rules = [makeRule({ startTime: "09:00", endTime: "18:00" })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 18, 0))).toBe(1.0);
  });

  it("matches overnight range when current time is after start (crossing midnight)", () => {
    const rules = [makeRule({ startTime: "22:00", endTime: "02:00" })];
    // 23:30 is within 22:00-02:00
    expect(computeMultiplierForTime(rules, dateFrom(1, 23, 30))).toBe(2);
  });

  it("matches overnight range when current time is before end (crossing midnight)", () => {
    const rules = [makeRule({ startTime: "22:00", endTime: "02:00" })];
    // 01:30 is within 22:00-02:00
    expect(computeMultiplierForTime(rules, dateFrom(2, 1, 30))).toBe(2);
  });

  it("returns 1.0 outside overnight range", () => {
    const rules = [makeRule({ startTime: "22:00", endTime: "02:00" })];
    // 03:00 is outside 22:00-02:00
    expect(computeMultiplierForTime(rules, dateFrom(1, 3, 0))).toBe(1.0);
  });

  it("multiplies when multiple rules match", () => {
    const rules = [
      makeRule({ name: "daytime", startTime: "08:00", endTime: "20:00", multiplier: 2 }),
      makeRule({ name: "weekday", dayOfWeek: "1,2,3,4,5", multiplier: 3 }),
    ];
    expect(computeMultiplierForTime(rules, dateFrom(1, 10, 0))).toBe(6);
  });

  it("skips rules that don't match day and only applies matching ones", () => {
    const rules = [
      makeRule({ name: "weekday-only", dayOfWeek: "1,2,3,4,5", multiplier: 2 }),
      makeRule({ name: "weekend-only", dayOfWeek: "6,7", multiplier: 5 }),
    ];
    // Monday matches first rule only
    expect(computeMultiplierForTime(rules, dateFrom(1, 10, 0))).toBe(2);
  });

  it("matches any day when dayOfWeek is empty string", () => {
    const rules = [makeRule({ dayOfWeek: "" })];
    expect(computeMultiplierForTime(rules, dateFrom(6, 10, 0))).toBe(2);
    expect(computeMultiplierForTime(rules, dateFrom(7, 10, 0))).toBe(2);
  });

  it("matches any day when dayOfWeek is whitespace only", () => {
    const rules = [makeRule({ dayOfWeek: "   " })];
    expect(computeMultiplierForTime(rules, dateFrom(6, 10, 0))).toBe(2);
  });

  it("handles Sunday (day 7) correctly", () => {
    // dayOfWeek="7" should match Sunday
    const rules = [makeRule({ dayOfWeek: "7", multiplier: 1.5 })];
    expect(computeMultiplierForTime(rules, dateFrom(7, 10, 0))).toBe(1.5);
  });

  it("handles mixed enabled and disabled rules", () => {
    const rules = [
      makeRule({ name: "disabled", enabled: false, multiplier: 10 }),
      makeRule({ name: "enabled", multiplier: 1.5 }),
    ];
    expect(computeMultiplierForTime(rules, dateFrom(1, 10, 0))).toBe(1.5);
  });

  it("handles multiplier of 0 (product becomes 0)", () => {
    const rules = [makeRule({ multiplier: 0 })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 10, 0))).toBe(0);
  });

  it("handles multiplier less than 1 (discount period)", () => {
    const rules = [makeRule({ multiplier: 0.5 })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 10, 0))).toBe(0.5);
  });

  it("handles multiplier exactly 1.0 (no effect on product)", () => {
    const rules = [makeRule({ multiplier: 1.0 }), makeRule({ multiplier: 1.0 })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 10, 0))).toBe(1.0);
  });

  it("matches a single day of week", () => {
    const rules = [makeRule({ dayOfWeek: "3", multiplier: 3 })];
    // Wednesday (day 3) should match
    expect(computeMultiplierForTime(rules, dateFrom(3, 10, 0))).toBe(3);
    // Tuesday (day 2) should not match
    expect(computeMultiplierForTime(rules, dateFrom(2, 10, 0))).toBe(1.0);
  });

  it("handles dayOfWeek values with spaces", () => {
    const rules = [makeRule({ dayOfWeek: "1, 2, 3", multiplier: 2 })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 10, 0))).toBe(2);
    expect(computeMultiplierForTime(rules, dateFrom(6, 10, 0))).toBe(1.0);
  });

  it("overnight range at exact midnight boundary (00:00)", () => {
    const rules = [makeRule({ startTime: "22:00", endTime: "02:00" })];
    // exactly midnight should be within 22:00-02:00
    expect(computeMultiplierForTime(rules, dateFrom(1, 0, 0))).toBe(2);
  });

  it("time range covering entire day (00:00-23:59)", () => {
    const rules = [makeRule({ startTime: "00:00", endTime: "23:59", multiplier: 1.5 })];
    expect(computeMultiplierForTime(rules, dateFrom(1, 0, 0))).toBe(1.5);
    expect(computeMultiplierForTime(rules, dateFrom(1, 12, 0))).toBe(1.5);
    expect(computeMultiplierForTime(rules, dateFrom(1, 23, 58))).toBe(1.5);
    // 23:59 is the end boundary, exclusive: 23:59 is within [00:00, 23:59)
    // but 23:59:00 converts to 23*60+59 = 1439 minutes, and end is 23*60+59 = 1439
    // so currentMinutes (1439) is NOT < endMinutes (1439), meaning NOT in range
    // This is correct behavior - 23:59:00 is excluded due to exclusive end
    expect(computeMultiplierForTime(rules, dateFrom(1, 23, 59))).toBe(1.0);
  });

  it("applies correct product when multiple overnight rules match", () => {
    const rules = [
      makeRule({ name: "night-1", startTime: "22:00", endTime: "02:00", multiplier: 2 }),
      makeRule({ name: "night-2", startTime: "23:00", endTime: "01:00", multiplier: 3 }),
    ];
    // 23:30 matches both overnight ranges
    expect(computeMultiplierForTime(rules, dateFrom(1, 23, 30))).toBe(6);
    // 01:30 matches first (22:00-02:00) but not second (23:00-01:00, end exclusive)
    expect(computeMultiplierForTime(rules, dateFrom(2, 1, 30))).toBe(2);
  });

  it("does not apply rule when only day matches but time does not", () => {
    const rules = [makeRule({ startTime: "09:00", endTime: "18:00" })];
    // Monday 20:00 — day matches but time does not
    expect(computeMultiplierForTime(rules, dateFrom(1, 20, 0))).toBe(1.0);
  });

  it("does not apply rule when only time matches but day does not", () => {
    const rules = [makeRule({ dayOfWeek: "1,2,3,4,5" })];
    // Saturday 10:00 — time matches but day does not
    expect(computeMultiplierForTime(rules, dateFrom(6, 10, 0))).toBe(1.0);
  });
});
