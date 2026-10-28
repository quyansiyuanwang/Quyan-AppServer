import { normalizeRelayForwardedHeaderNames, type RelayRequestFormat } from "@quyan/shared";

const COMMON_HEADERS = new Set([
  "content-type",
  "accept",
  "accept-encoding",
  "user-agent",
  "x-request-id",
  "x-client-request-id",
  "idempotency-key",
  "x-opencode-session",
]);
const OPENAI_HEADERS = ["openai-organization", "openai-project", "openai-beta"] as const;
const FORMAT_HEADERS: Record<RelayRequestFormat, readonly string[]> = {
  openai: OPENAI_HEADERS,
  "openai-chat-completions": OPENAI_HEADERS,
  "openai-responses": OPENAI_HEADERS,
  anthropic: ["anthropic-version", "anthropic-beta"],
  gemini: ["x-goog-api-client"],
};

/** Connection options name additional hop-by-hop fields, even when otherwise allowlisted. */
export function relayConnectionHeaderNames(headers: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "connection") continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry !== "string") continue;
      for (const option of entry.split(",")) names.add(option.trim().toLowerCase());
    }
  }
  return names;
}

/** Only forward protocol and administrator-allowlisted headers. Caller credentials never become provider credentials. */
export function buildRelayUpstreamHeaders(
  incoming: Record<string, unknown>,
  format: RelayRequestFormat,
  upstreamApiKey: string,
  extraAllowedHeaders: unknown = [],
): Record<string, string | string[] | number> {
  const allowed = new Set([
    ...COMMON_HEADERS,
    ...FORMAT_HEADERS[format],
    ...(normalizeRelayForwardedHeaderNames(extraAllowedHeaders) ?? []),
  ]);
  const connectionHeaders = relayConnectionHeaderNames(incoming);
  const headers: Record<string, string | string[] | number> = {};
  for (const [name, value] of Object.entries(incoming)) {
    const lowerName = name.toLowerCase();
    if (!allowed.has(lowerName) || connectionHeaders.has(lowerName)) continue;
    if (typeof value === "string" && value.trim() && !/[\r\n\0]/.test(value)) headers[lowerName] = value;
    else if (
      Array.isArray(value) &&
      value.length &&
      value.every((entry) => typeof entry === "string" && entry.trim() && !/[\r\n\0]/.test(entry))
    )
      headers[lowerName] = [...value];
  }

  if (format === "gemini") headers["x-goog-api-key"] = upstreamApiKey;
  else if (format === "anthropic") {
    headers["x-api-key"] = upstreamApiKey;
    headers["anthropic-version"] ??= "2023-06-01";
  } else headers["Authorization"] = `Bearer ${upstreamApiKey}`;
  return headers;
}
