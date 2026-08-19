import { describe, expect, it } from "vitest";
import {
  DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG,
  isConfirmedTextOnlyModel,
  isThinkingBudgetError,
  isThinkingSignatureError,
  isUnsupportedImageError,
  normalizeAnthropicRequestBeforeSend,
  normalizeRelayTokenNormalizerConfig,
  rectifyAnthropicRequestForError,
  replaceAnthropicImages,
  rectifyThinkingBudget,
  rectifyThinkingSignature,
} from "@/util/anthropic-token-normalizer.util";

const enabled = {
  ...DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG,
  enabled: true,
  thinkingSignature: true,
  thinkingBudget: true,
  unsupportedImage: true,
  textOnlyPreflight: true,
};

describe("anthropic token normalizer", () => {
  it("defaults missing and invalid config fields to false", () => {
    expect(normalizeRelayTokenNormalizerConfig({ enabled: true, thinkingBudget: "yes" })).toEqual({
      enabled: true,
      thinkingSignature: false,
      thinkingBudget: false,
      unsupportedImage: false,
      textOnlyPreflight: false,
    });
  });

  it("matches cc-switch confirmed text-only models without matching visual variants", () => {
    expect(isConfirmedTextOnlyModel("deepseek/deepseek-v4-pro")).toBe(true);
    expect(isConfirmedTextOnlyModel("GLM-5.2[1M]")).toBe(true);
    expect(isConfirmedTextOnlyModel("glm-5.2v")).toBe(false);
  });

  it("removes thinking blocks and signatures without mutating the input", () => {
    const body = {
      thinking: { type: "enabled", budget_tokens: 1024 },
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden", signature: "bad" },
            { type: "text", text: "hello", signature: "bad" },
            { type: "tool_use", id: "tool_1", input: {}, signature: "bad" },
          ],
        },
      ],
    };
    const result = rectifyThinkingSignature(body);
    expect(result.changed).toBe(true);
    expect(body.messages[0].content).toHaveLength(3);
    expect(result.body).toMatchObject({ messages: [{ content: [{ type: "text" }, { type: "tool_use" }] }] });
    expect((result.body as any).messages[0].content[0].signature).toBeUndefined();
  });

  it("normalizes budget and raises max_tokens without lowering a larger value", () => {
    const result = rectifyThinkingBudget({ max_tokens: 70000, messages: [] });
    expect(result.body).toMatchObject({ max_tokens: 70000, thinking: { type: "enabled", budget_tokens: 32000 } });
  });

  it("replaces image blocks with the stable marker", () => {
    const body = { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64" } }] }] };
    const result = replaceAnthropicImages(body);
    expect(result.body).toMatchObject({ messages: [{ content: [{ type: "text", text: "[Unsupported Image]" }] }] });
    expect(body.messages[0].content[0].type).toBe("image");
  });

  it("replaces nested images while preserving unknown blocks and cache control", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "custom_block", value: "keep" },
            {
              type: "tool_result",
              content: [{ type: "image", cache_control: { type: "ephemeral" }, source: {} }],
            },
          ],
        },
      ],
    };
    const result = replaceAnthropicImages(body);
    expect(result.body).toMatchObject({
      messages: [
        {
          content: [
            { type: "custom_block", value: "keep" },
            { content: [{ type: "text", text: "[Unsupported Image]", cache_control: { type: "ephemeral" } }] },
          ],
        },
      ],
    });
    expect((body.messages[0]!.content[1] as any).content[0].type).toBe("image");
  });

  it("applies registry preflight only when the token enables it", () => {
    const body = { messages: [{ role: "user", content: [{ type: "image" }] }] };
    expect(normalizeAnthropicRequestBeforeSend(body, "deepseek-v4-pro", enabled)).not.toBe(body);
    expect(normalizeAnthropicRequestBeforeSend(body, "deepseek-v4-pro", { ...enabled, textOnlyPreflight: false })).toBe(
      body,
    );
  });

  it("classifies signature, budget and image errors narrowly", () => {
    expect(isThinkingSignatureError("Invalid signature in thinking block")).toBe(true);
    expect(isThinkingBudgetError("budget_tokens must be at least 1024")).toBe(true);
    expect(isUnsupportedImageError("This model does not support image input")).toBe(true);
    expect(isUnsupportedImageError("Model only supports text input")).toBe(true);
    expect(isThinkingBudgetError("timeout")).toBe(false);
  });

  it("selects one error rectification and respects the master switch", () => {
    const body = { max_tokens: 10, messages: [] };
    expect(rectifyAnthropicRequestForError(body, "budget_tokens must be at least 1024", enabled).changed).toBe(true);
    expect(
      rectifyAnthropicRequestForError(
        body,
        "budget_tokens must be at least 1024",
        DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG,
      ).changed,
    ).toBe(false);
  });

  it("keeps normalizer behavior isolated between token configurations", () => {
    const body = { max_tokens: 512, messages: [] };
    const tokenA = { ...enabled, thinkingBudget: true };
    const tokenB = { ...DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG, enabled: false, thinkingBudget: true };

    expect(rectifyAnthropicRequestForError(body, "budget_tokens must be at least 1024", tokenA).changed).toBe(true);
    expect(rectifyAnthropicRequestForError(body, "budget_tokens must be at least 1024", tokenB).changed).toBe(false);
  });
});
