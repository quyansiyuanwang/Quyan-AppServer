import { describe, expect, it } from "vitest";
import { createRelayChannelBodySchema } from "../../../src/api/schema/relay/relay-channel.schema";
import { updateRelayConfigBodySchema } from "../../../src/api/schema/relay/relay-config.schema";

describe("Relay multiplier precision schemas", () => {
  it("accepts unique context-length tiers and rejects duplicate thresholds", () => {
    const base = {
      name: "context-tier-channel",
      contextLengthMultipliers: [
        { name: "32K", enabled: true, minTokens: 32000, multiplier: 1.25 },
        { name: "128K", enabled: true, minTokens: 128000, multiplier: 2 },
      ],
    };

    expect(createRelayChannelBodySchema.safeParse(base).success).toBe(true);
    expect(
      createRelayChannelBodySchema.safeParse({
        ...base,
        contextLengthMultipliers: [
          ...base.contextLengthMultipliers,
          { name: "duplicate", enabled: true, minTokens: 32000, multiplier: 3 },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts channel multiplier up to 6 decimal places", () => {
    const result = createRelayChannelBodySchema.safeParse({
      name: "precision-test-channel",
      multiplier: 1.123456,
    });

    expect(result.success).toBe(true);
  });

  it("rejects channel multiplier with more than 6 decimal places", () => {
    const result = createRelayChannelBodySchema.safeParse({
      name: "precision-test-channel",
      multiplier: 1.1234567,
    });

    expect(result.success).toBe(false);
  });

  it("accepts floating-point edge values within epsilon tolerance", () => {
    const result = createRelayChannelBodySchema.safeParse({
      name: "precision-test-channel",
      multiplier: 0.1 + 0.2,
    });

    expect(result.success).toBe(true);
  });

  it("rejects global multiplier with more than 6 decimal places", () => {
    const result = updateRelayConfigBodySchema.safeParse({
      globalMultiplier: 0.1234567,
    });

    expect(result.success).toBe(false);
  });
});
