import { describe, expect, it } from "vitest";
import {
  createRelayTokenBodySchema,
  importRelayTokensBodySchema,
  updateRelayTokenBodySchema,
} from "../../../src/api/schema/relay/relay.schema";

describe("relay token import schema", () => {
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
