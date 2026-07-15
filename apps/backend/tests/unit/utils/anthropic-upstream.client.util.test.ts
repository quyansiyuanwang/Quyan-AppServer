import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { BadRequestError } from "@/util/errors";
import { AnthropicUpstreamClient, type AnthropicMessagesRequest } from "@/util/anthropic-upstream.client";

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();

  return {
    ...actual,
    default: {
      ...actual.default,
      post: vi.fn(),
    },
  };
});

describe("AnthropicUpstreamClient", () => {
  const mockedPost = vi.mocked(axios.post);

  const requestBody: AnthropicMessagesRequest = {
    model: "claude-3-5-sonnet",
    max_tokens: 128,
    messages: [{ role: "user", content: "Hello" }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
  });

  it("builds request from resolved upstream config and returns upstream response", async () => {
    const upstreamData = {
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hi" }],
      model: "claude-3-5-sonnet",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    };

    mockedPost.mockResolvedValue({ status: 200, data: upstreamData } as any);

    const client = new AnthropicUpstreamClient({
      baseUrl: "https://anthropic.example.com///",
      apiKey: "channel-key",
    });
    const result = await client.messages(requestBody);

    expect(result).toEqual(upstreamData);
    expect(mockedPost).toHaveBeenCalledWith(
      "https://anthropic.example.com/v1/messages",
      requestBody,
      expect.objectContaining({
        headers: expect.objectContaining({
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          Authorization: "Bearer channel-key",
          "x-api-key": "channel-key",
        }),
      }),
    );

    const options = mockedPost.mock.calls[0][2] as { validateStatus: (status: number) => boolean };
    expect(options.validateStatus(500)).toBe(true);
  });

  it("throws when api key is missing in both config and environment", async () => {
    const client = new AnthropicUpstreamClient();

    await expect(client.messages(requestBody)).rejects.toThrow(BadRequestError);
    await expect(client.messages(requestBody)).rejects.toThrow("Anthropic API key not configured");
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("uses the default Anthropic base URL with an environment API key", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    mockedPost.mockResolvedValue({ status: 200, data: { content: [], usage: {} } } as any);

    const client = new AnthropicUpstreamClient();

    await client.messages(requestBody);
    expect(mockedPost).toHaveBeenCalledWith("https://api.anthropic.com/v1/messages", requestBody, expect.any(Object));
  });

  it("throws BadRequestError when upstream status is not 200", async () => {
    mockedPost.mockResolvedValue({ status: 429, data: { error: "rate limit" } } as any);

    const client = new AnthropicUpstreamClient({
      baseUrl: "https://anthropic.example.com",
      apiKey: "channel-key",
    });

    await expect(client.messages(requestBody)).rejects.toThrow("AI service error: 429");
  });
});
