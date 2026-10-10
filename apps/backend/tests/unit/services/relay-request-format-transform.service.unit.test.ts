import { publishTestAIResources } from "../../util/ai-resource-config";
import { env } from "@/config/env";
import { afterEach, describe, expect, it } from "vitest";
import {
  convertRelayRequest,
  RelayFormatTransformError,
  RelaySseFormatTransform,
} from "../../../src/services/relay/relay-request-format-transform.service";

describe("relay request format conversion", () => {
  const originalStreaming = { ...env.aiResources.streaming };
  afterEach(() => {
    Object.assign(env.aiResources.streaming, originalStreaming);
    publishTestAIResources();
  });
  const anthropic = {
    model: "test-model",
    max_tokens: 128,
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  };
  const chat = { model: "test-model", max_tokens: 128, messages: [{ role: "user", content: "hello" }] };
  const responses = { model: "test-model", max_output_tokens: 128, input: "hello" };

  it.each([
    [anthropic, "anthropic", "openai-chat-completions"],
    [anthropic, "anthropic", "openai-responses"],
    [chat, "openai-chat-completions", "anthropic"],
    [chat, "openai-chat-completions", "openai-responses"],
    [responses, "openai-responses", "anthropic"],
    [responses, "openai-responses", "openai-chat-completions"],
  ] as const)("converts %s from %s to %s", (body, source, target) => {
    const converted = convertRelayRequest(body, source, target);
    expect(converted.model).toBe("test-model");
    expect(converted).toEqual(expect.any(Object));
  });

  it("requires an output limit for conversions to Anthropic", () => {
    expect(() =>
      convertRelayRequest(
        { model: "test-model", messages: [{ role: "user", content: "hello" }] },
        "openai-chat-completions",
        "anthropic",
      ),
    ).toThrow(RelayFormatTransformError);
  });

  it("preserves DeepSeek reasoning content on assistant tool-call turns", () => {
    const converted = convertRelayRequest(
      {
        model: "deepseek-reasoner",
        max_tokens: 128,
        messages: [
          {
            role: "assistant",
            content: null,
            reasoning_content: "I need to call the tool first.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: '{"q":"status"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "ok" },
        ],
      },
      "openai-chat-completions",
      "openai-responses",
    );

    expect(converted.input[0]).toMatchObject({ reasoning_content: "I need to call the tool first." });
  });

  it("applies frame budgets per event, and configured retention increases take effect", async () => {
    env.aiResources.streaming.frameLimitBytes = 256;
    publishTestAIResources();
    env.aiResources.streaming.retainedLimitBytes = 1024;
    publishTestAIResources();
    const frame = "data: " + JSON.stringify({ choices: [{ delta: { content: "hello" } }] }) + "\n\n";
    const convert = async () => {
      const transform = new RelaySseFormatTransform("openai-chat-completions", "openai-responses");
      const reading = (async () => {
        for await (const data of transform) {
          void data;
        }
      })();
      transform.end(frame.repeat(100) + "data: [DONE]\n\n");
      await reading;
    };
    await expect(convert()).resolves.toBeUndefined();
    env.aiResources.streaming.retainedLimitBytes = 100;
    publishTestAIResources();
    await expect(convert()).rejects.toThrow("retention limit");
    env.aiResources.streaming.retainedLimitBytes = 1024;
    publishTestAIResources();
    env.aiResources.streaming.frameLimitBytes = 32;
    publishTestAIResources();
    await expect(convert()).rejects.toThrow("resource budget");
  });

  it("decodes UTF-8 and SSE events split across chunks", async () => {
    const transform = new RelaySseFormatTransform("anthropic", "openai-chat-completions");
    const output: Buffer[] = [];
    transform.on("data", (chunk) => output.push(Buffer.from(chunk)));
    const event = Buffer.from('event: content_block_delta\ndata: {"delta":{"text":"你"}}\n\n');
    transform.write(event.subarray(0, event.length - 2));
    transform.end(event.subarray(event.length - 2));
    await new Promise<void>((resolve, reject) => transform.once("end", resolve).once("error", reject));
    expect(Buffer.concat(output).toString("utf8")).toContain("chat.completion.chunk");
    expect(Buffer.concat(output).toString("utf8")).toContain("你");
  });
  const convertStream = async (
    source: "anthropic" | "openai-responses" | "openai-chat-completions",
    target: "anthropic" | "openai-responses" | "openai-chat-completions",
    events: string,
  ) => {
    const transform = new RelaySseFormatTransform(source, target);
    const chunks: Buffer[] = [];
    transform.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    transform.end(events);
    await new Promise<void>((resolve, reject) => transform.once("end", resolve).once("error", reject));
    return Buffer.concat(chunks).toString("utf8");
  };
  const chatStream =
    'data: {"id":"fixture","model":"model","choices":[{"delta":{"content":"hello"}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n' +
    "data: [DONE]\n\n";
  it("emits complete Anthropic lifecycle rather than forwarding OpenAI DONE", async () => {
    const output = await convertStream("openai-chat-completions", "anthropic", chatStream);
    for (const event of [
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ])
      expect(output).toContain(`event: ${event}`);
    expect(output).not.toContain("[DONE]");
    expect(output).toContain('"output_tokens":3');
  });
  it("composes Chat -> Responses -> Anthropic without leaking a different wire format", async () => {
    const responses = await convertStream("openai-chat-completions", "openai-responses", chatStream);
    expect(responses).toContain("response.created");
    expect(responses).toContain("response.output_text.delta");
    expect(responses).toContain("response.completed");
    const anthropic = await convertStream("openai-responses", "anthropic", responses);
    expect(anthropic).toContain("message_start");
    expect(anthropic).toContain("hello");
    expect(anthropic).toContain("message_stop");
  });
  it("preserves streamed tool identity and partial arguments", async () => {
    const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const input =
      frame({
        id: "fixture",
        model: "model",
        choices: [
          {
            delta: { tool_calls: [{ index: 0, id: "call_fixture", function: { name: "lookup", arguments: '{"q":' } }] },
          },
        ],
      }) +
      frame({
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '"ok"}' } }] }, finish_reason: "tool_calls" },
        ],
      }) +
      "data: [DONE]\n\n";
    const output = await convertStream("openai-chat-completions", "anthropic", input);
    expect(output).toContain("call_fixture");
    expect(output).toContain("lookup");
    expect(output).toContain("input_json_delta");
    expect(output).toContain('"stop_reason":"tool_use"');
  });
  it("does not retain complete answers for target protocols that only need deltas", async () => {
    env.aiResources.streaming.retainedLimitBytes = 16;
    publishTestAIResources();
    const frame = "data: " + JSON.stringify({ choices: [{ delta: { content: "hello" } }] }) + "\n\n";
    const output = await convertStream("openai-chat-completions", "anthropic", frame.repeat(100) + "data: [DONE]\n\n");
    expect(output).toContain("message_stop");
  });
});
