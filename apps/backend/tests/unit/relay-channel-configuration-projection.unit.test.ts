import { describe, expect, it } from "vitest";
import { RELAY_CHANNEL_STATUS } from "@quyan/shared";
import {
  projectRelayChannelConfiguration,
  type RelayChannelConfigurationSource,
  type RelayChannelConfigurationMember,
} from "@/services/relay/relay-channel-configuration-projection";
const now = new Date("2026-10-16T00:00:00Z");
function source(overrides: Partial<RelayChannelConfigurationSource> = {}): RelayChannelConfigurationSource {
  return {
    id: "root",
    name: "Fixture channel",
    status: RELAY_CHANNEL_STATUS.ENABLED,
    providerServiceEnabled: true,
    channelType: "standalone",
    routingStrategy: "priority",
    routingConfig: null,
    visibilityMode: "public",
    visibilityConfig: null,
    pooledParentId: null,
    pooledPriority: 0,
    pooledWeight: 1 as never,
    pooledMemberEnabled: true,
    openaiUpstreamUrl: "https://example.invalid/v1",
    anthropicUpstreamUrl: null,
    geminiUpstreamUrl: null,
    useProxy: false,
    multiplier: 1.5 as never,
    allowedFormats: "openai-responses",
    allowedModels: '["catalog-a"]',
    addUserIdentifier: true,
    inputTokensIncludeCacheRead: false,
    modelMapping: { "catalog-a": "upstream-a" },
    timePeriodMultipliers: [],
    contextLengthMultipliers: [],
    submissionStatus: "approved",
    submittedByUserId: "actor",
    reviewedAt: now,
    reviewReason: null,
    createTime: now,
    updateTime: now,
    ...overrides,
  };
}
const presence = { hasOpenaiUpstreamApiKey: true, hasAnthropicUpstreamApiKey: false, hasGeminiUpstreamApiKey: false };
function noCredentials<T extends object>(row: T): T {
  for (const field of [
    "openaiUpstreamApiKey",
    "anthropicUpstreamApiKey",
    "geminiUpstreamApiKey",
    "encryptedCredentials",
    "password",
  ])
    Object.defineProperty(row, field, {
      enumerable: true,
      get() {
        throw new Error("Credential boundary was crossed");
      },
    });
  return row;
}
const member = (id: string, extra: Partial<RelayChannelConfigurationMember> = {}): RelayChannelConfigurationMember =>
  noCredentials({
    id,
    name: id,
    channelType: "pooled-member",
    status: RELAY_CHANNEL_STATUS.ENABLED,
    providerServiceEnabled: true,
    pooledPriority: 0,
    pooledWeight: 1 as never,
    pooledMemberEnabled: true,
    ...extra,
  });
describe("credential-free relay channel configuration projection", () => {
  it("projects only explicit public fields and supplied presence flags without reading or spreading credentials", () => {
    const row = noCredentials(source());
    const result = projectRelayChannelConfiguration(row, presence);
    expect(result).toMatchObject({
      id: "root",
      name: "Fixture channel",
      enabled: true,
      serviceEnabled: true,
      openaiUpstreamUrl: "https://example.invalid/v1",
      hasOpenaiUpstreamApiKey: true,
      hasAnthropicUpstreamApiKey: false,
      configuredAllowedModels: '["catalog-a"]',
      allowedModels: [],
      multiplier: 1.5,
      modelMapping: { "catalog-a": "upstream-a" },
    });
    for (const field of [
      "openaiUpstreamApiKey",
      "anthropicUpstreamApiKey",
      "geminiUpstreamApiKey",
      "password",
      "encryptedCredentials",
    ])
      expect(result).not.toHaveProperty(field);
  });
  it("does not infer presence from other configuration or invoke a catalog resolver", () => {
    expect(
      projectRelayChannelConfiguration(noCredentials(source({ openaiUpstreamUrl: null })), presence),
    ).toMatchObject({ hasOpenaiUpstreamApiKey: true, allowedModels: [] });
    expect(
      projectRelayChannelConfiguration(noCredentials(source()), { ...presence, hasOpenaiUpstreamApiKey: false }),
    ).toMatchObject({ hasOpenaiUpstreamApiKey: false });
  });
  it("keeps strict member overrides and output identity attached to the same member", () => {
    const a = member("a"),
      b = member("b", { pooledPriority: 1, pooledWeight: 7 as never, pooledMemberEnabled: false });
    const result = projectRelayChannelConfiguration(
      noCredentials(
        source({
          channelType: "pooled",
          poolMembers: [
            { memberChannelId: "a", priority: 4, weight: 3, enabled: true, memberChannel: a },
            { memberChannelId: "b", priority: 8, weight: 9, enabled: true, memberChannel: b },
          ],
          pooledChildren: [b],
        }),
      ),
      presence,
    );
    expect(result.poolMembers).toEqual([
      {
        memberChannelId: "b",
        priority: 1,
        weight: 7,
        enabled: false,
        memberChannelName: "b",
        memberChannelType: "pooled-member",
        memberChannelEnabled: true,
      },
      {
        memberChannelId: "a",
        priority: 4,
        weight: 3,
        enabled: true,
        memberChannelName: "a",
        memberChannelType: "pooled-member",
        memberChannelEnabled: true,
      },
    ]);
  });
  it("retains flags and safe defaults for disabled/provider-paused channels", () => {
    const result = projectRelayChannelConfiguration(
      source({
        status: RELAY_CHANNEL_STATUS.DISABLED,
        providerServiceEnabled: false,
        allowedFormats: null,
        allowedModels: null,
        anthropicUpstreamUrl: "",
        submittedByUserId: null,
      }),
      presence,
    );
    expect(result).toMatchObject({
      enabled: false,
      providerServiceEnabled: false,
      serviceEnabled: false,
      allowedFormats: "openai-chat-completions,anthropic,gemini",
      allowedModels: [],
      poolMembers: [],
      providers: [],
    });
    expect(result.configuredAllowedModels).toBeUndefined();
    expect(result.anthropicUpstreamUrl).toBeUndefined();
  });
  it("does not populate omitted or unavailable member and parent metadata", () => {
    const result = projectRelayChannelConfiguration(
      source({
        pooledParentId: "parent",
        poolMembers: [{ memberChannelId: "a", priority: 1, weight: 2, enabled: true, memberChannel: null }],
      }),
      presence,
    );
    expect(result.pooledParentId).toBe("parent");
    expect(result.pooledParentName).toBeUndefined();
    expect(result.poolMembers![0]).toMatchObject({ memberChannelId: "a", memberChannelEnabled: false });
    expect(result.poolMembers![0]!.memberChannelName).toBeUndefined();
  });
  it("projects provider configuration without rich user fields and retains fallback usernames and settlement times", () => {
    const result = projectRelayChannelConfiguration(
      source({
        submittedBy: noCredentials({ username: "submitter" }),
        pooledParent: noCredentials({ name: "Logical pool" }),
        providers: [
          {
            id: "provider",
            userId: "provider-user",
            commissionPercent: 25,
            settlementMode: "daily",
            settlementTime: "08:00",
            settlementIntervalDays: null,
            nextSettlementAt: now,
            user: noCredentials({ username: "provider-name" }),
          },
        ],
      }),
      presence,
    );
    expect(result).toMatchObject({
      submittedByUsername: "submitter",
      pooledParentName: "Logical pool",
      providers: [
        {
          id: "provider",
          userId: "provider-user",
          username: "provider-name",
          commissionPercent: 25,
          settlementMode: "daily",
          settlementTime: "08:00",
          nextSettlementAt: now,
        },
      ],
    });
  });
});
