import { describe, expect, it } from "vitest";
import { consumeRelayStreamUsageLine, RelayStreamUsageTracker } from "@/util/relay";

describe("relay-stream-usage util", () => {
  it("tracks OpenAI usage and resolves fresh input tokens", () => {
    const tracker = new RelayStreamUsageTracker(20, true);

    tracker.apply({
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
      prompt_tokens_details: { cached_tokens: 2 },
    });

    expect(tracker.normalized()).toMatchObject({
      requestTokens: 10,
      responseTokens: 4,
      totalTokens: 14,
    });
    expect(tracker.cacheReadTokens).toBe(2);
    expect(tracker.hasExplicitInputTokens).toBe(true);
  });

  it("keeps estimated input when usage only reports zero output", () => {
    const tracker = new RelayStreamUsageTracker(20, true);

    tracker.apply({ prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 });

    expect(tracker.normalized()).toMatchObject({
      requestTokens: 20,
      responseTokens: 0,
      totalTokens: 20,
    });
  });

  it("supports Gemini usage metadata and cache fields", () => {
    const tracker = new RelayStreamUsageTracker(8, false);

    tracker.apply({ promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8, cachedContentTokenCount: 1 });

    expect(tracker.snapshot()).toEqual({
      requestTokens: 3,
      responseTokens: 5,
      totalTokens: 8,
      cacheCreationTokens: 0,
      cacheReadTokens: 1,
      hasExplicitInputTokens: true,
    });
  });

  it("consumes SSE usage and visible output through one parser", () => {
    const tracker = new RelayStreamUsageTracker(4, true);
    let visible = false;

    consumeRelayStreamUsageLine(
      'data: {"choices":[{"delta":{"content":"hello"}}],"usage":{"prompt_tokens":4,"completion_tokens":1}}',
      "openai",
      tracker,
      () => {
        visible = true;
      },
    );

    expect(visible).toBe(true);
    expect(tracker.normalized()).toMatchObject({ requestTokens: 4, responseTokens: 1, totalTokens: 5 });
  });
});
