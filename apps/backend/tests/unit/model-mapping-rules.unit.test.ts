import { describe, expect, it } from "vitest";
import {
  RELAY_TOKEN_MODEL_MAPPING_LIMITS,
  analyzeRelayTokenModelMappingRules,
  doModelPatternsOverlap,
  getMatchingRelayTokenModelMappingRule,
  getMatchingRelayTokenModelMappingRules,
  getRelayTokenModelMappingTargetCandidates,
  normalizeRelayTokenModelMappingRules,
  selectRelayTokenModelMappingRule,
  validateRelayTokenModelMappingRules,
  type RelayTokenModelMappingRule,
} from "@quyan/shared";

function rule(
  source: string,
  target = "mapped-model",
  channelIds?: string[],
  preference: RelayTokenModelMappingRule["preference"] = "mapping-first",
): RelayTokenModelMappingRule {
  return { source, target, ...(channelIds === undefined ? {} : { channelIds }), preference };
}

describe("normalizeRelayTokenModelMappingRules", () => {
  it("converts legacy records and JSON, trimming names while preserving case and order", () => {
    const legacy = { "gpt-*": " mapped ", "GPT-4": "literal*target" };
    const expected = [rule("gpt-*", "mapped"), rule("GPT-4", "literal*target")];
    expect(normalizeRelayTokenModelMappingRules(legacy)).toEqual(expected);
    expect(normalizeRelayTokenModelMappingRules(JSON.stringify(legacy))).toEqual(expected);
    expect(normalizeRelayTokenModelMappingRules(undefined, legacy)).toEqual(expected);
    expect(normalizeRelayTokenModelMappingRules(null, JSON.stringify(legacy))).toEqual(expected);
    expect(normalizeRelayTokenModelMappingRules("null", legacy)).toEqual(expected);
  });

  it("discards malformed legacy entries without losing a valid trimmed alias", () => {
    const legacy = { bad: 10, empty: " ", good: " model-a ", " ": "model-a", " alias ": " model-b ", nil: null };
    const expected = [rule("good", "model-a"), rule("alias", "model-b")];
    expect(normalizeRelayTokenModelMappingRules(legacy)).toEqual(expected);
    expect(normalizeRelayTokenModelMappingRules(undefined, legacy)).toEqual(expected);
    expect(normalizeRelayTokenModelMappingRules(undefined, JSON.stringify(legacy))).toEqual(expected);
    expect(legacy.good).toBe(" model-a ");
  });

  it("keeps explicit arrays strict and preserves valid explicit literal whitespace", () => {
    const valid = rule(" alias ", " target ");
    expect(normalizeRelayTokenModelMappingRules([valid])).toEqual([valid]);
    expect(normalizeRelayTokenModelMappingRules([rule("bad", " "), rule("good", "target")])).toEqual([]);
    expect(normalizeRelayTokenModelMappingRules([{ ...rule("bad"), target: 10 }, rule("good", "target")])).toEqual([]);
  });

  it("lets explicit rules and explicit empty arrays override legacy", () => {
    const rules = [rule("gpt-*", "target", ["leaf"], "original-first")];
    expect(normalizeRelayTokenModelMappingRules(rules, { ignored: "legacy" })).toEqual(rules);
    expect(normalizeRelayTokenModelMappingRules(JSON.stringify(rules))).toEqual(rules);
    expect(normalizeRelayTokenModelMappingRules([], { ignored: "legacy" })).toEqual([]);
    expect(normalizeRelayTokenModelMappingRules("[]", { ignored: "legacy" })).toEqual([]);
    expect(normalizeRelayTokenModelMappingRules({}, { ignored: "legacy" })).toEqual([]);
  });

  it("copies rules and deduplicates channel IDs without mutating input", () => {
    const input = [rule("gpt-*", "target", ["root", "leaf", "root"])];
    Object.freeze(input[0].channelIds);
    Object.freeze(input[0]);
    Object.freeze(input);
    const output = normalizeRelayTokenModelMappingRules(input);
    expect(output).toEqual([rule("gpt-*", "target", ["root", "leaf"])]);
    expect(output[0]).not.toBe(input[0]);
    expect(output[0].channelIds).not.toBe(input[0].channelIds);
    expect(normalizeRelayTokenModelMappingRules([rule("gpt", "target", [])])).toEqual([rule("gpt", "target")]);
  });

  it.each([false, 1, "invalid-json", [null], [{ source: "gpt", target: "x" }], [rule("gpt", "x", [""])]])(
    "does not fall back to legacy or widen malformed rules: %j",
    (value) => {
      expect(normalizeRelayTokenModelMappingRules(value, { legacy: "target" })).toEqual([]);
    },
  );

  it("rejects sparse rules and channel arrays", () => {
    expect(validateRelayTokenModelMappingRules(new Array(1))).toMatchObject([{ code: "invalid-rule" }]);
    expect(normalizeRelayTokenModelMappingRules([rule("gpt", "target", new Array(1))])).toEqual([]);
    expect(normalizeRelayTokenModelMappingRules(undefined)).toEqual([]);
  });
});

describe("per-route rule priority", () => {
  it("ranks leaf wildcard before parent exact before global exact", () => {
    const global = rule("gpt-4", "global");
    const parent = rule("gpt-4", "parent", ["root"]);
    const leaf = rule("*", "leaf", ["leaf"]);
    const excluded = rule("gpt-4", "other", ["other"]);
    const rules = Object.freeze([global, parent, excluded, leaf]);
    expect(getMatchingRelayTokenModelMappingRules("gpt-4", rules, ["root", "leaf"])).toEqual([leaf, parent, global]);
    expect(selectRelayTokenModelMappingRule("gpt-4", rules, ["root", "leaf"])).toBe(leaf);
    expect(getMatchingRelayTokenModelMappingRule("gpt-4", rules, ["root"])).toBe(parent);
    expect(selectRelayTokenModelMappingRule("gpt-4", rules, [])).toBe(global);
    expect(rules).toEqual([global, parent, excluded, leaf]);
  });

  it("uses the deepest matching channel in each rule, regardless of channel ID order", () => {
    const parent = rule("gpt-4", "parent", ["middle"]);
    const multiple = rule("*", "deep", ["leaf", "root"]);
    expect(selectRelayTokenModelMappingRule("gpt-4", [parent, multiple], ["root", "middle", "leaf"])).toBe(multiple);
    expect(selectRelayTokenModelMappingRule("gpt-4", [parent, multiple], ["root", "middle"])).toBe(parent);
  });

  it("ranks exact, then literal specificity, then original order at the same depth", () => {
    const rules = [rule("g*"), rule("*4", "first-tie"), rule("gpt*"), rule("gpt-4"), rule("gpt-*"), rule("g*4")];
    expect(getMatchingRelayTokenModelMappingRules("gpt-4", rules).map(({ source }) => source)).toEqual([
      "gpt-4",
      "gpt-*",
      "gpt*",
      "g*4",
      "g*",
      "*4",
    ]);
    expect(selectRelayTokenModelMappingRule("ab", [rule("a*", "first"), rule("*b", "second")])?.target).toBe("first");
    expect(selectRelayTokenModelMappingRule("ab", [rule("*b", "second"), rule("a*", "first")])?.target).toBe("second");
  });

  it("treats empty scopes as global and returns undefined when nothing matches", () => {
    const global = rule("gpt-*", "global", []);
    expect(selectRelayTokenModelMappingRule("gpt-4", [global])).toBe(global);
    expect(selectRelayTokenModelMappingRule("GPT-4", [global])).toBeUndefined();
    expect(selectRelayTokenModelMappingRule("gpt-4", [rule("*", "x", ["other"])], ["leaf"])).toBeUndefined();
    expect(selectRelayTokenModelMappingRule("anything", [])).toBeUndefined();
  });
});

describe("target preference", () => {
  it("orders literal names for mapping-first and original-first, without checking availability", () => {
    expect(getRelayTokenModelMappingTargetCandidates("gpt-4", rule("gpt-*", "target*"))).toEqual(["target*", "gpt-4"]);
    expect(getRelayTokenModelMappingTargetCandidates("gpt-4", rule("gpt-*", "target", [], "original-first"))).toEqual([
      "gpt-4",
      "target",
    ]);
    expect(getRelayTokenModelMappingTargetCandidates("gpt-4", rule("*", "gpt-4"))).toEqual(["gpt-4"]);
    expect(getRelayTokenModelMappingTargetCandidates("gpt-4")).toEqual(["gpt-4"]);
    expect(getRelayTokenModelMappingTargetCandidates("gpt-4", null)).toEqual(["gpt-4"]);
  });
});

describe("doModelPatternsOverlap", () => {
  it.each([
    ["", "", true],
    ["", "*", true],
    ["", "?", false],
    ["gpt-*", "*-mini", true],
    ["ab*cd", "ab?*d", true],
    ["a*b", "b*a", false],
    ["a?c", "ab?", true],
    ["a?c", "a?d", false],
    ["gpt*", "claude*", false],
    ["a*b*c", "a*c*b", false],
    ["abc", "ab??", false],
    ["abc", "ab*", true],
    ["a.b", "a?b", true],
    ["a[b", "a?b", true],
    ["a[b", "a(b", false],
    ["\\*", "\\?", true],
    ["***a***?", "a*", true],
    ["GPT-*", "gpt-*", false],
    ["?", "😀", false],
    ["??", "😀", true],
    ["*", "\n", false],
    ["*\n", "?\n", true],
  ])("intersection of %j and %j is %j", (left, right, expected) => {
    expect(doModelPatternsOverlap(left, right)).toBe(expected);
    expect(doModelPatternsOverlap(right, left)).toBe(expected);
  });

  it("finds intersections requiring a long witness and handles repeated stars", () => {
    const prefix = "a".repeat(99);
    const suffix = "b".repeat(99);
    expect(doModelPatternsOverlap(`${prefix}*`, `*${suffix}`)).toBe(true);
    expect(doModelPatternsOverlap("*a".repeat(100), "*b".repeat(100))).toBe(false);
    expect(doModelPatternsOverlap("*".repeat(200), "?".repeat(200))).toBe(true);
  });
});

describe("mapping rule diagnostics and limits", () => {
  it("rejects duplicate global sources and overlapping scoped duplicate sources", () => {
    expect(validateRelayTokenModelMappingRules([rule("gpt"), rule("gpt", "other", [])])).toMatchObject([
      { ruleIndex: 1, otherRuleIndex: 0, severity: "error", code: "duplicate-source" },
    ]);
    expect(
      validateRelayTokenModelMappingRules([
        rule("gpt", "first", ["a", "b"]),
        rule("gpt", "second", ["b", "c"], "original-first"),
      ]),
    ).toMatchObject([{ ruleIndex: 1, otherRuleIndex: 0, code: "duplicate-source" }]);
  });

  it("allows duplicate sources with disjoint scopes or distinct route priorities", () => {
    const rules = [rule("gpt", "global"), rule("gpt", "a", ["a"]), rule("gpt", "b", ["b"])];
    expect(validateRelayTokenModelMappingRules(rules)).toEqual([]);
    expect(normalizeRelayTokenModelMappingRules(rules)).toEqual(rules);
    expect(selectRelayTokenModelMappingRule("gpt", rules, ["a", "b"])?.target).toBe("b");
  });

  it("warns for real intersections, allows them, and ignores disjoint scopes and languages", () => {
    const rules = [rule("a*"), rule("*b"), rule("z*z"), rule("c*", "x", ["a"]), rule("*d", "y", ["b"])];
    const diagnostics = analyzeRelayTokenModelMappingRules(rules);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        ruleIndex: 1,
        otherRuleIndex: 0,
        severity: "warning",
        code: "overlapping-patterns",
      }),
    );
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ ruleIndex: 2, otherRuleIndex: 0 }));
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ ruleIndex: 4, otherRuleIndex: 3 }));
    expect(validateRelayTokenModelMappingRules(rules)).toEqual([]);
    expect(normalizeRelayTokenModelMappingRules(rules)).toEqual(rules);
  });

  it("reports overlap even when the first shared model is longer than either source", () => {
    const diagnostics = analyzeRelayTokenModelMappingRules([rule(`${"a".repeat(99)}*`), rule(`*${"b".repeat(99)}`)]);
    expect(diagnostics).toMatchObject([{ severity: "warning", code: "overlapping-patterns" }]);
  });

  it("accepts each limit boundary and rejects one over", () => {
    const { maxRules, maxPatternLength, maxTargetLength, maxChannelIds } = RELAY_TOKEN_MODEL_MAPPING_LIMITS;
    expect(RELAY_TOKEN_MODEL_MAPPING_LIMITS).toEqual({
      maxRules: 100,
      maxPatternLength: 200,
      maxTargetLength: 200,
      maxChannelIds: 100,
    });
    const ids = Array.from({ length: maxChannelIds }, (_, index) => `channel-${index}`);
    const rules = Array.from({ length: maxRules }, (_, index) => rule(String(index)));
    expect(validateRelayTokenModelMappingRules(rules)).toEqual([]);
    expect(
      validateRelayTokenModelMappingRules([rule("a".repeat(maxPatternLength), "b".repeat(maxTargetLength), ids)]),
    ).toEqual([]);
    expect(validateRelayTokenModelMappingRules([...rules, rule("extra")])).toMatchObject([
      { code: "too-many-rules", ruleIndex: -1 },
    ]);
    expect(validateRelayTokenModelMappingRules([rule("a".repeat(maxPatternLength + 1))])).toMatchObject([
      { code: "invalid-source" },
    ]);
    expect(validateRelayTokenModelMappingRules([rule("a", "b".repeat(maxTargetLength + 1))])).toMatchObject([
      { code: "invalid-target" },
    ]);
    expect(validateRelayTokenModelMappingRules([rule("a", "b", [...ids, "extra"])])).toMatchObject([
      { code: "invalid-channel-ids" },
    ]);
  });

  it.each([
    [null, "invalid-rules"],
    [{}, "invalid-rules"],
    [[null], "invalid-rule"],
    [[rule("")], "invalid-source"],
    [[rule("  ")], "invalid-source"],
    [[rule("a", "")], "invalid-target"],
    [[rule("a", "  ")], "invalid-target"],
    [[{ ...rule("a"), preference: "invalid" }], "invalid-preference"],
    [[{ ...rule("a"), channelIds: "leaf" }], "invalid-channel-ids"],
    [[{ ...rule("a"), channelIds: [1] }], "invalid-channel-ids"],
  ])("reports invalid configuration %j as %s", (value, code) => {
    expect(validateRelayTokenModelMappingRules(value)).toContainEqual(
      expect.objectContaining({ severity: "error", code }),
    );
  });
});
