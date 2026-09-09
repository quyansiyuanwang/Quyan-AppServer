import type { RelayRequestLike } from "../types/relay-proxy.types";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const JSON_CONTENT_TYPE_RE = /(^|;)\s*application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i;

export const getUpstreamHeaderValue = (
  headers: Record<string, unknown> | undefined,
  headerName: string,
): string | undefined => {
  if (!headers) return undefined;
  const value = headers[headerName] ?? headers[headerName.toLowerCase()];
  if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
  return value == null ? undefined : String(value);
};

export const withRelayRequestIdHeader = (
  req: RelayRequestLike,
  headers: Record<string, unknown> = {},
  requestId?: string,
): Record<string, unknown> => {
  const mergedHeaders = { ...headers };
  const siteRequestId = requestId || getUpstreamHeaderValue(req.headers, "x-request-id");
  const upstreamRequestId = getUpstreamHeaderValue(mergedHeaders, "x-request-id");
  if (siteRequestId && !upstreamRequestId) mergedHeaders["x-request-id"] = siteRequestId;
  if (upstreamRequestId && upstreamRequestId !== siteRequestId)
    mergedHeaders["x-upstream-request-id"] = upstreamRequestId;
  return mergedHeaders;
};

export const sanitizeRelayResponseHeaders = (
  headers: Record<string, unknown>,
  options: { keepContentLength?: boolean } = {},
): Record<string, unknown> => {
  const sanitized: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const normalized = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalized)) continue;
    if (!options.keepContentLength && normalized === "content-length") continue;
    sanitized[name] = value;
  }
  return sanitized;
};

export const isRelayJsonContentType = (contentType: unknown): boolean =>
  typeof contentType === "string" && JSON_CONTENT_TYPE_RE.test(contentType);

export const isRelayClientCancellation = (error: unknown): boolean => {
  const candidate = error as { code?: string; name?: string } | undefined;
  return candidate?.code === "ERR_CANCELED" || candidate?.name === "AbortError";
};

export const extractRelayUpstreamErrorMessage = (responseData: unknown, fallbackStatus?: number): string => {
  if (typeof responseData === "string" && responseData.trim()) return responseData;
  if (responseData && typeof responseData === "object") {
    const data = responseData as Record<string, unknown>;
    const nestedError = data.error;
    if (nestedError && typeof nestedError === "object") {
      const nestedMessage = (nestedError as Record<string, unknown>).message;
      if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage;
    }
    if (typeof data.message === "string" && data.message.trim()) return data.message;
    if (typeof data.error === "string" && data.error.trim()) return data.error;
  }
  return fallbackStatus ? `HTTP ${fallbackStatus}` : "Upstream request failed";
};

export const parseRelayBufferedBody = (body: Buffer, headers: Record<string, unknown>): unknown => {
  if (!body.length) return null;
  const contentType = getUpstreamHeaderValue(headers, "content-type");
  if (!isRelayJsonContentType(contentType)) return body.toString("utf8");
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return body.toString("utf8");
  }
};

export const readRelayStreamBodyLimited = async (
  stream: AsyncIterable<Buffer | string>,
  maxBytes: number,
  onChunk?: (chunk: Buffer) => void,
): Promise<{ buffer: Buffer; truncated: boolean }> => {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for await (const rawChunk of stream as AsyncIterable<Buffer | string>) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    onChunk?.(chunk);
    if (total >= maxBytes) {
      truncated = true;
      continue;
    }
    const remaining = maxBytes - total;
    if (chunk.length > remaining) {
      chunks.push(chunk.subarray(0, remaining));
      total += remaining;
      truncated = true;
    } else {
      chunks.push(chunk);
      total += chunk.length;
    }
  }
  return { buffer: Buffer.concat(chunks), truncated };
};
