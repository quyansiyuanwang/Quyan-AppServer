import { describe, expect, it } from "vitest";
import {
  isValidRetryStatusRule,
  matchesRetryStatusRule,
  normalizeRetryStatusRules,
} from "@/util/relay-failover-status-rule.util";

describe("relay-failover-status-rule util", () => {
  describe("isValidRetryStatusRule", () => {
    it("accepts exact status codes, wildcard rules, and regex literals", () => {
      expect(isValidRetryStatusRule("401")).toBe(true);
      expect(isValidRetryStatusRule("4xx")).toBe(true);
      expect(isValidRetryStatusRule("xx*")).toBe(true);
      expect(isValidRetryStatusRule("/^5(02|03)$/")).toBe(true);
    });

    it("rejects invalid and empty rules", () => {
      expect(isValidRetryStatusRule("")).toBe(false);
      expect(isValidRetryStatusRule("700")).toBe(false);
      expect(isValidRetryStatusRule("abc")).toBe(false);
      expect(isValidRetryStatusRule("/[unclosed/")).toBe(false);
    });
  });

  describe("matchesRetryStatusRule", () => {
    it("matches exact rules", () => {
      expect(matchesRetryStatusRule(401, "401")).toBe(true);
      expect(matchesRetryStatusRule(403, "401")).toBe(false);
    });

    it("matches wildcard rules", () => {
      expect(matchesRetryStatusRule(429, "4xx")).toBe(true);
      expect(matchesRetryStatusRule(405, "40x")).toBe(true);
      expect(matchesRetryStatusRule(503, "xx*")).toBe(true);
      expect(matchesRetryStatusRule(200, "4xx")).toBe(false);
    });

    it("matches regex rules", () => {
      expect(matchesRetryStatusRule(502, "/^5(02|03)$/")).toBe(true);
      expect(matchesRetryStatusRule(503, "/^5(02|03)$/")).toBe(true);
      expect(matchesRetryStatusRule(504, "/^5(02|03)$/")).toBe(false);
    });
  });

  describe("normalizeRetryStatusRules", () => {
    it("trims, deduplicates, lowercases wildcards, and preserves regex literals", () => {
      expect(normalizeRetryStatusRules([" 4XX ", "503", 503, " /^5(02|03)$/ ", "invalid", "4xx"])).toEqual([
        "4xx",
        "503",
        "/^5(02|03)$/",
      ]);
    });

    it("returns an empty array for non-array inputs", () => {
      expect(normalizeRetryStatusRules(undefined)).toEqual([]);
      expect(normalizeRetryStatusRules(null)).toEqual([]);
    });
  });
});
