import { describe, expect, it } from "vitest";
import {
  convertRelayRequest,
  RelayFormatTransformError,
  RelaySseFormatTransform,
} from "../../../src/services/relay/relay-request-format-transform.service";

describe("relay request format conversion", () => {
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
});
