import { afterEach, describe, expect, it } from "vitest";
import { createRelayAIMockPlugin, RelayAIMockPlugin } from "../../util/relay-ai-mock-plugin";

describe("relay-ai-mock-plugin", () => {
  let plugin: RelayAIMockPlugin | null = null;

  afterEach(async () => {
    if (plugin) await plugin.stop();
    plugin = null;
  });

  it("mocks openai chat completions with simulated output", async () => {
    plugin = createRelayAIMockPlugin({
      defaultModel: "mock-openai-model",
      contentPrefix: "模拟AI输出-",
    });
    await plugin.start();

    const response = await fetch(`${plugin.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "custom-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(response.status).toBe(200);

    const data = (await response.json()) as any;
    expect(data.model).toBe("custom-model");
    expect(data.choices?.[0]?.message?.content).toContain("模拟AI输出-");
    expect(data.usage?.total_tokens).toBeGreaterThan(0);
  });

  it("streams openai chat completions with usage and done marker", async () => {
    plugin = createRelayAIMockPlugin({ defaultModel: "stream-openai-model" });
    await plugin.start();

    const response = await fetch(`${plugin.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "stream-chat-model",
        stream: true,
        messages: [{ role: "user", content: "stream please" }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain('"usage"');
    expect(text).toContain("data: [DONE]");
  });

  it("streams openai responses endpoint with response.completed event", async () => {
    plugin = createRelayAIMockPlugin({ defaultModel: "stream-responses-model" });
    await plugin.start();

    const response = await fetch(`${plugin.baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "stream-responses-model",
        stream: true,
        input: "hello",
      }),
    });

    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toContain("response.completed");
    expect(text).toContain("input_tokens");
    expect(text).toContain("data: [DONE]");
  });

  it("supports gemini style endpoint and usage metadata", async () => {
    plugin = createRelayAIMockPlugin({ defaultModel: "gemini-mock" });
    await plugin.start();

    const response = await fetch(`${plugin.baseUrl}/v1/models/gemini-2.0-flash:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "hello" }] }],
      }),
    });

    expect(response.status).toBe(200);

    const data = (await response.json()) as any;
    expect(data.candidates?.[0]?.content?.parts?.[0]?.text).toBeTruthy();
    expect(data.usageMetadata?.totalTokenCount).toBeGreaterThan(0);
  });

  it("supports gemini stream endpoint with newline-delimited json chunks", async () => {
    plugin = createRelayAIMockPlugin({ defaultModel: "gemini-stream-mock" });
    await plugin.start();

    const response = await fetch(`${plugin.baseUrl}/v1/models/gemini-2.0-flash:streamGenerateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "stream hello" }] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    const jsonLines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any);

    expect(jsonLines.length).toBeGreaterThanOrEqual(2);
    expect(jsonLines.at(-1)?.usageMetadata?.totalTokenCount).toBeGreaterThan(0);
  });

  it("allows custom openai handler override", async () => {
    plugin = createRelayAIMockPlugin();
    plugin.useOpenAI(async (ctx) => {
      return {
        status: 201,
        body: {
          ok: true,
          path: ctx.pathname,
          model: ctx.model,
        },
      };
    });

    await plugin.start();

    const response = await fetch(`${plugin.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "handler-model" }),
    });

    expect(response.status).toBe(201);
    const data = (await response.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.path).toBe("/chat/completions");
    expect(data.model).toBe("handler-model");
  });
});
