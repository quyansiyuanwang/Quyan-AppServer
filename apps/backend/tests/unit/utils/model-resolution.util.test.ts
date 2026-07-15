import { describe, expect, it } from "vitest";
import {
  isModelIdAllowed,
  isModelNameAllowed,
  normalizeAllowedModelEntriesToModelNames,
  parseAllowedModelsJson,
  parseRelayModelNameConstraint,
  resolveModelId,
} from "@/util/model-resolution.util";

describe("model-resolution util", () => {
  describe("resolveModelId", () => {
    it("prefers provider as model ID", () => {
      expect(resolveModelId({ model: "gpt-4o", provider: "upstream-gpt-4o" })).toBe("upstream-gpt-4o");
    });

    it("falls back to model when provider is empty", () => {
      expect(resolveModelId({ model: "gpt-4o", provider: "   " })).toBe("gpt-4o");
    });

    it("returns empty string when both are missing", () => {
      expect(resolveModelId({})).toBe("");
    });

    it("handles null provider and falls back to model", () => {
      expect(resolveModelId({ model: "gpt-4o", provider: null })).toBe("gpt-4o");
    });

    it("handles null model and uses provider", () => {
      expect(resolveModelId({ model: null, provider: "upstream-gpt-4o" })).toBe("upstream-gpt-4o");
    });

    it("returns empty string when both are null", () => {
      expect(resolveModelId({ model: null, provider: null })).toBe("");
    });

    it("trims whitespace from provider", () => {
      expect(resolveModelId({ model: "gpt-4o", provider: "  upstream-gpt-4o  " })).toBe("upstream-gpt-4o");
    });

    it("trims whitespace from model when provider is absent", () => {
      expect(resolveModelId({ model: "  gpt-4o  ", provider: "" })).toBe("gpt-4o");
    });

    it("handles empty string provider and falls back to model", () => {
      expect(resolveModelId({ model: "gpt-4o", provider: "" })).toBe("gpt-4o");
    });

    it("handles empty string model and empty provider", () => {
      expect(resolveModelId({ model: "", provider: "" })).toBe("");
    });
  });

  describe("parseAllowedModelsJson", () => {
    it("parses and trims allowed model entries", () => {
      const parsed = parseAllowedModelsJson('[" gpt-4o ", "", 123, null]');
      expect(parsed).toEqual(["gpt-4o", "123"]);
    });

    it("returns null for invalid JSON", () => {
      expect(parseAllowedModelsJson("not-json")).toBeNull();
    });

    it("returns null when payload is not an array", () => {
      expect(parseAllowedModelsJson('{"model":"gpt-4o"}')).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(parseAllowedModelsJson(undefined)).toBeNull();
      expect(parseAllowedModelsJson(null)).toBeNull();
      expect(parseAllowedModelsJson("")).toBeNull();
    });

    it("filters out empty strings after trimming", () => {
      const parsed = parseAllowedModelsJson('["gpt-4o", "   ", "", "claude-3"]');
      expect(parsed).toEqual(["gpt-4o", "claude-3"]);
    });

    it("handles array with only empty/null values", () => {
      const parsed = parseAllowedModelsJson('[null, "", "   ", null]');
      expect(parsed).toEqual([]);
    });

    it("converts non-string values to strings", () => {
      const parsed = parseAllowedModelsJson("[123, true, false, 456.78]");
      expect(parsed).toEqual(["123", "true", "false", "456.78"]);
    });

    it("handles nested arrays by converting to string", () => {
      const parsed = parseAllowedModelsJson('[["nested"], "gpt-4o"]');
      expect(parsed).toEqual(["nested", "gpt-4o"]);
    });

    it("handles objects by converting to string", () => {
      const parsed = parseAllowedModelsJson('[{"key":"value"}, "gpt-4o"]');
      expect(parsed).toEqual(["[object Object]", "gpt-4o"]);
    });

    it("returns null for JSON number", () => {
      expect(parseAllowedModelsJson("123")).toBeNull();
    });

    it("returns null for JSON string", () => {
      expect(parseAllowedModelsJson('"string"')).toBeNull();
    });

    it("returns null for JSON boolean", () => {
      expect(parseAllowedModelsJson("true")).toBeNull();
    });

    it("handles empty array", () => {
      const parsed = parseAllowedModelsJson("[]");
      expect(parsed).toEqual([]);
    });

    it("handles malformed JSON with trailing comma", () => {
      expect(parseAllowedModelsJson('["gpt-4o",]')).toBeNull();
    });
  });

  describe("parseRelayModelNameConstraint", () => {
    it("distinguishes unrestricted, explicit empty, and malformed values", () => {
      expect(parseRelayModelNameConstraint(null)).toEqual({ kind: "unrestricted" });
      expect(parseRelayModelNameConstraint(" ")).toEqual({ kind: "unrestricted" });
      expect(parseRelayModelNameConstraint("[]")).toEqual({ kind: "restricted", values: [] });
      expect(parseRelayModelNameConstraint('[" catalog-a "]')).toEqual({
        kind: "restricted",
        values: ["catalog-a"],
      });
      expect(parseRelayModelNameConstraint("invalid")).toEqual({ kind: "malformed" });
      expect(parseRelayModelNameConstraint("{}")).toEqual({ kind: "malformed" });
    });
  });

  describe("isModelNameAllowed", () => {
    it("allows all when allowlist is null", () => {
      expect(isModelNameAllowed(null, "gpt-5.4-.1C")).toBe(true);
    });

    it("matches by normalized model name", () => {
      expect(isModelNameAllowed([" gpt-5.4-.1C "], "gpt-5.4-.1C")).toBe(true);
    });

    it("does not treat modelId/provider as model name", () => {
      expect(isModelNameAllowed(["gpt-5.4"], "gpt-5.4-.1C")).toBe(false);
    });

    it("allows all when allowlist is undefined", () => {
      expect(isModelNameAllowed(undefined, "gpt-4o")).toBe(true);
    });

    it("rejects empty model name", () => {
      expect(isModelNameAllowed(["gpt-4o"], "")).toBe(false);
    });

    it("rejects null model name", () => {
      expect(isModelNameAllowed(["gpt-4o"], null as any)).toBe(false);
    });

    it("rejects whitespace-only model name", () => {
      expect(isModelNameAllowed(["gpt-4o"], "   ")).toBe(false);
    });

    it("handles empty allowlist array", () => {
      expect(isModelNameAllowed([], "gpt-4o")).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(isModelNameAllowed(["GPT-4O"], "gpt-4o")).toBe(false);
    });

    it("handles special characters in model name", () => {
      expect(isModelNameAllowed(["gpt-4o-2024-05-13"], "gpt-4o-2024-05-13")).toBe(true);
    });

    it("handles multiple entries in allowlist", () => {
      expect(isModelNameAllowed(["gpt-4o", "claude-3", "gemini-pro"], "claude-3")).toBe(true);
    });

    it("trims whitespace from allowlist entries", () => {
      expect(isModelNameAllowed(["  gpt-4o  ", " claude-3 "], "gpt-4o")).toBe(true);
    });
  });

  describe("isModelIdAllowed", () => {
    it("allows all when allowlist is null", () => {
      expect(isModelIdAllowed(null, { model: "gpt-4o", provider: "upstream-gpt-4o" })).toBe(true);
    });

    it("allows all when allowlist is undefined", () => {
      expect(isModelIdAllowed(undefined, { model: "gpt-4o", provider: "upstream-gpt-4o" })).toBe(true);
    });

    it("matches by provider (model ID) when present", () => {
      expect(isModelIdAllowed(["upstream-gpt-4o"], { model: "gpt-4o", provider: "upstream-gpt-4o" })).toBe(true);
    });

    it("falls back to model name when provider is empty", () => {
      expect(isModelIdAllowed(["gpt-4o"], { model: "gpt-4o", provider: "" })).toBe(true);
    });

    it("rejects when model ID not in allowlist", () => {
      expect(isModelIdAllowed(["claude-3-opus"], { model: "gpt-4o", provider: "upstream-gpt-4o" })).toBe(false);
    });

    it("normalizes whitespace in allowlist entries", () => {
      expect(isModelIdAllowed([" upstream-gpt-4o "], { model: "gpt-4o", provider: "upstream-gpt-4o" })).toBe(true);
    });

    it("rejects empty model ID", () => {
      expect(isModelIdAllowed(["gpt-4o"], { model: "", provider: "" })).toBe(false);
    });

    it("handles multiple entries in allowlist", () => {
      const allowlist = ["claude-3-opus", "upstream-gpt-4o", "gemini-pro"];
      expect(isModelIdAllowed(allowlist, { model: "gpt-4o", provider: "upstream-gpt-4o" })).toBe(true);
      expect(isModelIdAllowed(allowlist, { model: "claude", provider: "claude-3-opus" })).toBe(true);
      expect(isModelIdAllowed(allowlist, { model: "gpt-3.5", provider: "gpt-3.5-turbo" })).toBe(false);
    });

    it("handles null provider and falls back to model", () => {
      expect(isModelIdAllowed(["gpt-4o"], { model: "gpt-4o", provider: null })).toBe(true);
    });

    it("handles null model with valid provider", () => {
      expect(isModelIdAllowed(["upstream-gpt-4o"], { model: null, provider: "upstream-gpt-4o" })).toBe(true);
    });

    it("rejects when both model and provider are null", () => {
      expect(isModelIdAllowed(["gpt-4o"], { model: null, provider: null })).toBe(false);
    });

    it("handles whitespace-only provider", () => {
      expect(isModelIdAllowed(["gpt-4o"], { model: "gpt-4o", provider: "   " })).toBe(true);
    });

    it("handles empty allowlist array", () => {
      expect(isModelIdAllowed([], { model: "gpt-4o", provider: "upstream-gpt-4o" })).toBe(false);
    });

    it("is case-sensitive for model IDs", () => {
      expect(isModelIdAllowed(["UPSTREAM-GPT-4O"], { model: "gpt-4o", provider: "upstream-gpt-4o" })).toBe(false);
    });

    it("handles special characters in model ID", () => {
      expect(isModelIdAllowed(["gpt-4o-2024-05-13"], { model: "gpt-4o", provider: "gpt-4o-2024-05-13" })).toBe(true);
    });

    it("trims whitespace from model config values", () => {
      expect(isModelIdAllowed(["upstream-gpt-4o"], { model: "  gpt-4o  ", provider: "  upstream-gpt-4o  " })).toBe(
        true,
      );
    });
  });

  describe("normalizeAllowedModelEntriesToModelNames", () => {
    it("keeps direct model-name entries unchanged", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["gpt-5.4-.1C"],
        [{ model: "gpt-5.4-.1C", provider: "gpt-5.4" }],
      );

      expect(normalized).toEqual(["gpt-5.4-.1C"]);
    });

    it("maps unique modelId entries to model names", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["gpt-5.4"],
        [{ model: "gpt-5.4-.1C", provider: "gpt-5.4" }],
      );

      expect(normalized).toEqual(["gpt-5.4-.1C"]);
    });

    it("does not remap ambiguous modelId entries", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["gpt-5.4"],
        [
          { model: "gpt-5.4-.1C", provider: "gpt-5.4" },
          { model: "gpt-5.4-fast", provider: "gpt-5.4" },
        ],
      );

      expect(normalized).toEqual(["gpt-5.4"]);
    });

    it("returns null when input is null", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(null, [{ model: "gpt-4o", provider: "upstream" }]);
      expect(normalized).toBeNull();
    });

    it("returns undefined when input is undefined", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(undefined, [
        { model: "gpt-4o", provider: "upstream" },
      ]);
      expect(normalized).toBeUndefined();
    });

    it("handles empty allowlist array", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames([], [{ model: "gpt-4o", provider: "upstream" }]);
      expect(normalized).toEqual([]);
    });

    it("handles empty model catalog", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(["gpt-4o"], []);
      expect(normalized).toEqual(["gpt-4o"]);
    });

    it("filters out empty entries from allowlist", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["gpt-4o", "", "   ", "claude-3"],
        [
          { model: "gpt-4o", provider: "upstream-gpt-4o" },
          { model: "claude-3", provider: "upstream-claude-3" },
        ],
      );
      expect(normalized).toEqual(["gpt-4o", "claude-3"]);
    });

    it("deduplicates entries after normalization", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["upstream-gpt-4o", "gpt-4o"],
        [{ model: "gpt-4o", provider: "upstream-gpt-4o" }],
      );
      expect(normalized).toEqual(["gpt-4o"]);
    });

    it("handles model without provider (modelId equals model name)", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(["gpt-4o"], [{ model: "gpt-4o", provider: null }]);
      expect(normalized).toEqual(["gpt-4o"]);
    });

    it("handles catalog entries with empty model names", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["upstream-gpt-4o"],
        [
          { model: "", provider: "upstream-gpt-4o" },
          { model: "gpt-4o", provider: "upstream-gpt-4o" },
        ],
      );
      expect(normalized).toEqual(["gpt-4o"]);
    });

    it("handles catalog entries with null model names", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["upstream-gpt-4o"],
        [
          { model: null, provider: "upstream-gpt-4o" },
          { model: "gpt-4o", provider: "upstream-gpt-4o" },
        ],
      );
      expect(normalized).toEqual(["gpt-4o"]);
    });

    it("preserves order of entries", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["claude-3", "gpt-4o", "gemini-pro"],
        [
          { model: "claude-3", provider: "upstream-claude" },
          { model: "gpt-4o", provider: "upstream-gpt" },
          { model: "gemini-pro", provider: "upstream-gemini" },
        ],
      );
      expect(normalized).toEqual(["claude-3", "gpt-4o", "gemini-pro"]);
    });

    it("handles mixed direct names and model IDs", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["gpt-4o", "upstream-claude"],
        [
          { model: "gpt-4o", provider: "upstream-gpt" },
          { model: "claude-3", provider: "upstream-claude" },
        ],
      );
      expect(normalized).toEqual(["gpt-4o", "claude-3"]);
    });

    it("handles three models sharing same provider (ambiguous)", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["shared-provider"],
        [
          { model: "model-a", provider: "shared-provider" },
          { model: "model-b", provider: "shared-provider" },
          { model: "model-c", provider: "shared-provider" },
        ],
      );
      expect(normalized).toEqual(["shared-provider"]);
    });

    it("handles whitespace in allowlist entries", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["  gpt-4o  ", " upstream-claude "],
        [
          { model: "gpt-4o", provider: "upstream-gpt" },
          { model: "claude-3", provider: "upstream-claude" },
        ],
      );
      expect(normalized).toEqual(["gpt-4o", "claude-3"]);
    });

    it("handles whitespace in catalog entries", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["upstream-gpt"],
        [{ model: "  gpt-4o  ", provider: "  upstream-gpt  " }],
      );
      expect(normalized).toEqual(["gpt-4o"]);
    });

    it("handles case where modelId equals model name (no provider)", () => {
      const normalized = normalizeAllowedModelEntriesToModelNames(
        ["gpt-4o"],
        [{ model: "gpt-4o", provider: "gpt-4o" }],
      );
      expect(normalized).toEqual(["gpt-4o"]);
    });
  });
});
