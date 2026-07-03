import type { Request } from "express";

const FINGERPRINT_PATTERN = /^[A-Za-z0-9._:-]{16,256}$/;

const normalizeFingerprint = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!FINGERPRINT_PATTERN.test(normalized)) return undefined;
  return normalized;
};

/**
 * 提取客户端浏览器指纹（优先使用显式请求头）
 */
export function extractClientFingerprint(req: Request): string | undefined {
  const direct = normalizeFingerprint(req.headers["x-client-fingerprint"]);
  if (direct) return direct;

  const fallback = normalizeFingerprint(req.headers["x-device-fingerprint"]);
  if (fallback) return fallback;

  return undefined;
}
