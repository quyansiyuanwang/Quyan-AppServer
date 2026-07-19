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
    expect(() => createRelayTokenBodySchema.parse({
      routingMode: "automatic-pool",
      automaticProxyPoolChannelId: "automatic-pool-1",
      channelId: "ordered-channel",
    })).toThrow("automatic pool mode cannot include ordered channels");
  });

  it("rejects updates that switch to automatic routing without a pool", () => {
    expect(() => updateRelayTokenBodySchema.parse({ routingMode: "automatic-pool" })).toThrow(
      "automaticProxyPoolChannelId is required",
    );
  });
});
