import { describe, expect, it, vi } from "vitest";
import type { UpdateRelayTokenDto } from "@/api/dto/relay/relay.dto";
import {
  prepareRelayTokenUpdate,
  type RelayTokenUpdatePreparation,
  type RelayTokenUpdateSource,
} from "@/services/relay/relay-token-update-preparation";
import { BadRequestError } from "@/util/errors";

const source: RelayTokenUpdateSource = { routingMode: "ordered", channelId: "primary" };
const failover = {
  enabled: true,
  maxRetries: 1,
  retryStatusCodes: ["503"],
  failoverThreshold: 0,
  failbackCooldownMinutes: 0,
};
function callbacks() {
  return {
    orderedChannels: vi.fn<RelayTokenUpdatePreparation["orderedChannels"]>().mockResolvedValue({
      defaultChannelId: "fallback",
      channelConfigs: [{ channelId: "fallback", priority: 0 }],
    }),
    automaticPool: vi.fn<RelayTokenUpdatePreparation["automaticPool"]>().mockResolvedValue(["blocked"]),
    customCredential: vi.fn<RelayTokenUpdatePreparation["customCredential"]>().mockResolvedValue("canonical-value"),
    expiresAt: vi.fn<RelayTokenUpdatePreparation["expiresAt"]>().mockReturnValue(undefined),
    quotaWindows: vi.fn<RelayTokenUpdatePreparation["quotaWindows"]>().mockReturnValue([]),
    ipWhitelist: vi.fn<RelayTokenUpdatePreparation["ipWhitelist"]>().mockReturnValue(null),
    requestFormatTransforms: vi.fn<RelayTokenUpdatePreparation["requestFormatTransforms"]>().mockReturnValue(null),
    normalizerConfig: vi.fn<RelayTokenUpdatePreparation["normalizerConfig"]>().mockReturnValue(null),
    compositeFailover: vi.fn<RelayTokenUpdatePreparation["compositeFailover"]>().mockReturnValue(failover),
  };
}
describe("prepareRelayTokenUpdate", () => {
  it("preserves an omitted patch and never invokes unrelated preparation", async () => {
    const prepare = callbacks();
    const { update, requiresGraphLock } = await prepareRelayTokenUpdate(source, {}, prepare);
    expect(Object.values(update).every((value) => value === undefined)).toBe(true);
    expect(update).not.toHaveProperty("token");
    expect(update).not.toHaveProperty("legacyToken");
    expect(requiresGraphLock).toBe(false);
    for (const callback of Object.values(prepare)) expect(callback).not.toHaveBeenCalled();
  });
  it.each([null, "", "   "])("clears explicit nullable strings %j without clearing omitted fields", async (value) => {
    const { update } = await prepareRelayTokenUpdate(source, { name: value, allowedModels: value }, callbacks());
    expect(update.name).toBeNull();
    expect(update.allowedModels).toBeNull();
    expect(update.quotaLimit).toBeUndefined();
    expect(update.modelMapping).toBeUndefined();
  });
  it("retains explicit zero, null, empty arrays and callback-normalized clear operations", async () => {
    const prepare = callbacks();
    const { update } = await prepareRelayTokenUpdate(
      source,
      {
        name: "  renamed  ",
        allowedModels: " model ",
        expiresAt: null,
        quotaLimit: 0,
        quotaWindows: [],
        ipWhitelist: null,
        modelMapping: null,
        requestFormatTransforms: null,
        normalizerConfig: null,
        contentSafetyConfig: null,
        streamConfig: null,
      },
      prepare,
    );
    expect(update).toMatchObject({
      name: "renamed",
      allowedModels: "model",
      expiresAt: null,
      quotaLimit: 0,
      quotaWindows: [],
      ipWhitelist: null,
      modelMapping: null,
      requestFormatTransforms: null,
      normalizerConfig: null,
      contentSafetyConfig: null,
      streamConfig: null,
    });
    for (const key of [
      "expiresAt",
      "quotaWindows",
      "ipWhitelist",
      "requestFormatTransforms",
      "normalizerConfig",
    ] as const) {
      expect(prepare[key]).toHaveBeenCalledExactlyOnceWith(key === "quotaWindows" ? [] : null);
    }
    expect(prepare.orderedChannels).not.toHaveBeenCalled();
  });
  it("uses normalized expiry, quota and request configuration values", async () => {
    const prepare = callbacks();
    const expires = new Date("2030-01-01T00:00:00Z");
    const windows: NonNullable<UpdateRelayTokenDto["quotaWindows"]> = [
      { quotaLimit: 1, quotaUnit: "request", quotaWindowHours: 1 },
    ];
    prepare.expiresAt.mockReturnValue(expires);
    prepare.quotaWindows.mockReturnValue(windows);
    prepare.ipWhitelist.mockReturnValue("127.0.0.1");
    const mapping = { before: "after" };
    const { update } = await prepareRelayTokenUpdate(
      source,
      {
        expiresAt: expires.toISOString(),
        quotaLimit: null,
        quotaWindows: windows,
        ipWhitelist: " 127.0.0.1 ",
        modelMapping: mapping,
      },
      prepare,
    );
    expect(update.expiresAt).toBe(expires);
    expect(update.quotaWindows).toBe(windows);
    expect(update.ipWhitelist).toBe("127.0.0.1");
    expect(update.modelMapping).toBe(mapping);
    expect(update.quotaLimit).toBeNull();
  });
  it.each<UpdateRelayTokenDto>([{ channelId: "next" }, { channelConfigs: [] }, { routingMode: "ordered" }])(
    "normalizes routing patches %j including fallback-only changes",
    async (data) => {
      const prepare = callbacks();
      const { update } = await prepareRelayTokenUpdate(source, data, prepare);
      expect(prepare.orderedChannels).toHaveBeenCalledExactlyOnceWith(data.channelId ?? "primary", data.channelConfigs);
      expect(update.channelId).toBe("fallback");
      expect(update.channelConfigs).toEqual([{ channelId: "fallback", priority: 0 }]);
    },
  );
  it("keeps the entire normalized ordered list and priorities without mutating input", async () => {
    const prepare = callbacks();
    const configs = [
      { channelId: "a", priority: 5 },
      { channelId: "b", priority: 10 },
    ];
    prepare.orderedChannels.mockResolvedValue({ defaultChannelId: "a", channelConfigs: configs });
    const data = Object.freeze({ channelConfigs: Object.freeze(configs) as typeof configs });
    const { update } = await prepareRelayTokenUpdate(source, data, prepare);
    expect(update.channelConfigs).toBe(configs);
    expect(data.channelConfigs).toEqual(configs);
  });
  it("validates an automatic pool and retains its normalized blocked members", async () => {
    const prepare = callbacks();
    const { update } = await prepareRelayTokenUpdate(
      source,
      {
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "pool",
        blockedAutomaticProxyPoolChannelIds: ["raw"],
      },
      prepare,
    );
    expect(prepare.automaticPool).toHaveBeenCalledExactlyOnceWith("pool", ["raw"]);
    expect(update).toMatchObject({
      channelId: null,
      channelConfigs: [],
      automaticProxyPoolChannelId: "pool",
      blockedAutomaticProxyPoolChannelIds: ["blocked"],
      routingMode: "automatic-pool",
    });
    expect(prepare.orderedChannels).not.toHaveBeenCalled();
  });
  it("does not reinterpret an automatic source when no mode is supplied", async () => {
    const prepare = callbacks();
    const { update } = await prepareRelayTokenUpdate(
      { routingMode: "automatic-pool", channelId: null },
      { name: "new" },
      prepare,
    );
    expect(update.automaticProxyPoolChannelId).toBeUndefined();
    expect(update.blockedAutomaticProxyPoolChannelIds).toBeUndefined();
    expect(prepare.automaticPool).not.toHaveBeenCalled();
  });
  it("clears the automatic selection when switching back to ordered", async () => {
    const { update } = await prepareRelayTokenUpdate(
      { routingMode: "automatic-pool", channelId: null },
      { routingMode: "ordered", channelId: "next" },
      callbacks(),
    );
    expect(update.automaticProxyPoolChannelId).toBeNull();
    expect(update.blockedAutomaticProxyPoolChannelIds).toEqual([]);
  });
  it("prepares conversion into composite under the graph lock with default failover", async () => {
    const prepare = callbacks();
    const members = [{ tokenId: "member", priority: 0, enabled: true }];
    const { update, requiresGraphLock } = await prepareRelayTokenUpdate(
      source,
      { routingMode: "composite", memberTokenConfigs: members },
      prepare,
    );
    expect(requiresGraphLock).toBe(true);
    expect(update).toMatchObject({
      channelId: null,
      channelConfigs: [],
      automaticProxyPoolChannelId: null,
      memberTokenConfigs: members,
      failoverConfig: failover,
    });
    expect(prepare.compositeFailover).toHaveBeenCalledExactlyOnceWith(1);
    expect(prepare.orderedChannels).not.toHaveBeenCalled();
  });
  it("preserves explicit composite failover", async () => {
    const prepare = callbacks();
    const explicit = { ...failover, enabled: false };
    const { update } = await prepareRelayTokenUpdate(
      source,
      { routingMode: "composite", failoverConfig: explicit },
      prepare,
    );
    expect(update.failoverConfig).toBe(explicit);
    expect(prepare.compositeFailover).not.toHaveBeenCalled();
  });
  it.each<UpdateRelayTokenDto>([
    { memberTokenConfigs: [{ tokenId: "member", priority: 0, enabled: true }] },
    { routingMode: "composite", channelId: "channel" },
    { routingMode: "composite", channelConfigs: [{ channelId: "channel", priority: 0 }] },
    { routingMode: "composite", automaticProxyPoolChannelId: "pool" },
  ])("rejects conflicting graph and channel modes %j", async (data) => {
    const prepare = callbacks();
    await expect(prepareRelayTokenUpdate(source, data, prepare)).rejects.toBeInstanceOf(BadRequestError);
    expect(prepare.customCredential).not.toHaveBeenCalled();
    expect(prepare.orderedChannels).not.toHaveBeenCalled();
  });
  it.each<UpdateRelayTokenDto>([{}, { name: "rename" }, { routingMode: "ordered" }])(
    "preserves the existing prohibition on updating composite sources %j",
    async (data) => {
      await expect(
        prepareRelayTokenUpdate({ routingMode: "composite", channelId: null }, data, callbacks()),
      ).rejects.toBeInstanceOf(BadRequestError);
    },
  );
  it.each(["alias", "canonical-value"])(
    "prepares custom credential %s once and retains its alias",
    async (preferred) => {
      const prepare = callbacks();
      const { update } = await prepareRelayTokenUpdate(source, { token: preferred }, prepare);
      expect(prepare.customCredential).toHaveBeenCalledExactlyOnceWith(preferred);
      expect(update).toMatchObject({
        token: "canonical-value",
        legacyToken: preferred === "alias" ? preferred : null,
        isCustomKey: true,
      });
    },
  );
  it("does not generate a credential for an empty explicit value", async () => {
    const prepare = callbacks();
    const { update } = await prepareRelayTokenUpdate(source, { token: "" }, prepare);
    expect(update).toHaveProperty("legacyToken", null);
    expect(update.token).toBeUndefined();
    expect(update.isCustomKey).toBeUndefined();
    expect(prepare.customCredential).not.toHaveBeenCalled();
  });
  it.each(["orderedChannels", "automaticPool", "customCredential"] as const)(
    "propagates %s failure without producing a write patch",
    async (key) => {
      const prepare = callbacks();
      const error = new Error("preparation denied");
      prepare[key].mockRejectedValue(error);
      const data: UpdateRelayTokenDto =
        key === "orderedChannels"
          ? { channelId: "next" }
          : key === "automaticPool"
            ? { routingMode: "automatic-pool", automaticProxyPoolChannelId: "pool" }
            : { token: "alias" };
      await expect(prepareRelayTokenUpdate(source, data, prepare)).rejects.toBe(error);
    },
  );
});
