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
  return `/v1${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}
