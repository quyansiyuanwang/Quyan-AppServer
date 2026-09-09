export type RelayTokenV1PathMode = "off" | "auto" | "always";

/**
 * Applies a token's version-prefix policy after the relay prefix has been removed.
 * Auto mode produces exactly one /v1 prefix; always mode prepends one without
 * de-duplicating an existing prefix.
 */
export function applyRelayTokenV1PathMode(requestPath: string, mode: RelayTokenV1PathMode = "auto"): string {
  const normalizedPath = requestPath.replace(/^\/relay\/proxy/, "") || "/";
  if (mode === "off") return normalizedPath;
  if (mode === "always") return `/v1${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;

  const withoutRepeatedV1 = normalizedPath.replace(/^(?:\/v1)+(?=\/|$)/, "");
  const suffix = withoutRepeatedV1 || "/";
  // Preserve any explicit upstream API version (v2, v4, v1beta, ...).
  // Auto mode only supplies v1 when the request has no version prefix.
  if (/^\/v\d+(?:beta)?(?=\/|$)/i.test(suffix)) return suffix;
  return `/v1${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}
