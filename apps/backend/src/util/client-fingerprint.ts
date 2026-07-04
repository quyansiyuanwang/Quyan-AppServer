import type { Request } from "express";
import { normalizeFingerprint } from "@appserver/shared";

export function extractClientFingerprint(req: Request): string | undefined {
  const direct = normalizeFingerprint(req.headers["x-client-fingerprint"]);
  if (direct) return direct;

  const fallback = normalizeFingerprint(req.headers["x-device-fingerprint"]);
  if (fallback) return fallback;

  return undefined;
}
