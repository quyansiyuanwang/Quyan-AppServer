import { describe, expect, it } from "vitest";
import {
  projectRelayChannelConfiguration,
  type RelayChannelConfigurationSource,
} from "@/services/relay/relay-channel-configuration-projection";
const source = (patch: Record<string, unknown> = {}) =>
  ({
    id: "channel",
    name: "channel",
    status: 1,
    providerServiceEnabled: true,
    channelType: "standalone",
    routingStrategy: "priority",
    visibilityMode: "hidden",
    multiplier: 1,
    pooledPriority: 0,
    pooledWeight: 1,
    pooledMemberEnabled: true,
    ...patch,
  }) as unknown as RelayChannelConfigurationSource;
const presence = { hasOpenaiUpstreamApiKey: true, hasAnthropicUpstreamApiKey: false, hasGeminiUpstreamApiKey: false };
const project = (patch: Record<string, unknown> = {}) => projectRelayChannelConfiguration(source(patch), presence);
const timeRule = {
  name: "night",
  enabled: true,
  dayOfWeek: "1,2",
  startTime: "01:00",
  endTime: "02:00",
  multiplier: 2,
};
const contextRule = { name: "large", enabled: true, minTokens: 1000, multiplier: 2 };
describe("registered channel configuration response projection", () => {
  it("strips unknown nested fields and never spreads arbitrary stored row data", () => {
    const patch = {
      routingConfig: { maxRetries: 2, retryStatusCodes: [429, "/^5\\d{2}$/"], credential: "fixture-secret-routing" },
      visibilityConfig: {
        userIds: ["user"],
        groupIds: ["group"],
        roleIds: ["role"],
        token: "fixture-secret-visibility",
      },
      timePeriodMultipliers: [{ ...timeRule, upstreamKey: "fixture-secret-time" }],
      contextLengthMultipliers: [{ ...contextRule, privateConfig: { password: "fixture-secret-context" } }],
      openaiUpstreamApiKey: "fixture-secret-row",
      unregisteredObject: { secret: "fixture-secret-object" },
    };
    const before = structuredClone(patch),
      result = project(patch);
    expect(result.routingConfig).toEqual({ maxRetries: 2, retryStatusCodes: [429, "/^5\\d{2}$/"] });
    expect(result.visibilityConfig).toEqual({ userIds: ["user"], groupIds: ["group"], roleIds: ["role"] });
    expect(result.timePeriodMultipliers).toEqual([timeRule]);
    expect(result.contextLengthMultipliers).toEqual([contextRule]);
    expect(result.hasOpenaiUpstreamApiKey).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(patch).toEqual(before);
  });
  it("keeps administrator retry expressions and registered routing settings unchanged", () => {
    const routingConfig = {
      maxRetries: 3,
      failoverThreshold: 2,
      retryStatusCodes: [429, "5xx", "/^50[234]$/"],
      failbackCooldownMinutes: 3,
      healthScoreThreshold: 0.5,
      latencyThresholdMs: 123,
      circuitBreakerThreshold: 4,
      allowedModelsMode: "manual",
      stickyByModel: true,
      stickyByFormat: false,
      rankingMode: "price-first",
      dynamicMemberRankingEnabled: false,
      healthTrackingMode: "manual",
      manualAvailability: 0.8,
      manualLatencyMs: 200,
    };
    expect(project({ routingConfig }).routingConfig).toEqual(routingConfig);
  });
  it("keeps intentional string-valued model mappings rather than filtering model names as field names", () => {
    const modelMapping = { "request-model": "price-alias", "token-model": "upstream-model", password: "model-name" };
    expect(project({ modelMapping }).modelMapping).toEqual(modelMapping);
  });
  it.each([undefined, null])("omits absent optional JSON fields (%s)", (empty) => {
    const result = project({
      routingConfig: empty,
      visibilityConfig: empty,
      modelMapping: empty,
      timePeriodMultipliers: empty,
      contextLengthMultipliers: empty,
    });
    for (const key of [
      "routingConfig",
      "visibilityConfig",
      "modelMapping",
      "timePeriodMultipliers",
      "contextLengthMultipliers",
    ])
      expect(result[key as keyof typeof result]).toBeUndefined();
  });
  it.each([
    { routingConfig: "fixture-secret-malformed" },
    { routingConfig: { retryStatusCodes: [{}] } },
    { routingConfig: { maxRetries: -1 } },
    { routingConfig: { allowedModelsMode: "upstream" } },
    { visibilityConfig: { userIds: [{ key: "fixture-secret-malformed" }] } },
    { visibilityConfig: [] },
    { modelMapping: { model: { key: "fixture-secret-malformed" } } },
    { timePeriodMultipliers: [{ ...timeRule, multiplier: -1 }] },
    { timePeriodMultipliers: [{ ...timeRule, name: "" }] },
    { contextLengthMultipliers: [{ ...contextRule, minTokens: -1 }] },
    { contextLengthMultipliers: [contextRule, contextRule] },
  ])("fails closed on invalid registered JSON without exposing parser input: %j", (patch) => {
    try {
      project(patch);
      expect.fail("invalid registered field must be rejected");
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 403, messageKey: "permission.insufficientPermission" });
      expect(String(error)).not.toContain("fixture-secret");
      expect(error).not.toHaveProperty("issues");
    }
  });
  it("returns detached nested arrays and objects", () => {
    const patch = {
      routingConfig: { retryStatusCodes: [429] },
      visibilityConfig: { userIds: ["user"] },
      modelMapping: { model: "price" },
      timePeriodMultipliers: [timeRule],
      contextLengthMultipliers: [contextRule],
    };
    const original = structuredClone(patch),
      result = project(patch);
    result.routingConfig!.retryStatusCodes!.push(500);
    result.visibilityConfig!.userIds!.push("other");
    result.modelMapping!.model = "other";
    result.timePeriodMultipliers![0]!.name = "other";
    result.contextLengthMultipliers![0]!.name = "other";
    expect(patch).toEqual(original);
  });
});
