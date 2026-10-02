import type { Request } from "express";
import { isCredentialOfType } from "@quyan/shared";

/**
 * Extract relay token string from request headers or query params.
 * Checks Authorization header, x-api-key header, and ?token= query param.
 * Returns the token string if it uses a canonical or legacy Relay credential prefix, otherwise null.
 */
export function extractRelayToken(req: Request): string | null {
  const authHeader = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"];
  const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  const token = authHeader?.replace("Bearer ", "").trim() || apiKey || (req.query.token as string);

  if (!token || !isCredentialOfType(token, "relayToken")) return null;
  return token;
}
