import { describe, expect, it } from "vitest";
import { importRelayTokensBodySchema } from "../../../src/api/schema/relay/relay.schema";

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
});
