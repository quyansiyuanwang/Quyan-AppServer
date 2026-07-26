import { describe, expect, it } from "vitest";
import {
  applyRelayChannelProbeRunsBodySchema,
  copyRelayChannelProbeProfileBodySchema,
  upsertRelayChannelProbeProfileBodySchema,
} from "../../../src/api/schema/relay/relay-channel-probe.schema";

const validProfile = {
  enabled: true,
  probeFormat: "openai" as const,
  probeModel: "gpt-test",
  probePayload: { messages: [{ role: "user", content: "ping" }] },
  workflow: [
    { name: "balance", method: "GET" as const, url: "https://api.example.com/balance", balancePath: "data.balance" },
  ],
};

describe("relay channel probe schemas", () => {
  it("accepts a bounded workflow with exactly one balance field", () => {
    const result = upsertRelayChannelProbeProfileBodySchema.safeParse({
      ...validProfile,
      upstreamBalanceDivisor: 1_000_000,
      probeGroup: "codeflow-main",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.upstreamBalanceDivisor).toBe(1_000_000);
      expect(result.data.probeGroup).toBe("codeflow-main");
    }
  });

  it("rejects an invalid balance divisor or oversized probe group", () => {
    expect(
      upsertRelayChannelProbeProfileBodySchema.safeParse({ ...validProfile, upstreamBalanceDivisor: 0 }).success,
    ).toBe(false);
    expect(
      upsertRelayChannelProbeProfileBodySchema.safeParse({ ...validProfile, probeGroup: "x".repeat(81) }).success,
    ).toBe(false);
  });

  it("rejects profiles without exactly one balance field", () => {
    expect(upsertRelayChannelProbeProfileBodySchema.safeParse({ ...validProfile, workflow: [] }).success).toBe(false);
    expect(
      upsertRelayChannelProbeProfileBodySchema.safeParse({
        ...validProfile,
        workflow: [validProfile.workflow[0], { ...validProfile.workflow[0], name: "again" }],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate run applications", () => {
    expect(applyRelayChannelProbeRunsBodySchema.safeParse({ runIds: ["run-1", "run-1"] }).success).toBe(false);
  });

  it("accepts bounded profile copy targets but rejects copying onto the source", () => {
    expect(
      copyRelayChannelProbeProfileBodySchema.safeParse({
        sourceChannelId: "source",
        targetChannelIds: ["target-a", "target-b"],
        overwriteExisting: true,
      }).success,
    ).toBe(true);
    expect(
      copyRelayChannelProbeProfileBodySchema.safeParse({
        sourceChannelId: "source",
        targetChannelIds: ["source"],
      }).success,
    ).toBe(false);
  });
});
