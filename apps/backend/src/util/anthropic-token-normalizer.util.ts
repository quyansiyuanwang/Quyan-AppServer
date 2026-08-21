import type { Prisma } from "@prisma/client";

export interface RelayTokenNormalizerConfig {
  enabled: boolean;
  thinkingSignature: boolean;
  thinkingBudget: boolean;
  unsupportedImage: boolean;
  /** Explicit upstream model IDs known to accept text only for this token. */
  textOnlyModelIds: string[];
  /** Controls the /v1 prefix applied to the upstream request path. */
  v1PathMode: "off" | "auto" | "always";
}

export const DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG: RelayTokenNormalizerConfig = {
  enabled: false,
  thinkingSignature: false,
  thinkingBudget: false,
  unsupportedImage: false,
  textOnlyModelIds: [],
  v1PathMode: "auto",
};

export function normalizeRelayTokenNormalizerConfig(value: unknown): RelayTokenNormalizerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_RELAY_TOKEN_NORMALIZER_CONFIG };

  const input = value as Record<string, unknown>;
  return {
    enabled: input.enabled === true,
    thinkingSignature: input.thinkingSignature === true,
    thinkingBudget: input.thinkingBudget === true,
    unsupportedImage: input.unsupportedImage === true,
    textOnlyModelIds: Array.isArray(input.textOnlyModelIds)
      ? [
          ...new Set(
            input.textOnlyModelIds
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ]
      : [],
    v1PathMode:
      input.v1PathMode === "off" || input.v1PathMode === "always" || input.v1PathMode === "auto"
        ? input.v1PathMode
        : "auto",
  };
}

export function isConfiguredTextOnlyModel(model: string, textOnlyModelIds: readonly string[]): boolean {
  const normalizedModel = String(model || "")
    .trim()
    .toLowerCase();
  if (!normalizedModel) return false;
  return textOnlyModelIds.some((candidate) => candidate.trim().toLowerCase() === normalizedModel);
}

function cloneJsonBody(body: unknown): Record<string, unknown> | null {
  if (Buffer.isBuffer(body)) {
    try {
      const parsed = JSON.parse(body.toString("utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

function contentBlocks(message: Record<string, unknown>): unknown[] | null {
  return Array.isArray(message.content) ? message.content : null;
}

export function replaceAnthropicImages(body: unknown): { body: unknown; changed: boolean } {
  const cloned = cloneJsonBody(body);
  if (!cloned || !Array.isArray(cloned.messages)) return { body, changed: false };

  let changed = false;
  cloned.messages = cloned.messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const record = message as Record<string, unknown>;
    const blocks = contentBlocks(record);
    if (!blocks) return message;
    const replaced = replaceImagesInBlocks(blocks);
    changed ||= replaced.changed;
    const content = replaced.blocks;
    return { ...record, content };
  });

  return { body: changed ? cloned : body, changed };
}

function replaceImagesInBlocks(blocks: unknown[]): { blocks: unknown[]; changed: boolean } {
  let changed = false;
  const next = blocks.map((block) => {
    if (!block || typeof block !== "object") return block;
    const record = block as Record<string, unknown>;
    if (record.type === "image") {
      changed = true;
      return {
        type: "text",
        text: "[Unsupported Image]",
        ...(record.cache_control !== undefined ? { cache_control: record.cache_control } : {}),
      };
    }
    if (Array.isArray(record.content)) {
      const nested = replaceImagesInBlocks(record.content);
      if (nested.changed) {
        changed = true;
        return { ...record, content: nested.blocks };
      }
    }
    return block;
  });
  return { blocks: next, changed };
}

export function rectifyThinkingSignature(body: unknown): { body: unknown; changed: boolean } {
  const cloned = cloneJsonBody(body);
  if (!cloned || !Array.isArray(cloned.messages)) return { body, changed: false };

  let changed = false;
  cloned.messages = cloned.messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const record = message as Record<string, unknown>;
    const blocks = contentBlocks(record);
    if (!blocks) return message;
    const content = blocks.flatMap((block) => {
      if (!block || typeof block !== "object") return [block];
      const blockRecord = block as Record<string, unknown>;
      if (blockRecord.type === "thinking" || blockRecord.type === "redacted_thinking") {
        changed = true;
        return [];
      }
      if (Object.prototype.hasOwnProperty.call(blockRecord, "signature")) {
        const { signature: _signature, ...withoutSignature } = blockRecord;
        changed = true;
        return [withoutSignature];
      }
      return [block];
    });
    return { ...record, content };
  });

  if (cloned.thinking && typeof cloned.thinking === "object") {
    const lastAssistant = [...(cloned.messages as unknown[])].reverse().find((message) => {
      return message && typeof message === "object" && (message as Record<string, unknown>).role === "assistant";
    }) as Record<string, unknown> | undefined;
    const blocks = lastAssistant ? contentBlocks(lastAssistant) : null;
    const firstType = blocks?.[0] && typeof blocks[0] === "object" ? (blocks[0] as Record<string, unknown>).type : null;
    if (
      firstType !== "thinking" &&
      firstType !== "redacted_thinking" &&
      blocks?.some((block) => {
        return block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use";
      })
    ) {
      delete cloned.thinking;
      changed = true;
    }
  }

  return { body: changed ? cloned : body, changed };
}

export function rectifyThinkingBudget(body: unknown): { body: unknown; changed: boolean } {
  const cloned = cloneJsonBody(body);
  if (!cloned) return { body, changed: false };
  const current = cloned.thinking && typeof cloned.thinking === "object" ? cloned.thinking : {};
  const currentRecord = current as Record<string, unknown>;
  const currentMax = typeof cloned.max_tokens === "number" ? cloned.max_tokens : 0;
  const nextMax = Math.max(currentMax, 64000);
  const changed = currentRecord.type !== "enabled" || currentRecord.budget_tokens !== 32000 || currentMax < 64000;
  cloned.thinking = { ...currentRecord, type: "enabled", budget_tokens: 32000 };
  cloned.max_tokens = nextMax;
  return { body: changed ? cloned : body, changed };
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error.toLowerCase();
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  return [record.message, record.error, record.detail, record.code]
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isThinkingSignatureError(error: unknown): boolean {
  const text = errorText(error);
  return (
    (text.includes("invalid") && text.includes("signature") && text.includes("thinking")) ||
    (text.includes("thought signature") && (text.includes("not valid") || text.includes("invalid"))) ||
    text.includes("must start with a thinking block") ||
    (text.includes("expected") && text.includes("thinking") && text.includes("found") && text.includes("tool_use")) ||
    (text.includes("signature") && text.includes("field required")) ||
    (text.includes("signature") && text.includes("extra inputs are not permitted")) ||
    (text.includes("thinking") && text.includes("cannot be modified")) ||
    text.includes("illegal request") ||
    text.includes("invalid request") ||
    text.includes("非法请求")
  );
}

export function isThinkingBudgetError(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes("budget_tokens") &&
    (text.includes("at least") || text.includes("minimum") || text.includes("must be greater") || text.includes("1024"))
  );
}

export function isUnsupportedImageError(error: unknown): boolean {
  const text = errorText(error);
  if (text.includes("only support text") || text.includes("only supports text") || text.includes("text-only"))
    return true;
  return (
    (text.includes("image") ||
      text.includes("vision") ||
      text.includes("multimodal") ||
      text.includes("multi-modal") ||
      text.includes("modality") ||
      text.includes("modalities") ||
      text.includes("media") ||
      text.includes("attachment")) &&
    (text.includes("not support") ||
      text.includes("unsupported") ||
      text.includes("does not accept") ||
      text.includes("invalid") ||
      text.includes("unknown variant") ||
      text.includes("cannot process") ||
      text.includes("cannot handle") ||
      text.includes("unable to process"))
  );
}

export function rectifyAnthropicRequestForError(
  body: unknown,
  error: unknown,
  config: RelayTokenNormalizerConfig,
): { body: unknown; changed: boolean } {
  if (!config.enabled) return { body, changed: false };
  if (config.thinkingSignature && isThinkingSignatureError(error)) return rectifyThinkingSignature(body);
  if (config.thinkingBudget && isThinkingBudgetError(error)) return rectifyThinkingBudget(body);
  if (config.unsupportedImage && isUnsupportedImageError(error)) return replaceAnthropicImages(body);
  return { body, changed: false };
}

export function normalizeAnthropicRequestBeforeSend(
  body: unknown,
  model: string,
  config: RelayTokenNormalizerConfig,
): unknown {
  if (!config.enabled || !config.unsupportedImage || !isConfiguredTextOnlyModel(model, config.textOnlyModelIds))
    return body;
  return replaceAnthropicImages(body).body;
}

export function asNormalizerJsonValue(config: RelayTokenNormalizerConfig): Prisma.InputJsonValue {
  return config as unknown as Prisma.InputJsonValue;
}
