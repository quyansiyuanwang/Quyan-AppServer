import {
  extractTokenUsageMetrics,
  hasTokenValue,
  normalizeTokenBreakdown,
  resolveFreshInputTokens,
  type TokenBreakdown,
} from "../token-usage.util";
import { hasVisibleStreamEvent } from "./relay-stream-output.util";
import type { RelayRequestFormat } from "./relay-model-availability.util";

export interface RelayStreamUsageSnapshot {
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  hasExplicitInputTokens: boolean;
}

/** Accumulates provider usage frames while a streaming relay response is in flight. */
export class RelayStreamUsageTracker {
  private requestTokenCount: number;
  private responseTokenCount = 0;
  private totalTokenCount = 0;
  private cacheCreationTokenCount = 0;
  private cacheReadTokenCount = 0;
  private explicitInputTokens = false;

  constructor(
    private readonly estimatedRequestTokens: number,
    private readonly inputTokensIncludeCacheRead: boolean,
  ) {
    this.requestTokenCount = estimatedRequestTokens;
  }

  get requestTokens(): number {
    return this.requestTokenCount;
  }

  get responseTokens(): number {
    return this.responseTokenCount;
  }

  get totalTokens(): number {
    return this.totalTokenCount;
  }

  get cacheCreationTokens(): number {
    return this.cacheCreationTokenCount;
  }

  get cacheReadTokens(): number {
    return this.cacheReadTokenCount;
  }

  get hasExplicitInputTokens(): boolean {
    return this.explicitInputTokens;
  }

  apply(usagePayload: unknown): void {
    if (!usagePayload || typeof usagePayload !== "object") return;

    const usageData = usagePayload as Record<string, unknown>;
    const usage = extractTokenUsageMetrics(usageData);
    const hasInputTokens =
      hasTokenValue(usageData.prompt_tokens) ||
      hasTokenValue(usageData.input_tokens) ||
      hasTokenValue(usageData.promptTokenCount);
    const hasOutputTokens = hasTokenValue(usageData.completion_tokens) || hasTokenValue(usageData.output_tokens);
    const hasGeminiOutputTokens = hasTokenValue(usageData.candidatesTokenCount);

    if (usage.totalTokens > 0) this.totalTokenCount = usage.totalTokens;
    if (hasOutputTokens || hasGeminiOutputTokens) this.responseTokenCount = usage.outputTokens;
    if (usage.cacheCreationTokens > 0) this.cacheCreationTokenCount = usage.cacheCreationTokens;
    if (usage.cacheReadTokens > 0) this.cacheReadTokenCount = usage.cacheReadTokens;
    if (hasInputTokens) {
      this.explicitInputTokens = true;
      this.requestTokenCount = resolveFreshInputTokens(
        usage.inputTokens,
        usage.cacheReadTokens,
        usage.cacheCreationTokens,
        this.inputTokensIncludeCacheRead,
      );
    }
  }

  snapshot(): RelayStreamUsageSnapshot {
    return {
      requestTokens: this.requestTokenCount,
      responseTokens: this.responseTokenCount,
      totalTokens: this.totalTokenCount,
      cacheCreationTokens: this.cacheCreationTokenCount,
      cacheReadTokens: this.cacheReadTokenCount,
      hasExplicitInputTokens: this.explicitInputTokens,
    };
  }

  normalized(): TokenBreakdown {
    return normalizeTokenBreakdown(
      this.requestTokenCount,
      this.responseTokenCount,
      this.totalTokenCount,
      this.explicitInputTokens ? 0 : this.estimatedRequestTokens,
    );
  }
}

/** Parses one complete SSE/plain JSON line and updates the stream usage tracker. */
export const consumeRelayStreamUsageLine = (
  line: string,
  requestFormat: RelayRequestFormat,
  tracker: RelayStreamUsageTracker,
  onVisibleOutput?: () => void,
): void => {
  const trimmedLine = line.trim();
  if (!trimmedLine) return;

  let json: any;
  if (trimmedLine.startsWith("data:")) {
    const data = trimmedLine.slice("data:".length).trimStart();
    if (!data || data === "[DONE]") return;
    if (!onVisibleOutput && !/"(?:usage|usageMetadata|[^"\n]*\\u[^"\n]*)"\s*:/.test(data)) return;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
  } else if (requestFormat === "gemini" && (trimmedLine.startsWith("{") || trimmedLine.startsWith("["))) {
    if (!onVisibleOutput && !/"(?:usage|usageMetadata|[^"\n]*\\u[^"\n]*)"\s*:/.test(trimmedLine)) return;
    try {
      json = JSON.parse(trimmedLine);
    } catch {
      return;
    }
  } else {
    return;
  }

  consumeRelayStreamUsageValue(json, requestFormat, tracker, onVisibleOutput);
};

export const consumeRelayStreamUsageValue = (
  json: any,
  requestFormat: RelayRequestFormat,
  tracker: RelayStreamUsageTracker,
  onVisibleOutput?: () => void,
): void => {
  if (hasVisibleStreamEvent(json, requestFormat)) onVisibleOutput?.();
  tracker.apply(json?.message?.usage);
  tracker.apply(json?.usage);
  tracker.apply(json?.response?.usage);
  tracker.apply(json?.usageMetadata);
};

/** One framed event; multiline SSE data fields share a single JSON parse. */
export function parseRelayStreamEvent(text: string, requestFormat: RelayRequestFormat): any {
  let raw = "";
  let offset = 0;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(offset, end).replace(/\r$/, "");
    if (line.startsWith("data:")) raw += (raw ? "\n" : "") + line.slice(5).trimStart();
    offset = end + 1;
  }
  if (!raw && requestFormat === "gemini") raw = text.trim();
  if (!raw || raw === "[DONE]") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
export function relayFrameNeedsUsage(frame: Buffer | string): boolean {
  return frame.includes('"usage"') || frame.includes('"usageMetadata"') || frame.includes("\\u");
}
/** Scan one already-decoded bounded response without allocating an event array. */
export function* relayDecodedFrames(text: string, delimiter: "sse" | "line"): Generator<string> {
  let offset = 0,
    start = 0;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    if (newline < 0) break;
    const blank = newline === offset || (newline === offset + 1 && text[offset] === "\r");
    offset = newline + 1;
    if (blank || delimiter === "line") {
      yield text.slice(start, offset);
      start = offset;
    }
  }
  if (start < text.length) yield text.slice(start);
}
