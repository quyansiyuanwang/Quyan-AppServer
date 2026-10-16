import { describe, expect, it, vi } from "vitest";
import type { CreateRelayTokenDto } from "@/api/dto/relay/relay.dto";
import {
  prepareRelayTokenCreate,
  type RelayTokenCreatePreparation,
} from "@/services/relay/relay-token-create-preparation";
import { DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG } from "@/util/anthropic-token-normalizer.util";

function callbacks() {
  return {
    orderedChannels: vi.fn<RelayTokenCreatePreparation["orderedChannels"]>().mockResolvedValue({
      defaultChannelId: "selected",
      channelConfigs: [{ channelId: "selected", priority: 0 }],
    }),
    automaticPool: vi.fn<RelayTokenCreatePreparation["automaticPool"]>().mockResolvedValue(["blocked"]),
    customCredential: vi
      .fn<RelayTokenCreatePreparation["customCredential"]>()
      .mockResolvedValue("fixture-custom-value"),
    generatedCredential: vi.fn().mockReturnValue("fixture-generated-value"),
    expiresAt: vi.fn<RelayTokenCreatePreparation["expiresAt"]>().mockReturnValue(undefined),
    quotaWindows: vi.fn<RelayTokenCreatePreparation["quotaWindows"]>().mockReturnValue([]),
    ipWhitelist: vi.fn<RelayTokenCreatePreparation["ipWhitelist"]>().mockReturnValue(null),
    requestFormatTransforms: vi.fn<RelayTokenCreatePreparation["requestFormatTransforms"]>().mockReturnValue(null),
    normalizerConfig: vi
      .fn<RelayTokenCreatePreparation["normalizerConfig"]>()
      .mockReturnValue({ ...DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG, enabled: true }),
    compositeFailover: vi
      .fn<RelayTokenCreatePreparation["compositeFailover"]>()
      .mockReturnValue({ enabled: true, maxRetries: 2 }),
  } satisfies RelayTokenCreatePreparation;
}

describe("relay token creation preparation", () => {
  it("retains ordered defaults and uses the server-resolved owner rather than client target input", async () => {
    const prepare = callbacks();
    const result = await prepareRelayTokenCreate(
      "server-owner",
      { targetUserId: "client-target", channelId: "requested" },
      prepare,
    );
    expect(result).toEqual({
      requiresGraphLock: false,
      create: {
        userId: "server-owner",
        name: undefined,
        token: "fixture-generated-value",
        isCustomKey: false,
        expiresAt: undefined,
        channelId: "selected",
        routingMode: "ordered",
        memberTokenConfigs: undefined,
        streamConfig: undefined,
        automaticProxyPoolChannelId: undefined,
        blockedAutomaticProxyPoolChannelIds: [],
        channelConfigs: [{ channelId: "selected", priority: 0 }],
        failoverConfig: undefined,
        quotaLimit: undefined,
        quotaWindows: [],
        allowedModels: undefined,
        requestFormatTransforms: null,
        normalizerConfig: DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG,
        contentSafetyConfig: undefined,
        ipWhitelist: null,
        modelMapping: undefined,
      },
    });
    expect(prepare.orderedChannels).toHaveBeenCalledExactlyOnceWith("requested", undefined);
    expect(prepare.generatedCredential).toHaveBeenCalledOnce();
    expect(prepare.customCredential).not.toHaveBeenCalled();
    expect(prepare.automaticPool).not.toHaveBeenCalled();
    expect(prepare.compositeFailover).not.toHaveBeenCalled();
  });
  it("normalizes the complete ordered channel list without mutating request data", async () => {
    const prepare = callbacks();
    const data: CreateRelayTokenDto = {
      channelConfigs: [
        { channelId: "b", priority: 1 },
        { channelId: "a", priority: 0 },
      ],
    };
    const before = structuredClone(data);
    await prepareRelayTokenCreate("owner", data, prepare);
    expect(prepare.orderedChannels).toHaveBeenCalledExactlyOnceWith(undefined, data.channelConfigs);
    expect(data).toEqual(before);
  });
  it("uses automatic-pool admission and does not create dormant ordered bindings", async () => {
    const prepare = callbacks();
    const { create, requiresGraphLock } = await prepareRelayTokenCreate(
      "owner",
      {
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "pool",
        blockedAutomaticProxyPoolChannelIds: ["blocked", "blocked"],
        channelId: "ignored",
        channelConfigs: [{ channelId: "ignored", priority: 0 }],
      },
      prepare,
    );
    expect(prepare.automaticPool).toHaveBeenCalledExactlyOnceWith("pool", ["blocked", "blocked"]);
    expect(prepare.orderedChannels).not.toHaveBeenCalled();
    expect(create).toMatchObject({
      routingMode: "automatic-pool",
      automaticProxyPoolChannelId: "pool",
      blockedAutomaticProxyPoolChannelIds: ["blocked"],
      channelId: undefined,
      channelConfigs: [],
    });
    expect(requiresGraphLock).toBe(false);
  });
  it("does not accidentally select an automatic pool outside automatic mode", async () => {
    const prepare = callbacks();
    const { create } = await prepareRelayTokenCreate(
      "owner",
      { channelId: "ordered", automaticProxyPoolChannelId: "unused", blockedAutomaticProxyPoolChannelIds: ["unused"] },
      prepare,
    );
    expect(prepare.automaticPool).not.toHaveBeenCalled();
    expect(prepare.orderedChannels).toHaveBeenCalledOnce();
    expect(create.automaticProxyPoolChannelId).toBeUndefined();
    expect(create.blockedAutomaticProxyPoolChannelIds).toEqual([]);
  });
  it("uses graph admission and composition failover defaults for composite creation", async () => {
    const prepare = callbacks();
    const members = [
      { tokenId: "member-a", priority: 0, enabled: false },
      { tokenId: "member-b", priority: 1, enabled: true },
    ];
    const { create, requiresGraphLock } = await prepareRelayTokenCreate(
      "owner",
      { routingMode: "composite", memberTokenConfigs: members },
      prepare,
    );
    expect(requiresGraphLock).toBe(true);
    expect(prepare.orderedChannels).not.toHaveBeenCalled();
    expect(prepare.automaticPool).not.toHaveBeenCalled();
    expect(prepare.compositeFailover).toHaveBeenCalledExactlyOnceWith(2);
    expect(create).toMatchObject({
      routingMode: "composite",
      memberTokenConfigs: members,
      channelConfigs: [],
      channelId: undefined,
      failoverConfig: { enabled: true, maxRetries: 2 },
    });
  });
  it("retains explicit failover config without replacing zero and false with composite defaults", async () => {
    const prepare = callbacks();
    const failoverConfig = {
      enabled: false,
      maxRetries: 0,
      retryStatusCodes: [],
      failoverThreshold: 0,
      failbackCooldownMinutes: 0,
    };
    const { create } = await prepareRelayTokenCreate("owner", { routingMode: "composite", failoverConfig }, prepare);
    expect(create.failoverConfig).toEqual(failoverConfig);
    expect(prepare.compositeFailover).not.toHaveBeenCalled();
  });
  it("calls the independently authorized custom credential provider once and never generates a second credential", async () => {
    const prepare = callbacks();
    const { create } = await prepareRelayTokenCreate("owner", { token: "fixture-preferred-value" }, prepare);
    expect(prepare.customCredential).toHaveBeenCalledExactlyOnceWith("fixture-preferred-value");
    expect(prepare.generatedCredential).not.toHaveBeenCalled();
    expect(create.token).toBe("fixture-custom-value");
    expect(create.isCustomKey).toBe(true);
    expect(create).not.toHaveProperty("legacyToken");
  });
  it("keeps the existing empty-credential behavior", async () => {
    const prepare = callbacks();
    const { create } = await prepareRelayTokenCreate("owner", { token: "" }, prepare);
    expect(create.token).toBe("fixture-generated-value");
    expect(create.isCustomKey).toBe(false);
    expect(prepare.customCredential).not.toHaveBeenCalled();
  });
  it("does not continue normalizing after custom credential admission fails", async () => {
    const prepare = callbacks(),
      denied = new Error("fixture credential admission denied");
    prepare.customCredential.mockRejectedValueOnce(denied);
    await expect(prepareRelayTokenCreate("owner", { token: "fixture-preferred-value" }, prepare)).rejects.toBe(denied);
    expect(prepare.generatedCredential).not.toHaveBeenCalled();
    expect(prepare.expiresAt).not.toHaveBeenCalled();
  });
  it("does not generate credentials if routing admission fails", async () => {
    const prepare = callbacks(),
      denied = new Error("fixture routing admission denied");
    prepare.orderedChannels.mockRejectedValueOnce(denied);
    await expect(prepareRelayTokenCreate("owner", {}, prepare)).rejects.toBe(denied);
    expect(prepare.generatedCredential).not.toHaveBeenCalled();
    expect(prepare.customCredential).not.toHaveBeenCalled();
  });
  it.each([null, undefined])(
    "preserves create-time nullish rather than update-time clearing semantics (%s)",
    async (value) => {
      const prepare = callbacks();
      const { create } = await prepareRelayTokenCreate(
        "owner",
        { name: value, expiresAt: value, quotaLimit: value, allowedModels: value, contentSafetyConfig: value },
        prepare,
      );
      expect(create.name).toBeUndefined();
      expect(create.expiresAt).toBeUndefined();
      expect(create.quotaLimit).toBeUndefined();
      expect(create.allowedModels).toBeUndefined();
      expect(create.contentSafetyConfig).toBeUndefined();
    },
  );
  it("preserves zero quotas and trims display fields while leaving explicit model mapping and stream config intact", async () => {
    const prepare = callbacks(),
      expires = new Date("2030-01-01T00:00:00.000Z");
    prepare.expiresAt.mockReturnValue(expires);
    const data = {
      name: "  new token  ",
      allowedModels: "  a,b  ",
      quotaLimit: 0,
      expiresAt: expires.toISOString(),
      modelMapping: {},
      streamConfig: { preflightBufferLimitBytes: 512 * 1024 },
    };
    const { create } = await prepareRelayTokenCreate("owner", data, prepare);
    expect(create).toMatchObject({
      name: "new token",
      allowedModels: "a,b",
      quotaLimit: 0,
      expiresAt: expires,
      modelMapping: {},
      streamConfig: data.streamConfig,
    });
    expect(prepare.expiresAt).toHaveBeenCalledWith(data.expiresAt);
  });
  it("awaits an asynchronous generated-credential occupancy check instead of persisting a promise", async () => {
    const prepare = callbacks();
    prepare.generatedCredential.mockResolvedValue("fixture-reserved-value");
    const { create } = await prepareRelayTokenCreate("owner", {}, prepare);
    expect(create.token).toBe("fixture-reserved-value");
    expect(create.isCustomKey).toBe(false);
    expect(prepare.customCredential).not.toHaveBeenCalled();
  });
  it("forwards domain normalization to the existing server callbacks", async () => {
    const prepare = callbacks();
    const data: CreateRelayTokenDto = {
      ipWhitelist: "127.0.0.1",
      quotaWindows: [{ quotaLimit: 0, quotaUnit: "request", quotaWindowHours: 1 }],
      requestFormatTransforms: [],
      normalizerConfig: { ...DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG, enabled: true },
    };
    prepare.quotaWindows.mockReturnValue(data.quotaWindows!);
    prepare.ipWhitelist.mockReturnValue("normalized-ip");
    prepare.requestFormatTransforms.mockReturnValue([]);
    const { create } = await prepareRelayTokenCreate("owner", data, prepare);
    expect(prepare.quotaWindows).toHaveBeenCalledExactlyOnceWith(data.quotaWindows);
    expect(prepare.ipWhitelist).toHaveBeenCalledExactlyOnceWith(data.ipWhitelist);
    expect(prepare.requestFormatTransforms).toHaveBeenCalledExactlyOnceWith(data.requestFormatTransforms);
    expect(prepare.normalizerConfig).toHaveBeenCalledExactlyOnceWith(data.normalizerConfig);
    expect(create).toMatchObject({
      quotaWindows: data.quotaWindows,
      ipWhitelist: "normalized-ip",
      requestFormatTransforms: [],
      normalizerConfig: { enabled: true },
    });
  });
  it("does not let one prepared token mutate the default normalizer settings of another", async () => {
    const first = (await prepareRelayTokenCreate("owner", {}, callbacks())).create.normalizerConfig!;
    first.textOnlyModelIds.push("fixture-local-only");
    expect((await prepareRelayTokenCreate("owner", {}, callbacks())).create.normalizerConfig).toEqual(
      DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG,
    );
    expect(DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG.textOnlyModelIds).toEqual([]);
  });
});
