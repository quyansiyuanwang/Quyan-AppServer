import { describe, expect, it } from "vitest";
import {
  extractTokenUsageMetrics,
  hasTokenValue,
  normalizeTokenBreakdown,
  parseNumericTokenValue,
} from "@/util/token-usage.util";

describe("token-usage util", () => {
  describe("parseNumericTokenValue", () => {
    it("parses finite numbers and numeric strings", () => {
      expect(parseNumericTokenValue(12)).toBe(12);
      expect(parseNumericTokenValue("34")).toBe(34);
      expect(parseNumericTokenValue(" 5 ")).toBe(5);
    });

    it("returns 0 for invalid values", () => {
      expect(parseNumericTokenValue(undefined)).toBe(0);
      expect(parseNumericTokenValue(null)).toBe(0);
      expect(parseNumericTokenValue("")).toBe(0);
      expect(parseNumericTokenValue("abc")).toBe(0);
      expect(parseNumericTokenValue(Number.POSITIVE_INFINITY)).toBe(0);
      expect(parseNumericTokenValue(Number.NaN)).toBe(0);
    });
  });

  describe("hasTokenValue", () => {
    it("identifies numeric-like values", () => {
      expect(hasTokenValue(0)).toBe(true);
      expect(hasTokenValue("0")).toBe(true);
      expect(hasTokenValue(" 12 ")).toBe(true);
    });

    it("rejects empty or invalid values", () => {
      expect(hasTokenValue(undefined)).toBe(false);
      expect(hasTokenValue(null)).toBe(false);
      expect(hasTokenValue("")).toBe(false);
      expect(hasTokenValue("   ")).toBe(false);
      expect(hasTokenValue("abc")).toBe(false);
    });
  });

  describe("normalizeTokenBreakdown", () => {
    it("derives missing output from total - input", () => {
      expect(normalizeTokenBreakdown(30, 0, 100)).toEqual({
        inputTokens: 30,
        outputTokens: 70,
        requestTokens: 30,
        responseTokens: 70,
        totalTokens: 100,
      });
    });

    it("derives missing input from total - output", () => {
      expect(normalizeTokenBreakdown(0, 60, 100)).toEqual({
        inputTokens: 40,
        outputTokens: 60,
        requestTokens: 40,
        responseTokens: 60,
        totalTokens: 100,
      });
    });

    it("uses fallback input when only total is provided", () => {
      expect(normalizeTokenBreakdown(0, 0, 120, 40)).toEqual({
        inputTokens: 40,
        outputTokens: 80,
        requestTokens: 40,
        responseTokens: 80,
        totalTokens: 120,
      });
    });

    it("uses input + output when total is absent", () => {
      expect(normalizeTokenBreakdown(10, 20, 0)).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        requestTokens: 10,
        responseTokens: 20,
        totalTokens: 30,
      });
    });
  });

  describe("extractTokenUsageMetrics", () => {
    it("extracts and normalizes openai-style usage", () => {
      const usage = {
        prompt_tokens: 80,
        completion_tokens: 20,
        total_tokens: 100,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 7,
      };

      expect(extractTokenUsageMetrics(usage)).toEqual({
        inputTokens: 80,
        outputTokens: 20,
        requestTokens: 80,
        responseTokens: 20,
        totalTokens: 100,
        cacheCreationTokens: 5,
        cacheReadTokens: 7,
      });
    });

    it("derives missing input/output from total", () => {
      const usage = {
        output_tokens: 40,
        total_tokens: 100,
      };

      expect(extractTokenUsageMetrics(usage)).toEqual({
        inputTokens: 60,
        outputTokens: 40,
        requestTokens: 60,
        responseTokens: 40,
        totalTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
    });

    it("does not include cache tokens in total", () => {
      const usage = {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 50,
      };

      expect(extractTokenUsageMetrics(usage)).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        requestTokens: 10,
        responseTokens: 20,
        totalTokens: 30,
        cacheCreationTokens: 0,
        cacheReadTokens: 50,
      });
    });

    it("deduplicates cache creation aliases to avoid double counting", () => {
      const usage = {
        prompt_tokens: 80,
        completion_tokens: 20,
        total_tokens: 100,
        cache_creation_input_tokens: 64,
        cache_creation: {
          ephemeral_5m_input_tokens: 64,
        },
      };

      expect(extractTokenUsageMetrics(usage)).toEqual({
        inputTokens: 80,
        outputTokens: 20,
        requestTokens: 80,
        responseTokens: 20,
        totalTokens: 100,
        cacheCreationTokens: 64,
        cacheReadTokens: 0,
      });
    });

    it("deduplicates cache read aliases to avoid double counting", () => {
      const usage = {
        prompt_tokens: 50,
        completion_tokens: 50,
        total_tokens: 100,
        cache_read_input_tokens: 32,
        prompt_tokens_details: {
          cached_tokens: 32,
        },
        cached_tokens: 32,
        cache_read: {
          ephemeral_5m_input_tokens: 32,
        },
      };

      expect(extractTokenUsageMetrics(usage)).toEqual({
        inputTokens: 50,
        outputTokens: 50,
        requestTokens: 50,
        responseTokens: 50,
        totalTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 32,
      });
    });

    it("sums cache bucket windows when only split fields are provided", () => {
      const usage = {
        input_tokens: 40,
        output_tokens: 10,
        cache_creation: {
          ephemeral_5m_input_tokens: 12,
          ephemeral_1h_input_tokens: 8,
        },
      };

      expect(extractTokenUsageMetrics(usage)).toEqual({
        inputTokens: 40,
        outputTokens: 10,
        requestTokens: 40,
        responseTokens: 10,
        totalTokens: 50,
        cacheCreationTokens: 20,
        cacheReadTokens: 0,
      });
    });

    it("returns zero metrics for invalid usage payload", () => {
      expect(extractTokenUsageMetrics(undefined)).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });

      expect(extractTokenUsageMetrics("not-an-object")).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
    });
  });
});
