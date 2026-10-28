import { describe, expect, it, vi } from "vitest";
import { Decimal } from "decimal.js";
import {
  projectRelayTokenConfiguration,
  type RelayTokenConfigurationProjectionSource,
  type RelayTokenConfigurationProjectionNormalizers,
} from "@/services/relay/relay-token-configuration-projection";
import { DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG } from "@/util/anthropic-token-normalizer.util";

function source(
  overrides: Partial<RelayTokenConfigurationProjectionSource> = {},
): RelayTokenConfigurationProjectionSource {
  return {
    name: "fixture",
    expiresAt: null,
    routingMode: "ordered",
    automaticProxyPoolChannelId: null,
    blockedAutomaticProxyPoolChannelIds: null,
    channelId: null,
    quotaLimit: null,
    allowedModels: null,
    ipWhitelist: null,
    modelMapping: null,
    requestFormatTransforms: null,
    normalizerConfig: null,
    streamConfig: null,
    contentSafetyConfig: null,
    status: 1,
    memberTokenConfigs: [],
    channelConfigs: [{ channelId: "fallback", priority: 0 }],
    quotaWindows: [],
    failoverConfig: null,
    ...overrides,
  };
}
function normalizers() {
  return {
    blockedChannelIds: vi.fn<RelayTokenConfigurationProjectionNormalizers["blockedChannelIds"]>().mockReturnValue([]),
    quotaUnit: vi.fn<RelayTokenConfigurationProjectionNormalizers["quotaUnit"]>().mockReturnValue("amount"),
    requestFormatTransforms: vi
      .fn<RelayTokenConfigurationProjectionNormalizers["requestFormatTransforms"]>()
      .mockReturnValue(null),
    normalizerConfig: vi
      .fn<RelayTokenConfigurationProjectionNormalizers["normalizerConfig"]>()
      .mockReturnValue({ ...DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG }),
  };
}
describe("credential-free relay token configuration projection", () => {
  it("projects the exact existing configuration shape without requiring a credential-bearing source", () => {
    expect(projectRelayTokenConfiguration(source(), normalizers())).toEqual({
      name: "fixture",
      expiresAt: undefined,
      routingMode: "ordered",
      memberTokenConfigs: undefined,
      automaticProxyPoolChannelId: undefined,
      blockedAutomaticProxyPoolChannelIds: [],
      channelId: "fallback",
      channelConfigs: [{ channelId: "fallback", priority: 0 }],
      failoverConfig: undefined,
      quotaLimit: undefined,
      quotaWindows: [],
      allowedModels: undefined,
      ipWhitelist: undefined,
      modelMapping: null,
      requestFormatTransforms: undefined,
      normalizerConfig: DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG,
      streamConfig: null,
      contentSafetyConfig: null,
      enabled: true,
    });
  });
  it("never reads credentials, ownership, usage, user or upstream details even from a rich source", () => {
    const input = source();
    const forbidden = [
      "token",
      "legacyToken",
      "userId",
      "id",
      "isCustomKey",
      "totalTokens",
      "usedQuota",
      "requestCount",
      "user",
      "channel",
      "password",
      "upstreamApiKey",
    ];
    for (const key of forbidden)
      Object.defineProperty(input, key, {
        get: () => {
          throw new Error("forbidden field " + key);
        },
      });
    const result = projectRelayTokenConfiguration(input, normalizers());
    for (const key of [...forbidden, "targetUserId"]) expect(result).not.toHaveProperty(key);
  });
  it.each(["ordered", "automatic-pool", "composite", "unknown"])(
    "retains stored %s routing semantics",
    (routingMode) => {
      const members = [{ tokenId: "member", priority: 2, enabled: false }];
      const result = projectRelayTokenConfiguration(
        source({ routingMode, memberTokenConfigs: members, automaticProxyPoolChannelId: "pool" }),
        normalizers(),
      );
      expect(result.routingMode).toBe(["automatic-pool", "composite"].includes(routingMode) ? routingMode : "ordered");
      expect(result.automaticProxyPoolChannelId).toBe("pool");
      expect(result.memberTokenConfigs).toEqual(routingMode === "composite" ? members : undefined);
      if (routingMode === "composite") expect(result.memberTokenConfigs![0]).not.toBe(members[0]);
    },
  );
  it("preserves disabled member bindings without reading nested member credentials", () => {
    const member = { tokenId: "member", priority: 0, enabled: false };
    Object.defineProperty(member, "memberToken", {
      get: () => {
        throw new Error("nested member read");
      },
    });
    expect(
      projectRelayTokenConfiguration(source({ routingMode: "composite", memberTokenConfigs: [member] }), normalizers())
        .memberTokenConfigs,
    ).toEqual([{ tokenId: "member", priority: 0, enabled: false }]);
  });
  it("normalizes decimals, dates, source status and legacy failover defaults without copying counters", () => {
    const result = projectRelayTokenConfiguration(
      source({
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        status: 0,
        quotaLimit: new Decimal(0),
        failoverConfig: {
          enabled: false,
          maxRetries: 0,
          retryStatusCodes: ["500", "5xx", "invalid"],
          failoverThreshold: -1,
          failbackCooldownMinutes: -1,
          maxAcceptedChannelMultiplier: new Decimal("1.25"),
          minCacheHitRate: new Decimal("0.5"),
        },
      }),
      normalizers(),
    );
    expect(result).toMatchObject({
      expiresAt: "2030-01-01T00:00:00.000Z",
      enabled: false,
      quotaLimit: 0,
      failoverConfig: {
        enabled: false,
        maxRetries: 2,
        failoverThreshold: 0,
        failbackCooldownMinutes: 0,
        maxAcceptedChannelMultiplier: 1.25,
        minCacheHitRate: 0.5,
      },
    });
    expect(result.failoverConfig!.retryStatusCodes).not.toContain("invalid");
  });
  it("keeps nullable failover thresholds distinct from explicit numeric zero", () => {
    const base = {
      enabled: true,
      maxRetries: 3,
      retryStatusCodes: null,
      failoverThreshold: 1,
      failbackCooldownMinutes: 2,
    };
    for (const value of [null, new Decimal(0)]) {
      const result = projectRelayTokenConfiguration(
        source({ failoverConfig: { ...base, maxAcceptedChannelMultiplier: value, minCacheHitRate: value } }),
        normalizers(),
      );
      expect(result.failoverConfig).toMatchObject({
        maxRetries: 3,
        retryStatusCodes: [],
        maxAcceptedChannelMultiplier: value === null ? null : 0,
        minCacheHitRate: value === null ? null : 0,
      });
    }
  });
  it("preserves all quota, stream, content safety, model and network configuration", () => {
    const input = source({
      quotaWindows: [{ quotaLimit: new Decimal("1.5"), quotaUnit: "request", quotaWindowHours: new Decimal("0.25") }],
      streamConfig: { preflightBufferLimitBytes: 524288 },
      contentSafetyConfig: { requestEnabled: false },
      modelMapping: { a: "b" },
      allowedModels: "a,b",
      ipWhitelist: "127.0.0.1",
      channelId: "primary",
    });
    const normalize = normalizers();
    normalize.quotaUnit.mockReturnValue("request");
    expect(projectRelayTokenConfiguration(input, normalize)).toMatchObject({
      quotaWindows: [{ quotaLimit: 1.5, quotaUnit: "request", quotaWindowHours: 0.25 }],
      streamConfig: input.streamConfig,
      contentSafetyConfig: input.contentSafetyConfig,
      modelMapping: input.modelMapping,
      allowedModels: "a,b",
      ipWhitelist: "127.0.0.1",
      channelId: "primary",
    });
    expect(normalize.quotaUnit).toHaveBeenCalledExactlyOnceWith("request");
  });
  it("forwards normalization to existing domain callbacks rather than defining a second policy", () => {
    const input = source({
      blockedAutomaticProxyPoolChannelIds: ["channel"],
      requestFormatTransforms: [],
      normalizerConfig: { enabled: true },
    });
    const normalize = normalizers();
    normalize.blockedChannelIds.mockReturnValue(["normalized-channel"]);
    normalize.requestFormatTransforms.mockReturnValue([
      { sourceFormat: "openai-responses", targetFormat: "anthropic" },
    ]);
    normalize.normalizerConfig.mockReturnValue({ ...DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG, enabled: true });
    const result = projectRelayTokenConfiguration(input, normalize);
    expect(result.blockedAutomaticProxyPoolChannelIds).toEqual(["normalized-channel"]);
    expect(result.requestFormatTransforms).toEqual([{ sourceFormat: "openai-responses", targetFormat: "anthropic" }]);
    expect(result.normalizerConfig!.enabled).toBe(true);
    expect(normalize.blockedChannelIds).toHaveBeenCalledExactlyOnceWith(input.blockedAutomaticProxyPoolChannelIds);
    expect(normalize.requestFormatTransforms).toHaveBeenCalledExactlyOnceWith(input.requestFormatTransforms);
    expect(normalize.normalizerConfig).toHaveBeenCalledExactlyOnceWith(input.normalizerConfig);
  });
  it("does not swallow normalization failures", () => {
    const normalize = normalizers();
    normalize.requestFormatTransforms.mockImplementation(() => {
      throw new Error("fixture invalid transform");
    });
    expect(() => projectRelayTokenConfiguration(source(), normalize)).toThrow("fixture invalid transform");
  });
});
