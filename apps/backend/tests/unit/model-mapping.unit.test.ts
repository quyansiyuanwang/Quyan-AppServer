import { describe, expect, it } from "vitest";
import { matchesModelPattern, resolveMappedModel } from "../../src/util/model-mapping.util";

describe("matchesModelPattern", () => {
  it("matches exact pattern without wildcards", () => {
    expect(matchesModelPattern("gpt-4o", "gpt-4o")).toBe(true);
    expect(matchesModelPattern("gpt-4o", "gpt-4")).toBe(false);
  });

  it("matches * wildcard (any sequence)", () => {
    expect(matchesModelPattern("gpt-4o", "gpt-*")).toBe(true);
    expect(matchesModelPattern("gpt-4o-mini", "gpt-*")).toBe(true);
    expect(matchesModelPattern("claude-3-opus", "gpt-*")).toBe(false);
  });

  it("matches leading * wildcard", () => {
    expect(matchesModelPattern("deepseek-chat", "*-chat")).toBe(true);
    expect(matchesModelPattern("deepseek-reasoner", "*-chat")).toBe(false);
  });

  it("matches trailing * wildcard", () => {
    expect(matchesModelPattern("gpt-4o", "gpt*")).toBe(true);
    expect(matchesModelPattern("gpt-4o-mini", "gpt*")).toBe(true);
  });

  it("matches * in the middle", () => {
    expect(matchesModelPattern("gpt-4o-2024-05-13", "gpt-*-2024-*")).toBe(true);
    expect(matchesModelPattern("gpt-4o-2024-05-13", "gpt-*-2023-*")).toBe(false);
  });

  it("matches ? wildcard (single character)", () => {
    expect(matchesModelPattern("claude-3", "claude-?")).toBe(true);
    expect(matchesModelPattern("gpt-4o", "gpt-?")).toBe(false);
    expect(matchesModelPattern("claude-3-opus", "claude-?")).toBe(false);
  });

  it("matches multiple ? wildcards", () => {
    expect(matchesModelPattern("abc123", "???123")).toBe(true);
    expect(matchesModelPattern("ab123", "???123")).toBe(false);
    expect(matchesModelPattern("abcd123", "???123")).toBe(false);
  });

  it("escapes special regex characters in the pattern", () => {
    expect(matchesModelPattern("gpt-4o", "gpt-4.")).toBe(false);
    expect(matchesModelPattern("gpt-4o", "gpt-4o")).toBe(true);
    // Dot should be treated literally, not as regex "any char"
    expect(matchesModelPattern("gpt-4X", "gpt-4.")).toBe(false);
    expect(matchesModelPattern("gpt-4.", "gpt-4.")).toBe(true);
  });

  it("handles combined * and ? wildcards", () => {
    expect(matchesModelPattern("gpt-4o-2024", "gpt-*-?*")).toBe(true);
    expect(matchesModelPattern("gpt-4o-2024", "gpt-?o-*")).toBe(true);
    expect(matchesModelPattern("gpt-4-xyz", "gpt-?-*")).toBe(true);
    expect(matchesModelPattern("gpt--xyz", "gpt-?-*")).toBe(false);
  });
});

describe("resolveMappedModel", () => {
  it("returns original model when no mapping is provided", () => {
    expect(resolveMappedModel("gpt-4o", null, null)).toBe("gpt-4o");
    expect(resolveMappedModel("gpt-4o", undefined, undefined)).toBe("gpt-4o");
    expect(resolveMappedModel("gpt-4o", {}, {})).toBe("gpt-4o");
  });

  it("returns mapped model when token mapping has exact match", () => {
    const tokenMapping = { "gpt-4o": "deepseek-v4-flash" };
    expect(resolveMappedModel("gpt-4o", null, tokenMapping)).toBe("deepseek-v4-flash");
  });

  it("returns mapped model when channel mapping has exact match", () => {
    const channelMapping = { "gpt-4o": "deepseek-v4-flash" };
    expect(resolveMappedModel("gpt-4o", channelMapping, null)).toBe("deepseek-v4-flash");
  });

  it("token mapping takes priority over channel mapping", () => {
    const channelMapping = { "gpt-4o": "claude-opus" };
    const tokenMapping = { "gpt-4o": "deepseek-v4-flash" };
    expect(resolveMappedModel("gpt-4o", channelMapping, tokenMapping)).toBe("deepseek-v4-flash");
  });

  it("falls back to channel mapping when token has no match", () => {
    const channelMapping = { "gpt-4o": "deepseek-v4-flash" };
    const tokenMapping = { "other-model": "claude-opus" };
    expect(resolveMappedModel("gpt-4o", channelMapping, tokenMapping)).toBe("deepseek-v4-flash");
  });

  it("token wildcard match takes priority over channel exact match", () => {
    const channelMapping = { "gpt-4o": "claude-opus" };
    const tokenMapping = { "gpt-*": "deepseek-v4-flash" };
    expect(resolveMappedModel("gpt-4o", channelMapping, tokenMapping)).toBe("deepseek-v4-flash");
  });

  it("wildcard match in channel mapping works as fallback", () => {
    const channelMapping = { "gpt-*": "deepseek-v4-flash" };
    expect(resolveMappedModel("gpt-4o", channelMapping, null)).toBe("deepseek-v4-flash");
    expect(resolveMappedModel("gpt-4o-mini", channelMapping, null)).toBe("deepseek-v4-flash");
  });

  it("? wildcard match in channel mapping", () => {
    const channelMapping = { "claude-?": "claude-haiku" };
    expect(resolveMappedModel("claude-3", channelMapping, null)).toBe("claude-haiku");
    expect(resolveMappedModel("claude-3-opus", channelMapping, null)).toBe("claude-3-opus"); // too long for ?
  });

  it("returns original model when neither mapping matches", () => {
    const channelMapping = { "other-*": "some-model" };
    const tokenMapping = { "another-?": "other-model" };
    expect(resolveMappedModel("gpt-4o", channelMapping, tokenMapping)).toBe("gpt-4o");
  });

  it("exact match takes priority over wildcard match", () => {
    const mapping = {
      "gpt-*": "deepseek-v4-flash",
      "gpt-4o": "claude-opus",
    };
    // Object insertion order: gpt-* first, but exact match check happens before wildcard iteration
    expect(resolveMappedModel("gpt-4o", mapping, null)).toBe("claude-opus");
  });

  it("handles empty mappings gracefully", () => {
    expect(resolveMappedModel("gpt-4o", {}, {})).toBe("gpt-4o");
    expect(resolveMappedModel("gpt-4o", { "some-model": "other" }, {})).toBe("gpt-4o");
    expect(resolveMappedModel("gpt-4o", {}, { "some-model": "other" })).toBe("gpt-4o");
  });

  it("token no match + channel no match → passthrough", () => {
    expect(resolveMappedModel("unknown-model", { "gpt-*": "mapped" }, { "claude-*": "mapped" })).toBe("unknown-model");
  });

  it("wildcard * matches everything when pattern is just *", () => {
    const mapping = { "*": "deepseek-v4-flash" };
    expect(resolveMappedModel("gpt-4o", mapping, null)).toBe("deepseek-v4-flash");
    expect(resolveMappedModel("claude-3-opus", mapping, null)).toBe("deepseek-v4-flash");
    expect(resolveMappedModel("anything-123", mapping, null)).toBe("deepseek-v4-flash");
  });

  it("more specific wildcard wins over less specific — longer literal prefix", () => {
    // 123* and 123123* both match 123123123; 123123* is more specific
    const mapping = { "123*": "generic", "123123*": "specific" };
    expect(resolveMappedModel("123123123", mapping, null)).toBe("specific");
  });

  it("more specific wildcard wins — longer literal segment", () => {
    const mapping = { "gpt-*": "generic-gpt", "gpt-4*": "gpt4-specific" };
    expect(resolveMappedModel("gpt-4o", mapping, null)).toBe("gpt4-specific");
  });

  it("more specific wildcard can appear before less specific in insertion order", () => {
    // gpt-* appears first but is less specific; gpt-4* should still win
    const mapping = { "gpt-*": "generic-gpt", "gpt-4*": "gpt4-specific" };
    expect(resolveMappedModel("gpt-4o-mini", mapping, null)).toBe("gpt4-specific");
  });

  it("same specificity preserves insertion order", () => {
    // Both have 6 literal chars (gpt--a vs gpt--b) — first in insertion order wins
    const mapping = { "gpt-*-a": "first", "gpt-*-b": "second" };
    expect(resolveMappedModel("gpt-4o-a", mapping, null)).toBe("first");
  });
});
