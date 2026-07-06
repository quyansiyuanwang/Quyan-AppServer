import { describe, it, expect } from "vitest";
import { isModelNameAllowed } from "@/util/model-resolution.util";
import {
  parseRelayChannelAllowedModelNames,
  parseRelayTokenAllowedModelIds,
  getAccessibleRelayModelConfigsForToken,
} from "@/util/relay-model-availability.util";

describe("Model ID + Channel -> Model Config Logic", () => {
  describe("isModelNameAllowed", () => {
    it("should allow model when model name is in the list", () => {
      const allowedModels = ["gpt-5.4-.1C", "gpt-5.3-codex-.1C"];
      expect(isModelNameAllowed(allowedModels, "gpt-5.4-.1C")).toBe(true);
      expect(isModelNameAllowed(allowedModels, "gpt-5.3-codex-.1C")).toBe(true);
    });

    it("should reject model when model name is not in the list", () => {
      const allowedModels = ["gpt-5.4-.1C", "gpt-5.3-codex-.1C"];
      expect(isModelNameAllowed(allowedModels, "gpt-image-2")).toBe(false);
      expect(isModelNameAllowed(allowedModels, "claude-3")).toBe(false);
    });

    it("should allow all models when list is null or empty", () => {
      expect(isModelNameAllowed(null, "any-model")).toBe(true);
      expect(isModelNameAllowed(undefined, "any-model")).toBe(true);
      expect(isModelNameAllowed([], "any-model")).toBe(false);
    });

    it("should handle whitespace in model names", () => {
      const allowedModels = [" gpt-5.4-.1C ", "gpt-5.3-codex-.1C"];
      expect(isModelNameAllowed(allowedModels, "gpt-5.4-.1C")).toBe(true);
      expect(isModelNameAllowed(allowedModels, " gpt-5.4-.1C ")).toBe(true);
    });
  });

  describe("parseRelayChannelAllowedModelNames", () => {
    it("should parse JSON array of model names", () => {
      const channel = {
        allowedModels: '["gpt-5.4-.1C", "gpt-5.3-codex-.1C"]',
      };
      const result = parseRelayChannelAllowedModelNames(channel, []);
      expect(result).toEqual(["gpt-5.4-.1C", "gpt-5.3-codex-.1C"]);
    });

    it("should return null when allowedModels is not set", () => {
      const channel = { allowedModels: null };
      const result = parseRelayChannelAllowedModelNames(channel, []);
      expect(result).toBeNull();
    });

    it("should return null when allowedModels is invalid JSON", () => {
      const channel = { allowedModels: "invalid-json" };
      const result = parseRelayChannelAllowedModelNames(channel, []);
      expect(result).toBeNull();
    });

    it("should trim whitespace from model names", () => {
      const channel = {
        allowedModels: '["  gpt-5.4-.1C  ", "gpt-5.3-codex-.1C"]',
      };
      const result = parseRelayChannelAllowedModelNames(channel, []);
      expect(result).toEqual(["gpt-5.4-.1C", "gpt-5.3-codex-.1C"]);
    });
  });

  describe("parseRelayTokenAllowedModelIds", () => {
    it("should parse comma-separated model IDs", () => {
      const result = parseRelayTokenAllowedModelIds("gpt-5.4,gpt-5.3-codex");
      expect(result).toEqual(["gpt-5.4", "gpt-5.3-codex"]);
    });

    it("should return empty array when allowedModels is not set", () => {
      expect(parseRelayTokenAllowedModelIds(null)).toEqual([]);
      expect(parseRelayTokenAllowedModelIds(undefined)).toEqual([]);
      expect(parseRelayTokenAllowedModelIds("")).toEqual([]);
    });

    it("should trim whitespace from model IDs", () => {
      const result = parseRelayTokenAllowedModelIds("  gpt-5.4  , gpt-5.3-codex ");
      expect(result).toEqual(["gpt-5.4", "gpt-5.3-codex"]);
    });

    it("should filter out empty entries", () => {
      const result = parseRelayTokenAllowedModelIds("gpt-5.4,,gpt-5.3-codex,");
      expect(result).toEqual(["gpt-5.4", "gpt-5.3-codex"]);
    });
  });

  describe("getAccessibleRelayModelConfigsForToken - Multiple models with same ID", () => {
    it("should filter by model name when channel has allowedModels", () => {
      const modelCatalog = [
        {
          model: "gpt-5.4-premium",
          provider: "gpt-5.4",
          supportedFormats: "openai",
          inputPrice: 10,
          outputPrice: 20,
        },
        {
          model: "gpt-5.4-standard",
          provider: "gpt-5.4",
          supportedFormats: "openai",
          inputPrice: 8,
          outputPrice: 15,
        },
        {
          model: "gpt-5.3-codex-.1C",
          provider: "gpt-5.3-codex",
          supportedFormats: "openai",
          inputPrice: 12,
          outputPrice: 24,
        },
      ];

      const relayToken = {
        allowedModels: null, // Token allows all models
        channel: {
          id: "channel-1",
          status: 1,
          allowedFormats: "openai",
          allowedModels: '["gpt-5.4-premium", "gpt-5.3-codex-.1C"]', // Channel only allows premium
        },
      };

      const result = getAccessibleRelayModelConfigsForToken(relayToken, modelCatalog, "openai");

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.model)).toEqual(["gpt-5.4-premium", "gpt-5.3-codex-.1C"]);
      expect(result.find((m) => m.model === "gpt-5.4-standard")).toBeUndefined();
    });

    it("should deduplicate by model ID after filtering", () => {
      const modelCatalog = [
        {
          model: "gpt-5.4-premium",
          provider: "gpt-5.4",
          supportedFormats: "openai",
          inputPrice: 10,
          outputPrice: 20,
        },
        {
          model: "gpt-5.4-standard",
          provider: "gpt-5.4",
          supportedFormats: "openai",
          inputPrice: 8,
          outputPrice: 15,
        },
      ];

      const relayToken = {
        allowedModels: null,
        channel: {
          id: "channel-1",
          status: 1,
          allowedFormats: "openai",
          allowedModels: '["gpt-5.4-premium", "gpt-5.4-standard"]', // Both allowed
        },
      };

      const result = getAccessibleRelayModelConfigsForToken(relayToken, modelCatalog, "openai");

      // Should deduplicate by model ID, keeping the last one (Map behavior)
      expect(result).toHaveLength(1);
      expect(result[0].model).toBe("gpt-5.4-standard");
      expect(result[0].provider).toBe("gpt-5.4");
    });

    it("should apply token restrictions on top of channel restrictions", () => {
      const modelCatalog = [
        {
          model: "gpt-5.4-premium",
          provider: "gpt-5.4",
          supportedFormats: "openai",
          inputPrice: 10,
          outputPrice: 20,
        },
        {
          model: "gpt-5.3-codex-.1C",
          provider: "gpt-5.3-codex",
          supportedFormats: "openai",
          inputPrice: 12,
          outputPrice: 24,
        },
        {
          model: "gpt-image-2",
          provider: "gpt-image-2",
          supportedFormats: "openai",
          inputPrice: 5,
          outputPrice: 10,
        },
      ];

      const relayToken = {
        allowedModels: "gpt-5.4,gpt-image-2", // Token only allows these two model IDs
        channel: {
          id: "channel-1",
          status: 1,
          allowedFormats: "openai",
          allowedModels: '["gpt-5.4-premium", "gpt-5.3-codex-.1C"]', // Channel allows these two model names
        },
      };

      const result = getAccessibleRelayModelConfigsForToken(relayToken, modelCatalog, "openai");

      // Only gpt-5.4-premium is in both channel (by name) and token (by ID) allowedModels
      expect(result).toHaveLength(1);
      expect(result[0].model).toBe("gpt-5.4-premium");
    });
  });
});
