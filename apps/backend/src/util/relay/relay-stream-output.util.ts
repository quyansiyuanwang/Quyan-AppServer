import type { RelayRequestFormat } from "./relay-model-availability.util";
import { DEFAULT_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES } from "@quyan/shared";

/** @deprecated Use token-specific streamConfig.preflightBufferLimitBytes instead */
export const STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES = DEFAULT_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES;

const hasVisibleText = (value: unknown): boolean => {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasVisibleText(item));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [record.text, record.content, record.delta, record.output_text].some((item) => hasVisibleText(item));
};

export const hasVisibleStreamEvent = (value: unknown, requestFormat: RelayRequestFormat): boolean => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, any>;

  if (requestFormat === "anthropic") {
    if (!["content_block_delta", "content_block_start"].includes(String(record.type))) return false;
    return hasVisibleText(record.delta) || hasVisibleText(record.content_block);
  }

  if (requestFormat === "gemini") {
    return Array.isArray(record.candidates)
      ? record.candidates.some((candidate: any) => hasVisibleText(candidate?.content?.parts))
      : false;
  }

  if (Array.isArray(record.choices))
    return record.choices.some(
      (choice: any) => hasVisibleText(choice?.delta?.content) || hasVisibleText(choice?.message?.content),
    );

  if (String(record.type || "").startsWith("response.output_text."))
    return [record.delta, record.text, record.content, record.output_text].some((item) => hasVisibleText(item));
  if (String(record.type || "").startsWith("response.content_part."))
    return hasVisibleText(record.part) || hasVisibleText(record.content);
  return false;
};

export const hasVisibleStreamOutput = (raw: Buffer | string, requestFormat: RelayRequestFormat): boolean =>
  raw
    .toString()
    .split(/\r?\n/)
    .some((line) => {
      const trimmed = line.trim();
      const data = trimmed.startsWith("data:")
        ? trimmed.slice("data:".length).trim()
        : requestFormat === "gemini"
          ? trimmed
          : "";
      if (!data || data === "[DONE]") return false;
      try {
        return hasVisibleStreamEvent(JSON.parse(data), requestFormat);
      } catch {
        return false;
      }
    });

/** Detect user-visible model content in a buffered (non-streaming) response. */
export const hasVisibleRelayResponseOutput = (value: unknown, requestFormat: RelayRequestFormat): boolean => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, any>;
  if (requestFormat === "anthropic") return hasVisibleText(record.content);
  if (requestFormat === "gemini")
    return (
      Array.isArray(record.candidates) &&
      record.candidates.some((candidate: any) => hasVisibleText(candidate?.content?.parts))
    );
  if (Array.isArray(record.choices))
    return record.choices.some(
      (choice: any) => hasVisibleText(choice?.message?.content) || hasVisibleText(choice?.text),
    );
  if (Array.isArray(record.output))
    return record.output.some((item: any) => hasVisibleText(item?.content) || hasVisibleText(item?.text));
  return hasVisibleText(record.output_text) || hasVisibleText(record.content);
};

export class RelayStreamPreflightBuffer {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private started = false;
  private visible = false;
  private readonly limitBytes: number;

  constructor(limitBytes: number = DEFAULT_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES) {
    this.limitBytes = limitBytes;
  }

  get hasVisibleOutput() {
    return this.visible;
  }

  get isStarted() {
    return this.started;
  }

  markVisible() {
    this.visible = true;
  }

  append(chunk: Buffer): boolean {
    if (!chunk.length || this.started) return true;
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    return this.bytes <= this.limitBytes;
  }

  start(writeHead: () => void, write: (chunk: Buffer) => void) {
    if (this.started || !this.visible) return;
    this.started = true;
    writeHead();
    for (const chunk of this.chunks) write(chunk);
    this.chunks.length = 0;
  }

  write(chunk: Buffer, write: (chunk: Buffer) => void): boolean {
    if (!chunk.length) return true;
    if (this.started) write(chunk);
    else if (!this.append(chunk)) return false;
    return true;
  }
}
