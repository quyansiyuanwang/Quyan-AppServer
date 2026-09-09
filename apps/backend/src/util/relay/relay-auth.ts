import type { Request } from "express";

/**
 * Extract relay token string from request headers or query params.
 * Checks Authorization header, x-api-key header, and ?token= query param.
 * Returns the token string if it starts with "rlt_", otherwise null.
 */
export function extractRelayToken(req: Request): string | null {
  const authHeader = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"];
  const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  const token = authHeader?.replace("Bearer ", "").trim() || apiKey || (req.query.token as string);

  if (!token || !token.startsWith("rlt_")) return null;
  return token;
}
