import { describe, expect, it } from "vitest";
import {
  calculateSuggestedProbeMultiplier,
  interpolateProbeVariables,
  readProbeJsonPath,
} from "../../src/services/relay/relay-channel-probe.service";

describe("relay channel probe helpers", () => {
  it("interpolates nested request values without changing other primitives", () => {
    expect(interpolateProbeVariables({ headers: { Authorization: "Bearer {{token}}" }, items: ["{{user}}", 1] }, { token: "secret", user: "alice" })).toEqual({ headers: { Authorization: "Bearer secret" }, items: ["alice", 1] });
  });

  it("reads common JSONPath forms", () => {
    const source = { data: { balances: [{ amount: 12.5 }] } };
    expect(readProbeJsonPath(source, "$.data.balances[0].amount")).toBe(12.5);
    expect(readProbeJsonPath(source, "data['balances'][0].amount")).toBe(12.5);
  });

  it("rounds valid suggestions and rejects non-comparable values", () => {
    expect(calculateSuggestedProbeMultiplier(0.5, 2, 0.3)).toBe(3.333333);
    expect(calculateSuggestedProbeMultiplier(0, 2, 0.3)).toBeUndefined();
    expect(calculateSuggestedProbeMultiplier(1, 1, 0)).toBeUndefined();
  });
});
