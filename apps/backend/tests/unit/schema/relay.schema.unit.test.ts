import { describe, expect, it } from "vitest";
import {
  createRelayTokenBodySchema,
  importRelayTokensBodySchema,
  updateRelayTokenBodySchema,
} from "../../../src/api/schema/relay/relay.schema";
import {
  relayChannelManagementQuerySchema,
  updateRelayChannelServiceStatusBodySchema,
} from "../../../src/api/schema/relay/relay-channel.schema";

describe("relay token import schema", () => {
  it("preserves false for the management enabled query filter", () => {
    expect(relayChannelManagementQuerySchema.parse({ enabled: "false" }).enabled).toBe(false);
    expect(relayChannelManagementQuerySchema.parse({ enabled: "true" }).enabled).toBe(true);
  });

  it("preserves false when parsing a provider service status update", () => {
    expect(updateRelayChannelServiceStatusBodySchema.parse({ enabled: "false" }).enabled).toBe(false);
    expect(updateRelayChannelServiceStatusBodySchema.parse({ enabled: "true" }).enabled).toBe(true);
  });

  it("validates the automatic pool multiplier limit across token operations", () => {
    const failoverConfig = {
      enabled: false,
      maxRetries: 0,
      retryStatusCodes: [],
      failoverThreshold: 0,
      failbackCooldownMinutes: 0,
      maxAcceptedChannelMultiplier: 2.5,
    };

    expect(
      createRelayTokenBodySchema.parse({
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "automatic-pool-1",
        failoverConfig,
      }).failoverConfig?.maxAcceptedChannelMultiplier,
    ).toBe(2.5);
    expect(updateRelayTokenBodySchema.parse({ failoverConfig }).failoverConfig?.maxAcceptedChannelMultiplier).toBe(2.5);
    expect(
      importRelayTokensBodySchema.parse({
        tokens: [{ routingMode: "automatic-pool", automaticProxyPoolChannelId: "pool-1", failoverConfig }],
      }).tokens[0]?.failoverConfig?.maxAcceptedChannelMultiplier,
    ).toBe(2.5);
    expect(
      createRelayTokenBodySchema.parse({
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "automatic-pool-1",
        failoverConfig: { ...failoverConfig, maxAcceptedChannelMultiplier: null },
      }).failoverConfig?.maxAcceptedChannelMultiplier,
    ).toBeNull();
  });

  it("rejects invalid automatic pool multiplier limits", () => {
    const base = {
      routingMode: "automatic-pool" as const,
      automaticProxyPoolChannelId: "automatic-pool-1",
      failoverConfig: {
        enabled: false,
        maxRetries: 0,
        retryStatusCodes: [],
        failoverThreshold: 0,
        failbackCooldownMinutes: 0,
      },
    };

    expect(() =>
      createRelayTokenBodySchema.parse({
        ...base,
        failoverConfig: { ...base.failoverConfig, maxAcceptedChannelMultiplier: 0 },
      }),
    ).toThrow();
    expect(() =>
      createRelayTokenBodySchema.parse({
        ...base,
        failoverConfig: { ...base.failoverConfig, maxAcceptedChannelMultiplier: 100.000001 },
      }),
    ).toThrow();
    expect(() =>
      createRelayTokenBodySchema.parse({
        ...base,
        failoverConfig: { ...base.failoverConfig, maxAcceptedChannelMultiplier: 1.0000001 },
      }),
    ).toThrow("maxAcceptedChannelMultiplier must have at most 6 decimal places");
  });

  it("preserves token model mappings", () => {
    const parsed = importRelayTokensBodySchema.parse({
      tokens: [
        {
          name: "Imported",
          channelId: "channel-1",
          modelMapping: {
            "gpt-4o": "upstream-gpt-4o",
          },
        },
      ],
    });

    expect(parsed.tokens[0]?.modelMapping).toEqual({
      "gpt-4o": "upstream-gpt-4o",
    });
  });

  it("preserves an explicitly empty model mapping", () => {
    const parsed = importRelayTokensBodySchema.parse({
      tokens: [{ name: "Imported", channelId: "channel-1", modelMapping: {} }],
    });

    expect(parsed.tokens[0]).toHaveProperty("modelMapping");
    expect(parsed.tokens[0]?.modelMapping).toEqual({});
  });

  it("accepts automatic routing only with an automatic proxy pool and no ordered channels", () => {
    expect(
      createRelayTokenBodySchema.parse({
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "automatic-pool-1",
      }),
    ).toMatchObject({ routingMode: "automatic-pool", automaticProxyPoolChannelId: "automatic-pool-1" });

    expect(() => createRelayTokenBodySchema.parse({ routingMode: "automatic-pool" })).toThrow(
      "automaticProxyPoolChannelId is required",
    );
    expect(() =>
      createRelayTokenBodySchema.parse({
        routingMode: "automatic-pool",
        automaticProxyPoolChannelId: "automatic-pool-1",
        channelId: "ordered-channel",
      }),
    ).toThrow("automatic pool mode cannot include ordered channels");
  });

  it("imports automatic routing only with an automatic proxy pool and no ordered channels", () => {
    expect(
      importRelayTokensBodySchema.parse({
        tokens: [
          {
            name: "Automatic Import",
            routingMode: "automatic-pool",
            automaticProxyPoolChannelId: "automatic-pool-1",
          },
        ],
      }),
    ).toMatchObject({
      tokens: [{ routingMode: "automatic-pool", automaticProxyPoolChannelId: "automatic-pool-1" }],
    });

    expect(() =>
      importRelayTokensBodySchema.parse({ tokens: [{ name: "Automatic Import", routingMode: "automatic-pool" }] }),
    ).toThrow("automaticProxyPoolChannelId is required");
    expect(() =>
      importRelayTokensBodySchema.parse({
        tokens: [
          {
            name: "Automatic Import",
            routingMode: "automatic-pool",
            automaticProxyPoolChannelId: "automatic-pool-1",
            channelId: "ordered-channel",
          },
        ],
      }),
    ).toThrow("automatic pool mode cannot include ordered channels");
  });

  it("rejects updates that switch to automatic routing without a pool", () => {
    expect(() => updateRelayTokenBodySchema.parse({ routingMode: "automatic-pool" })).toThrow(
      "automaticProxyPoolChannelId is required",
    );
  });

  it("rejects automatic pool fields in ordered routing", () => {
    expect(() =>
      createRelayTokenBodySchema.parse({
        routingMode: "ordered",
        automaticProxyPoolChannelId: "automatic-pool-1",
        channelId: "channel-1",
      }),
    ).toThrow("automaticProxyPoolChannelId can only be used in automatic pool mode");

    expect(() =>
      updateRelayTokenBodySchema.parse({
        routingMode: "ordered",
        automaticProxyPoolChannelId: "automatic-pool-1",
      }),
    ).toThrow("automaticProxyPoolChannelId can only be used in automatic pool mode");

    expect(() =>
      importRelayTokensBodySchema.parse({
        tokens: [
          {
            routingMode: "ordered",
            automaticProxyPoolChannelId: "automatic-pool-1",
            channelId: "channel-1",
          },
        ],
      }),
    ).toThrow("automaticProxyPoolChannelId can only be used in automatic pool mode");

    expect(() =>
      createRelayTokenBodySchema.parse({
        routingMode: "ordered",
        channelId: "channel-1",
        blockedAutomaticProxyPoolChannelIds: ["channel-2"],
      }),
    ).toThrow("blockedAutomaticProxyPoolChannelIds can only be used in automatic pool mode");
  });

  it("accepts blocked automatic pool member IDs for create, update, and import", () => {
    const input = {
      routingMode: "automatic-pool" as const,
      automaticProxyPoolChannelId: "automatic-pool-1",
      blockedAutomaticProxyPoolChannelIds: ["member-1", "member-2"],
    };

    expect(createRelayTokenBodySchema.parse(input).blockedAutomaticProxyPoolChannelIds).toEqual([
      "member-1",
      "member-2",
    ]);
    expect(updateRelayTokenBodySchema.parse(input).blockedAutomaticProxyPoolChannelIds).toEqual([
      "member-1",
      "member-2",
    ]);
    expect(
      importRelayTokensBodySchema.parse({ tokens: [input] }).tokens[0]?.blockedAutomaticProxyPoolChannelIds,
    ).toEqual(["member-1", "member-2"]);
  });
});
