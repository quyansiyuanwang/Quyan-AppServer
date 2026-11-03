import { describe, expect, it } from "vitest";
import {
  dueProbeDailyOccurrence,
  nextProbeDailyOccurrence,
  probeDailyOccurrence,
} from "@/services/relay/relay-probe-round-policy";
import { probeRoundChanges, probeRoundFailure } from "@/services/relay/relay-probe-round-report";

describe("daily probe clock", () => {
  it("uses Shanghai 03:00 independently of the worker timezone", () => {
    expect(probeDailyOccurrence(new Date("2026-11-03T00:00:00Z"), 180).toISOString()).toBe("2026-11-02T19:00:00.000Z");
    expect(nextProbeDailyOccurrence(new Date("2026-11-02T18:59:59Z"), 180).toISOString()).toBe(
      "2026-11-02T19:00:00.000Z",
    );
    expect(nextProbeDailyOccurrence(new Date("2026-11-02T19:00:00Z"), 180).toISOString()).toBe(
      "2026-11-03T19:00:00.000Z",
    );
  });
  it("recovers today's missed occurrence only, with no previous-day replay before 03:00", () => {
    expect(dueProbeDailyOccurrence(new Date("2026-11-02T18:59:59Z"), 180)).toBeUndefined();
    expect(dueProbeDailyOccurrence(new Date("2026-11-03T06:00:00Z"), 180)?.toISOString()).toBe(
      "2026-11-02T19:00:00.000Z",
    );
  });
  it.each([-1, 1440, 1.5, NaN])("rejects invalid minute %s", (minute) =>
    expect(() => probeDailyOccurrence(new Date(), minute)).toThrow(),
  );
});
describe("safe round report metrics", () => {
  it("compares both measured and previous valid suggestions", () => {
    expect(probeRoundChanges(2, 3, 4)).toEqual({
      multiplierChange: 1,
      multiplierChangePercent: 50,
      suggestionChange: -1,
      suggestionChangePercent: -25,
    });
    expect(probeRoundChanges(0, undefined, undefined)).toEqual({
      multiplierChange: undefined,
      multiplierChangePercent: undefined,
      suggestionChange: undefined,
      suggestionChangePercent: undefined,
    });
  });
  it("retains stage and HTTP code without including a raw response or credential", () => {
    const failure = probeRoundFailure("failed", "读取余额失败：HTTP 401 secret fixture-password");
    expect(failure).toEqual({ errorStage: "balance", errorCode: "upstream-http-401" });
    expect(JSON.stringify(failure)).not.toContain("fixture-password");
    expect(probeRoundFailure("succeeded", "anything")).toEqual({});
  });
});
