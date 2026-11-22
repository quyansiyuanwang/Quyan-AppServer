import type { Request } from "express";
import { isValidCredential } from "@quyan/shared";

/**
 * Extract relay token string from request headers or query params.
 * Checks Authorization, x-api-key, ?token=, then Gemini-compatible ?key=.
 * Uses the first present source; malformed credentials never fall back to another source.
 * Returns only a well-formed canonical or legacy Relay credential.
 */
export function extractRelayToken(req: Request): string | null {
  const authHeader = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"];
  let token: unknown;
  if (authHeader !== undefined) {
    if (typeof authHeader !== "string") return null;
    const match = /^Bearer +([^\s]+) *$/i.exec(authHeader);
    if (!match || match[0] !== authHeader) return null;
    token = match[1];
  } else if (apiKeyHeader !== undefined) token = apiKeyHeader;
  else token = req.query.token !== undefined ? req.query.token : req.query.key;

  return typeof token === "string" && isValidCredential(token, "relayToken") ? token : null;
}
