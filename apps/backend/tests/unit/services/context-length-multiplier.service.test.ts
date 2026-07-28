import { describe, expect, it } from "vitest";
import { resolveContextLengthMultiplier } from "@/services/relay/context-length-multiplier.service";

describe("resolveContextLengthMultiplier", () => {
  const rules = [
    { name: "32K", enabled: true, minTokens: 32_000, multiplier: 1.25 },
    { name: "128K", enabled: true, minTokens: 128_000, multiplier: 2 },
    { name: "disabled", enabled: false, minTokens: 256_000, multiplier: 3 },
  ];

  it("uses only the highest matching whole-request tier", () => {
    expect(resolveContextLengthMultiplier(rules, 127_999)).toMatchObject({ multiplier: 1.25, ruleName: "32K" });
    expect(resolveContextLengthMultiplier(rules, 128_000)).toMatchObject({ multiplier: 2, ruleName: "128K" });
  });

  it("falls back to one when no enabled tier matches", () => {
    expect(resolveContextLengthMultiplier(rules, 31_999)).toEqual({
      contextTokens: 31_999,
      multiplier: 1,
      ruleName: undefined,
    });
    expect(resolveContextLengthMultiplier(rules, 300_000)).toMatchObject({ multiplier: 2, ruleName: "128K" });
  });
});
