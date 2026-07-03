import { describe, expect, it } from "vitest";
import { createRelayChannelBodySchema } from "../../../src/api/schema/relay/relay-channel.schema";
import { updateRelayConfigBodySchema } from "../../../src/api/schema/relay/relay-config.schema";

describe("Relay multiplier precision schemas", () => {
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
