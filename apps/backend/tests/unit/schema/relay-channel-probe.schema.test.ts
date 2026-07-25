import { describe, expect, it } from "vitest";
import {
  applyRelayChannelProbeRunsBodySchema,
  upsertRelayChannelProbeProfileBodySchema,
} from "../../../src/api/schema/relay/relay-channel-probe.schema";

const validProfile = {
  enabled: true,
  probeFormat: "openai" as const,
  probeModel: "gpt-test",
  probePayload: { messages: [{ role: "user", content: "ping" }] },
  workflow: [{ name: "balance", method: "GET" as const, url: "https://api.example.com/balance", balancePath: "data.balance" }],
};

describe("relay channel probe schemas", () => {
  it("accepts a bounded workflow with exactly one balance field", () => {
    expect(upsertRelayChannelProbeProfileBodySchema.safeParse(validProfile).success).toBe(true);
  });

  it("rejects profiles without exactly one balance field", () => {
    expect(upsertRelayChannelProbeProfileBodySchema.safeParse({ ...validProfile, workflow: [] }).success).toBe(false);
    expect(upsertRelayChannelProbeProfileBodySchema.safeParse({ ...validProfile, workflow: [validProfile.workflow[0], { ...validProfile.workflow[0], name: "again" }] }).success).toBe(false);
  });

  it("rejects duplicate run applications", () => {
    expect(applyRelayChannelProbeRunsBodySchema.safeParse({ runIds: ["run-1", "run-1"] }).success).toBe(false);
  });
});
