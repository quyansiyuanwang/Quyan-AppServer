import { SENSITIVE_FIELDS } from "@/config/logging";
import { AI_REQUEST_LOG_LIMITS } from "@/constant/ai-request-log";

const sensitiveKeys = new Set(SENSITIVE_FIELDS.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "")));
const binaryKeys = new Set([
  "image",
  "imageurl",
  "inputimage",
  "inlinedata",
  "filedata",
  "b64json",
  "base64",
  "imagebase64",
]);
export function auditText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
}
/** Cut on UTF-8 boundaries; never introduce a replacement character at a page boundary. */
export function auditUtf8Slice(value: string, offset: number, maxBytes: number): { text: string; nextOffset: number } {
  const buffer = Buffer.from(value, "utf8");
  let start = Math.min(Math.max(0, offset), buffer.length);
  while (start > 0 && start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start--;
  let end = Math.min(start + maxBytes, buffer.length);
  while (end > start && end < buffer.length && (buffer[end]! & 0xc0) === 0x80) end--;
  return { text: buffer.subarray(start, end).toString("utf8"), nextOffset: end };
}
function maskCredentials(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer ***FILTERED***")
    .replace(/([?&](?:token|key|api_key|access_token)=)[^&\s"']*/gi, "$1***FILTERED***");
}
/** Structured data and SSE events are sanitized before persistence, not in the browser. */
export function sanitizeAuditPayload(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { _binary: true, _size: value.byteLength };
  if (typeof value === "string") {
    if (/^data:[^;\s]+;base64,/i.test(value))
      return { _binary: true, _size: Buffer.byteLength(value), _contentType: value.slice(5, value.indexOf(";")) };
    if (depth < AI_REQUEST_LOG_LIMITS.maxDepth && /^[\s]*[[{]/.test(value)) {
      try {
        return JSON.stringify(sanitizeAuditPayload(JSON.parse(value), depth + 1, seen));
      } catch {
        return { _omitted: true, _reason: "invalid-json", _size: Buffer.byteLength(value) };
      }
    }
    if (depth < AI_REQUEST_LOG_LIMITS.maxDepth && /^(?:event:|data:)/m.test(value)) {
      return value
        .split(/\r?\n\r?\n/)
        .map((event) => {
          const lines = event.split(/\r?\n/);
          const data = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data || data === "[DONE]") return maskCredentials(event);
          try {
            const safe = JSON.stringify(sanitizeAuditPayload(JSON.parse(data), depth + 1, seen));
            return [...lines.filter((line) => !line.startsWith("data:")), "data: " + safe].join("\n");
          } catch {
            return "data: " + JSON.stringify({ _omitted: true, _reason: "invalid-sse-json" });
          }
        })
        .join("\n\n");
    }
    return maskCredentials(value);
  }
  if (typeof value !== "object") return value;
  if (depth >= AI_REQUEST_LOG_LIMITS.maxDepth) return { _depthLimitReached: true };
  if (seen.has(value)) return "[Circular Reference]";
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => sanitizeAuditPayload(item, depth + 1, seen));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (sensitiveKeys.has(normalized)) return [key, "***FILTERED***"];
        if (
          binaryKeys.has(normalized) ||
          (item && typeof item === "object" && (item as { type?: string }).type === "base64")
        )
          return [key, { _binary: true, _size: Buffer.byteLength(auditText(item)), _contentType: "image" }];
        return [key, sanitizeAuditPayload(item, depth + 1, seen)];
      }),
    );
  } finally {
    seen.delete(value);
  }
}
export function safeAttemptExcerpt(value: unknown): string {
  // Transport errors can include URLs, headers and entire request configs. Never stringify Error objects.
  if (value instanceof Error) return "Upstream request failed";
  const safe = auditText(budgetAuditPayload(value, AI_REQUEST_LOG_LIMITS.attemptErrorBytes).value).replace(
    /https?:\/\/[^\s"'<>]+/gi,
    "[upstream address]",
  );
  return safe;
}

/** Budgeted audit snapshot. Never retain an unparsed JSON/SSE prefix containing credentials. */
export function budgetAuditPayload(
  value: unknown,
  maxBytes: number,
): { value: unknown; truncated: boolean; byteSize: number | null } {
  let remaining = Math.max(0, maxBytes - 256);
  let truncated = false;
  const seen = new WeakSet<object>();
  const omitted = { _truncated: true, _reason: "audit-budget" };
  const visit = (item: unknown, depth: number): unknown => {
    if (item === undefined || item === null) return null;
    if (depth >= AI_REQUEST_LOG_LIMITS.maxDepth || remaining <= 0) {
      truncated = true;
      return omitted;
    }
    if (typeof item === "string") {
      const bytes = Buffer.byteLength(item);
      if (bytes > remaining) {
        truncated = true;
        return omitted;
      }
      remaining -= bytes;
      return sanitizeAuditPayload(item);
    }
    if (Buffer.isBuffer(item) || item instanceof Uint8Array) return { _binary: true, _size: item.byteLength };
    if (typeof item !== "object") {
      remaining -= 16;
      return item;
    }
    if (seen.has(item)) return "[Circular Reference]";
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        const result: unknown[] = [];
        for (const entry of item) {
          if (remaining <= 0) {
            truncated = true;
            break;
          }
          remaining -= 16;
          result.push(visit(entry, depth + 1));
        }
        return result;
      }
      const result: Record<string, unknown> = {};
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        const keyBytes = Buffer.byteLength(key);
        if (keyBytes + 16 > remaining) {
          truncated = true;
          break;
        }
        remaining -= keyBytes + 16;
        const entry = (item as Record<string, unknown>)[key];
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (sensitiveKeys.has(normalized)) result[key] = "***FILTERED***";
        else if (
          binaryKeys.has(normalized) ||
          (entry && typeof entry === "object" && (entry as { type?: string }).type === "base64")
        )
          result[key] = { _binary: true, _contentType: "image" };
        else result[key] = visit(entry, depth + 1);
      }
      return result;
    } finally {
      seen.delete(item);
    }
  };
  // Truncated capture fragments are not safe to parse. Do not recurse into their preview.
  const capture = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const safe = capture?._truncated
    ? { _truncated: true, _size: capture._size ?? capture._originalSize ?? null, _reason: "incomplete-content" }
    : visit(value, 0);
  const serialized = JSON.stringify(safe) ?? "null";
  const size = Buffer.byteLength(serialized);
  if (size > maxBytes) return { value: omitted, truncated: true, byteSize: null };
  return {
    value: truncated ? { _truncated: true, _preview: safe } : safe,
    truncated: truncated || Boolean(capture?._truncated),
    byteSize: truncated ? null : size,
  };
}
