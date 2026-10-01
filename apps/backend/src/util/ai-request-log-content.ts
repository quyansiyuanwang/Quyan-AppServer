import { createHash } from "crypto";
import { AI_REQUEST_LOG_LIMITS } from "@/constant/ai-request-log";
import { BadRequestError } from "@/util/errors";
import { auditText, auditUtf8Slice } from "@/util/ai-request-log-payload";
import type {
  AIRequestLogContentItemDto,
  AIRequestLogContentPageDto,
  AIRequestLogContentSide,
  AIRequestLogContentView,
  AIRequestLogSearchHitDto,
  AIRequestLogSearchPageDto,
} from "@/api/dto/relay/ai-request-log.dto";

type Node = { value: unknown; indices: number[]; path: string; section: string; label: string };
type Cursor = { scope: string; index: number; offset: number };
const sections: Record<string, string> = {
  system: "system",
  instructions: "system",
  systemInstruction: "system",
  messages: "messages",
  input: "messages",
  contents: "messages",
  tools: "tools",
  functions: "tools",
  choices: "output",
  output: "output",
  candidates: "output",
  content: "output",
  usage: "usage",
  usageMetadata: "usage",
  error: "errors",
  events: "events",
};
function invalidLocation(): never {
  throw new BadRequestError("Invalid AI log content cursor or location", undefined, {
    messageKey: "relay.aiRequestLogInvalidCursor",
  });
}
function pack(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function unpack(value: string): unknown {
  if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) invalidLocation();
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return invalidLocation();
  }
}
export function auditCursor(index: number, scope: string, offset = 0): string {
  return pack({ index, offset, scope });
}
export function readAuditCursor(cursor: string | undefined, scope: string): Cursor {
  if (!cursor) return { index: 0, offset: 0, scope };
  const data = unpack(cursor) as Cursor;
  if (
    !data ||
    data.scope !== scope ||
    !Number.isSafeInteger(data.index) ||
    data.index < 0 ||
    !Number.isSafeInteger(data.offset) ||
    data.offset < 0
  )
    invalidLocation();
  return data;
}
function pointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
function children(node: Node): Node[] {
  if (!node.value || typeof node.value !== "object") return [];
  return Object.entries(node.value).map(([key, value], index) => {
    const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const name = [obj.role, obj.name ?? (obj.function as { name?: unknown } | undefined)?.name, obj.type ?? obj.event]
      .filter((item) => typeof item === "string")
      .join(" · ");
    return {
      value,
      indices: [...node.indices, index],
      path: node.path + "/" + pointer(key),
      section: node.indices.length ? node.section : (sections[key] ?? "parameters"),
      label: (name || key).slice(0, 160),
    };
  });
}
function locate(tree: unknown, locator?: string): Node {
  let node: Node = { value: tree, indices: [], path: "", section: "other", label: "content" };
  if (!locator) return node;
  const indices = unpack(locator);
  if (!Array.isArray(indices) || indices.length > AI_REQUEST_LOG_LIMITS.maxDepth + 4) invalidLocation();
  for (const index of indices) {
    if (!Number.isSafeInteger(index) || index < 0) invalidLocation();
    const child = children(node)[index];
    if (!child) invalidLocation();
    node = child;
  }
  return node;
}
function analysisTree(value: unknown): unknown {
  if (value && typeof value === "object" && (value as { _truncated?: boolean })._truncated)
    return { preview: (value as { _preview?: unknown })._preview ?? value };
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    /* SSE or plain text. */
  }
  if (!/^(?:event:|data:)/m.test(value)) return value;
  const events: Array<{ event: string; data: unknown }> = [];
  const output = new Map<string, { type: string; text: string }>();
  let usage: unknown;
  const append = (key: string, type: string, text: unknown) => {
    if (typeof text !== "string") return;
    const entry = output.get(key) ?? { type, text: "" };
    entry.text += text;
    output.set(key, entry);
  };
  for (const frame of value.split(/\r?\n\r?\n/)) {
    const lines = frame.split(/\r?\n/);
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = data;
    }
    const event =
      lines
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim() ||
      parsed?.type ||
      "data";
    events.push({ event, data: parsed });
    const nextUsage = parsed?.usage ?? parsed?.message?.usage ?? parsed?.response?.usage ?? parsed?.usageMetadata;
    if (nextUsage && typeof nextUsage === "object")
      usage = { ...(usage && typeof usage === "object" ? usage : {}), ...nextUsage };
    if (parsed?.type === "content_block_start") {
      const block = parsed.content_block;
      append("anthropic:" + parsed.index, block?.type ?? "text", block?.text ?? block?.thinking ?? "");
    }
    if (parsed?.type === "content_block_delta")
      append(
        "anthropic:" + parsed.index,
        parsed.delta?.type ?? "text",
        parsed.delta?.text ?? parsed.delta?.thinking ?? parsed.delta?.partial_json,
      );
    if (/^response\.(?:output_text|reasoning_summary_text|function_call_arguments)\.delta$/.test(event))
      append("responses:" + (parsed.output_index ?? parsed.item_id ?? 0) + ":" + event, event, parsed.delta);
    for (const choice of Array.isArray(parsed?.choices) ? parsed.choices : []) {
      append("chat:" + (choice?.index ?? 0), "text", choice?.delta?.content);
      for (const call of Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : [])
        append("tool:" + (choice.index ?? 0) + ":" + call?.index, "tool_call", call?.function?.arguments);
    }
    for (const candidate of Array.isArray(parsed?.candidates) ? parsed.candidates : [])
      for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
        append("gemini:" + (candidate?.index ?? 0), "text", part?.text);
  }
  return { ...(output.size ? { output: [...output.values()] } : {}), ...(usage ? { usage } : {}), events };
}
function readable(value: unknown): string {
  if (!value || typeof value !== "object") return auditText(value);
  const obj = value as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.content === "string") return obj.content;
  if (obj.message && typeof obj.message === "object") return readable(obj.message);
  if (Array.isArray(obj.parts)) return obj.parts.map(readable).join("\n\n");
  if (obj.content && typeof obj.content === "object" && !Array.isArray(obj.content)) return readable(obj.content);
  if (Array.isArray(obj.content))
    return obj.content
      .map((part) => {
        if (typeof part === "string") return part;
        return typeof part?.text === "string"
          ? part.text
          : typeof part?.thinking === "string"
            ? part.thinking
            : auditText(part);
      })
      .join("\n\n");
  return auditText(value);
}
export function contentPage(input: {
  id: string;
  value: unknown;
  side: AIRequestLogContentSide;
  view: AIRequestLogContentView;
  cursor?: string;
  locator?: string;
  pageSize?: number;
  offset?: number;
  truncated: boolean;
  omissionReason: AIRequestLogContentPageDto["omissionReason"];
}): AIRequestLogContentPageDto {
  const empty = {
    items: [],
    nextCursor: null,
    hasMore: false,
    totalItems: 0,
    storedBytes: 0,
    truncated: input.truncated,
    omissionReason: input.omissionReason,
  };
  if (input.value === null || input.value === undefined)
    return { ...empty, omissionReason: input.omissionReason ?? "not-recorded" };
  if (typeof input.value === "object" && (input.value as { _empty?: boolean })._empty) return empty;
  const tree = input.view === "parsed" || input.locator ? analysisTree(input.value) : input.value;
  const node = locate(tree, input.locator);
  const original = auditText(node.value);
  const hash = createHash("sha256").update(original).digest("hex").slice(0, 16);
  const scope = [input.id, input.side, input.view, input.locator ?? "", hash].join(":");
  const cursor = input.cursor ? readAuditCursor(input.cursor, scope) : { index: 0, offset: input.offset ?? 0, scope };
  if (input.view === "raw") {
    const size = Buffer.byteLength(original);
    if (cursor.index !== 0 || cursor.offset > size) invalidLocation();
    const slice = auditUtf8Slice(original, cursor.offset, AI_REQUEST_LOG_LIMITS.contentChunkBytes);
    const nextCursor = slice.nextOffset < size ? auditCursor(0, scope, slice.nextOffset) : null;
    return {
      ...empty,
      storedBytes: size,
      totalItems: 1,
      items: [
        {
          locator: pack(node.indices),
          path: node.path.slice(0, 240),
          section: node.section,
          label: node.label,
          text: slice.text,
          offset: cursor.offset,
          totalBytes: size,
          nextCursor,
        },
      ],
      nextCursor,
      hasMore: Boolean(nextCursor),
    };
  }
  let nodes = children(node);
  if (!nodes.length) nodes = [node];
  else if (!input.locator) nodes = nodes.flatMap((child) => (Array.isArray(child.value) ? children(child) : [child]));
  if (cursor.index > nodes.length || cursor.offset !== 0) invalidLocation();
  const limit = Math.min(input.pageSize ?? AI_REQUEST_LOG_LIMITS.contentPageItems, AI_REQUEST_LOG_LIMITS.maxPageItems);
  const items: AIRequestLogContentItemDto[] = [];
  let bytes = 0;
  for (let index = cursor.index; index < nodes.length && items.length < limit; index++) {
    const child = nodes[index]!;
    const text = readable(child.value);
    const preview = auditUtf8Slice(text, 0, AI_REQUEST_LOG_LIMITS.previewBytes).text;
    const item = {
      locator: pack(child.indices),
      path: child.path.slice(0, 240),
      section: child.section,
      label: child.label,
      text: child.section === "tools" && !input.locator ? "" : preview,
      offset: 0,
      totalBytes: Buffer.byteLength(auditText(child.value)),
      nextCursor: null,
      expandable: Boolean(child.value && typeof child.value === "object"),
    };
    const size = Buffer.byteLength(JSON.stringify(item));
    if (items.length && bytes + size > AI_REQUEST_LOG_LIMITS.contentChunkBytes) break;
    bytes += size;
    items.push(item);
  }
  const nextIndex = cursor.index + items.length;
  const nextCursor = nextIndex < nodes.length ? auditCursor(nextIndex, scope) : null;
  return {
    ...empty,
    items,
    nextCursor,
    hasMore: Boolean(nextCursor),
    totalItems: nodes.length,
    storedBytes: Buffer.byteLength(auditText(input.value)),
  };
}
export function searchContent(input: {
  id: string;
  value: unknown;
  side: AIRequestLogSearchHitDto["side"];
  keyword: string;
  cursor?: string;
  pageSize?: number;
  truncated: boolean;
  omissionReason: AIRequestLogSearchPageDto["omissionReason"];
}): AIRequestLogSearchPageDto {
  const scope = [input.id, "search", input.side, createHash("sha256").update(input.keyword).digest("hex")].join(":");
  const cursor = readAuditCursor(input.cursor, scope);
  if (cursor.offset !== 0) invalidLocation();
  const limit = Math.min(input.pageSize ?? AI_REQUEST_LOG_LIMITS.contentPageItems, AI_REQUEST_LOG_LIMITS.maxPageItems);
  const items: AIRequestLogSearchHitDto[] = [];
  const needle = input.keyword.toLocaleLowerCase();
  let total = 0;
  function visit(node: Node): void {
    if (node.value && typeof node.value === "object") {
      children(node).forEach(visit);
      return;
    }
    const valueText = auditText(node.value);
    const field = node.path.split("/").pop()?.replace(/~1/g, "/").replace(/~0/g, "~") ?? "";
    const prefix = field && !/^\d+$/.test(field) ? field + ": " : "";
    const text = prefix + valueText;
    const lower = text.toLocaleLowerCase();
    let position = lower.indexOf(needle);
    while (position >= 0 && needle) {
      if (total >= cursor.index && items.length < limit) {
        const start = Math.max(0, position - 120);
        const end = Math.min(text.length, position + needle.length + 200);
        items.push({
          side: input.side,
          locator: pack(node.indices),
          path: node.path.slice(0, 240),
          section: node.section,
          excerpt: text.slice(start, end),
          matchText: text.slice(position, position + needle.length),
          matchStart: position - start,
          matchEnd: position - start + needle.length,
          offset: Buffer.byteLength(valueText.slice(0, Math.max(0, position - prefix.length - 120))),
        });
      }
      total++;
      position = lower.indexOf(needle, position + Math.max(1, needle.length));
    }
  }
  if (needle) visit(locate(analysisTree(input.value)));
  if (cursor.index > total) invalidLocation();
  const nextCursor = cursor.index + items.length < total ? auditCursor(cursor.index + items.length, scope) : null;
  return {
    items,
    nextCursor,
    hasMore: Boolean(nextCursor),
    total,
    truncated: input.truncated,
    omissionReason: input.omissionReason ?? (input.value == null ? "not-recorded" : null),
  };
}
