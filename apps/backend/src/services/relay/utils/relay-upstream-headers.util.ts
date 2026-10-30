import {
  getRelayDefaultForwardedHeaderNames,
  isRelayForwardableHeaderName,
  normalizeRelayForwardedHeaderNames,
  type RelayRequestFormat,
} from "@quyan/shared";

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

/** Defaults plus exact names, or all eligible headers when explicitly enabled. Reserved fields are always excluded. */
export function buildRelayUpstreamHeaders(
  incoming: Record<string, unknown>,
  format: RelayRequestFormat,
  upstreamApiKey: string,
  extraAllowedHeaders: unknown = [],
  forwardAllRequestHeaders: unknown = false,
): Record<string, string | string[] | number> {
  const allowed = new Set([
    ...getRelayDefaultForwardedHeaderNames(format),
    ...(normalizeRelayForwardedHeaderNames(extraAllowedHeaders) ?? []),
  ]);
  const connectionHeaders = relayConnectionHeaderNames(incoming);
  const headers: Record<string, string | string[] | number> = {};
  for (const [name, value] of Object.entries(incoming)) {
    const lowerName = name.toLowerCase();
    if (
      !isRelayForwardableHeaderName(lowerName) ||
      connectionHeaders.has(lowerName) ||
      (forwardAllRequestHeaders !== true && !allowed.has(lowerName))
    )
      continue;
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
