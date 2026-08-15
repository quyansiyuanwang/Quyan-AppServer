import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { AIProviderService } from "../../../src/services/chat/ai-provider.service";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
  },
}));

function createAsyncChunkStream(chunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield Buffer.from(chunk);
    },
  };
}

async function collectChunks(iterator: AsyncGenerator<any>) {
  const output: any[] = [];
  for await (const item of iterator) output.push(item);
  return output;
}

describe("AIProviderService", () => {
  const mockedPost = vi.mocked(axios.post);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects provider by model prefix", () => {
    const service = AIProviderService.getInstance();

    expect(service.getProvider("gpt-4o-mini")).toBe("openai");
    expect(service.getProvider("o1-mini")).toBe("openai");
    expect(service.getProvider("claude-3-5-sonnet")).toBe("anthropic");
    expect(service.getProvider("gemini-2.0-flash")).toBe("gemini");
    expect(service.getProvider("unknown-model")).toBe("openai");
  });

  it("streams anthropic chunks and emits done metrics", async () => {
    mockedPost.mockResolvedValue({
      data: createAsyncChunkStream([
        'data: {"type":"content_block_delta","delta":{"text":"Hel"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"text":"lo"}}\n\n',
        'data: {"type":"message_stop","message":{"usage":{"input_tokens":12,"output_tokens":5}}}\n\n',
      ]),
    } as any);

    const service = AIProviderService.getInstance();
    const chunks = await collectChunks(
      service.streamChat([], "claude-3-5-sonnet", "test-key", "https://upstream.example.com"),
    );

    expect(chunks[0]).toEqual({ content: "Hel", done: false });
    expect(chunks[1]).toEqual({ content: "lo", done: false });
    expect(chunks.at(-1)?.done).toBe(true);
    expect(chunks.at(-1)?.inputTokens).toBe(12);
    expect(chunks.at(-1)?.outputTokens).toBe(5);

    expect(mockedPost).toHaveBeenCalledWith(
      "https://upstream.example.com/v1/messages",
      expect.objectContaining({ model: "claude-3-5-sonnet", stream: true }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "x-api-key": "test-key",
          "anthropic-version": "2023-06-01",
        }),
        responseType: "stream",
      }),
    );
  });

  it("streams openai chunks and emits done metrics on [DONE]", async () => {
    mockedPost.mockResolvedValue({
      data: createAsyncChunkStream([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    } as any);

    const service = AIProviderService.getInstance();
    const chunks = await collectChunks(
      service.streamChat(
        [{ role: "user", content: "say hello" }],
        "gpt-4o-mini",
        "test-key",
        "https://upstream.example.com",
      ),
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ content: "Hel", done: false });
    expect(chunks[1]).toEqual({ content: "lo", done: false });
    expect(chunks[2].done).toBe(true);
    expect(chunks[2].inputTokens).toBeGreaterThan(0);
    expect(chunks[2].outputTokens).toBeGreaterThan(0);
    expect(chunks[2].isStreaming).toBe(true);

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      "https://upstream.example.com/chat/completions",
      expect.objectContaining({ stream: true, stream_options: { include_usage: true } }),
      expect.objectContaining({ headers: { Authorization: "Bearer test-key" }, responseType: "stream" }),
    );
  });

  it("passes the configured output-token cap to OpenAI-compatible upstreams", async () => {
    mockedPost.mockResolvedValue({
      data: createAsyncChunkStream(["data: [DONE]\\n\\n"]),
    } as any);

    const service = AIProviderService.getInstance();
    await collectChunks(
      service.streamChat(
        [{ role: "user", content: "Keep this short" }],
        "gpt-4o-mini",
        "test-key",
        "https://upstream.example.com",
        undefined,
        undefined,
        { maxOutputTokens: 256 },
      ),
    );

    expect(mockedPost).toHaveBeenCalledWith(
      "https://upstream.example.com/chat/completions",
      expect.objectContaining({ max_tokens: 256 }),
      expect.anything(),
    );
  });

  it("retries without stream_options on 400/422 and uses usage metrics", async () => {
    mockedPost
      .mockRejectedValueOnce(Object.assign(new Error("Bad Request"), { response: { status: 400 } }))
      .mockResolvedValueOnce({
        data: createAsyncChunkStream([
          'data: {"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18,"cache_creation_input_tokens":2,"cache_read_input_tokens":3}}\n\n',
          "data: [DONE]\n\n",
        ]),
      } as any);

    const service = AIProviderService.getInstance();
    const chunks = await collectChunks(
      service.streamChat(
        [{ role: "user", content: "usage please" }],
        "gpt-4o-mini",
        "test-key",
        "https://upstream.example.com",
      ),
    );

    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect((mockedPost.mock.calls[1]?.[1] as any).stream_options).toBeUndefined();

    const doneChunk = chunks.at(-1);
    expect(doneChunk?.done).toBe(true);
    expect(doneChunk?.inputTokens).toBe(11);
    expect(doneChunk?.outputTokens).toBe(7);
    expect(doneChunk?.cacheCreationTokens).toBe(2);
    expect(doneChunk?.cacheReadTokens).toBe(3);
  });

  it("emits done chunk when upstream stream ends without [DONE]", async () => {
    mockedPost.mockResolvedValue({
      data: createAsyncChunkStream(['data: {"choices":[{"delta":{"content":"abc"}}]}\n\n']),
    } as any);

    const service = AIProviderService.getInstance();
    const chunks = await collectChunks(
      service.streamChat(
        [{ role: "user", content: "end without done" }],
        "gpt-4o-mini",
        "test-key",
        "https://upstream.example.com",
      ),
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ content: "abc", done: false });
    expect(chunks[1].done).toBe(true);
    expect(chunks[1].outputTokens).toBeGreaterThan(0);
  });

  it("parses OpenAI responses-style stream events and usage", async () => {
    mockedPost.mockResolvedValue({
      data: createAsyncChunkStream([
        'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
        'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":9,"output_tokens":4,"total_tokens":13}}}\n\n',
        "data: [DONE]\n\n",
      ]),
    } as any);

    const service = AIProviderService.getInstance();
    const chunks = await collectChunks(
      service.streamChat(
        [{ role: "user", content: "say hello" }],
        "gpt-5.4",
        "test-key",
        "https://upstream.example.com",
      ),
    );

    expect(chunks[0]).toEqual({ content: "Hel", done: false });
    expect(chunks[1]).toEqual({ content: "lo", done: false });
    expect(chunks.at(-1)?.done).toBe(true);
    expect(chunks.at(-1)?.inputTokens).toBe(9);
    expect(chunks.at(-1)?.outputTokens).toBe(4);
  });

  it("parses responses-style stream events with nested delta objects", async () => {
    mockedPost.mockResolvedValue({
      data: createAsyncChunkStream([
        'data: {"type":"response.output_text.delta","delta":{"text":"Hel"}}\n\n',
        'data: {"type":"response.output_text.delta","delta":{"content":[{"text":"lo"}]}}\n\n',
        "data: [DONE]\n\n",
      ]),
    } as any);

    const service = AIProviderService.getInstance();
    const chunks = await collectChunks(
      service.streamChat(
        [{ role: "user", content: "say hello" }],
        "gpt-5.4",
        "test-key",
        "https://upstream.example.com",
      ),
    );

    expect(chunks[0]).toEqual({ content: "Hel", done: false });
    expect(chunks[1]).toEqual({ content: "lo", done: false });
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it("handles responses-style events split across chunk boundaries", async () => {
    mockedPost.mockResolvedValue({
      data: createAsyncChunkStream([
        'data: {"type":"response.output_text.delta","delta":"Hel"}\n\nda',
        'ta: {"type":"response.output_text.delta","delta":"lo"}\n\n',
        "data: [DONE]\n\n",
      ]),
    } as any);

    const service = AIProviderService.getInstance();
    const chunks = await collectChunks(
      service.streamChat(
        [{ role: "user", content: "say hello" }],
        "codex-mini-latest",
        "test-key",
        "https://upstream.example.com",
      ),
    );

    expect(chunks[0]).toEqual({ content: "Hel", done: false });
    expect(chunks[1]).toEqual({ content: "lo", done: false });
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it("falls back to responses delta when completion delta is empty", async () => {
    mockedPost.mockResolvedValue({
      data: createAsyncChunkStream([
        'data: {"choices":[{"delta":{"content":""}}],"type":"response.output_text.delta","delta":"Codex"}\n\n',
        "data: [DONE]\n\n",
      ]),
    } as any);

    const service = AIProviderService.getInstance();
    const chunks = await collectChunks(
      service.streamChat(
        [{ role: "user", content: "test" }],
        "codex-mini-latest",
        "test-key",
        "https://upstream.example.com",
      ),
    );

    expect(chunks[0]).toEqual({ content: "Codex", done: false });
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it("emits completed Responses output when the upstream omitted delta frames", async () => {
    mockedPost.mockResolvedValue({
      data: createAsyncChunkStream([
        'data: {"type":"response.completed","response":{"output":[{"content":[{"type":"output_text","text":"answer"}]}],"usage":{"input_tokens":8,"output_tokens":2,"total_tokens":10}}}\n\n',
        "data: [DONE]\n\n",
      ]),
    } as any);

    const service = AIProviderService.getInstance();
    const chunks = await collectChunks(
      service.streamChat(
        [{ role: "user", content: "hello" }],
        "gpt-5.6-luna",
        "test-key",
        "https://upstream.example.com",
      ),
    );

    expect(chunks).toContainEqual({ content: "answer", done: false });
    expect(chunks.at(-1)).toMatchObject({ done: true, inputTokens: 8, outputTokens: 2 });
  });
});
