/** Caller credentials authenticate the relay; physical providers use channel credentials. */
const RELAY_CREDENTIAL_QUERY_NAMES = new Set(["key", "api_key", "apikey", "access_token", "authorization", "token"]);

export function buildRelayUpstreamQuery(query: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query).filter(([name]) => !RELAY_CREDENTIAL_QUERY_NAMES.has(name.toLowerCase())),
  );
}
