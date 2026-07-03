import { describe, expect, it } from "vitest";
import { isMonthlyPassTemplateMatched, serializeStringArray } from "@/util/monthly-pass.util";

describe("monthly-pass.util", () => {
  it("matches template when allowed model contains exact model name", () => {
    const template = {
      allowedModels: serializeStringArray(["gpt-5.4-.1C"]),
      allowedChannels: null,
    };

    expect(isMonthlyPassTemplateMatched(template, "gpt-5.4-.1C", "channel-1")).toBe(true);
  });

  it("does not match when only modelId/provider alias is in allowedModels", () => {
    const template = {
      allowedModels: serializeStringArray(["gpt-5.4"]),
      allowedChannels: null,
    };

    expect(isMonthlyPassTemplateMatched(template, "gpt-5.4-.1C", "channel-1")).toBe(false);
  });

  it("still allows all models when allowedModels is empty", () => {
    const template = {
      allowedModels: null,
      allowedChannels: null,
    };

    expect(isMonthlyPassTemplateMatched(template, "gpt-5.4-.1C", "channel-1")).toBe(true);
  });
});
