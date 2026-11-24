import { describe, expect, it } from "vitest";
import { normalizeDeepSeekReasoningHistory } from "../../../src/services/relay/utils/relay-deepseek-request.util";

const model = "deepseek-ai/DeepSeek-V4.1-Flash";
const fixture = () => ({
  tools: [{ type: "function", function: { name: "fixture_ping" } }],
  messages: [
    { role: "user", content: "Fixture question" },
    { role: "assistant", content: "Fixture answer", tool_calls: [{ id: "fixture-call" }] },
  ],
});

describe("DeepSeek assistant reasoning history compatibility", () => {
  it("fills only missing assistant reasoning without changing the caller's history", () => {
    const body = fixture();
    const original = structuredClone(body);
    const normalized = normalizeDeepSeekReasoningHistory(body, "openai-chat-completions", model);
    expect(normalized.messages[1]).toEqual({ ...body.messages[1], reasoning_content: "" });
    expect(normalized.messages[0]).toBe(body.messages[0]);
    expect(normalized.tools).toBe(body.tools);
    expect(body).toEqual(original);
    expect(normalizeDeepSeekReasoningHistory(normalized, "openai-chat-completions", model)).toBe(normalized);
  });

  it.each(["Fixture reasoning", "", null])("preserves an explicitly supplied reasoning value: %s", (reasoning) => {
    const body = { ...fixture(), messages: [{ role: "assistant", reasoning_content: reasoning }] };
    expect(normalizeDeepSeekReasoningHistory(body, "openai-chat-completions", model)).toBe(body);
  });

  it.each(["deepseek-flash", "DeepSeek-V4.1-Flash", "vendor/deepseek-reasoner"])(
    "recognizes the upstream model identity %s",
    (identity) => {
      const body = fixture();
      expect(normalizeDeepSeekReasoningHistory(body, "openai-chat-completions", identity)).not.toBe(body);
    },
  );

  it.each(["gpt-4o", "notdeepseek-model", "vendor/my-deepseek-model"])(
    "does not change other upstream models: %s",
    (identity) => {
      const body = fixture();
      expect(normalizeDeepSeekReasoningHistory(body, "openai-chat-completions", identity)).toBe(body);
    },
  );

  it.each(["anthropic", "openai-responses", "gemini"] as const)("does not change %s requests", (format) => {
    const body = fixture();
    expect(normalizeDeepSeekReasoningHistory(body, format, model)).toBe(body);
  });

  it.each([{}, { tools: [] }, { tools: null }])("leaves requests without tools untouched: %j", (tools) => {
    const body = { ...fixture(), ...tools };
    if (!("tools" in tools)) delete (body as { tools?: unknown }).tools;
    expect(normalizeDeepSeekReasoningHistory(body, "openai-chat-completions", model)).toBe(body);
  });

  it.each([null, undefined, "fixture", Buffer.from("fixture"), [], { tools: [{}], messages: null }])(
    "leaves unsupported body shapes untouched: %j",
    (body) => expect(normalizeDeepSeekReasoningHistory(body, "openai-chat-completions", model)).toBe(body),
  );
});
