import { randomUUID } from "crypto";
import type { CookieOptions, Request } from "express";
import { env } from "@/config/env";
import { getCookieValue } from "@/util/cookie";

export const AUTH_SESSION_COOKIE_NAME = env.auth.sessionCookie.name;

function parseExpiresToSeconds(raw: string | number | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);

  const value = String(raw || "").trim();
  if (!value) return 0;

  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);

  const match = value.match(/^(\d+)\s*([smhdw])$/i);
  if (!match) return 0;

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  switch (match[2].toLowerCase()) {
    case "s":
      return amount;
    case "m":
      return amount * 60;
    case "h":
      return amount * 60 * 60;
    case "d":
      return amount * 24 * 60 * 60;
    case "w":
      return amount * 7 * 24 * 60 * 60;
    default:
      return 0;
  }
}

function resolveCookieOptions(maxAgeSeconds?: number): CookieOptions {
  const sameSite = env.auth.sessionCookie.sameSite;
  const cookieDomain = env.auth.sessionCookie.domain;

  return {
    httpOnly: true,
    secure: env.runtime.isProduction || sameSite === "none",
    sameSite,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
    ...(typeof maxAgeSeconds === "number" && maxAgeSeconds > 0 ? { maxAge: maxAgeSeconds * 1000 } : {}),
  };
}

export function createAuthSessionId(): string {
  return randomUUID();
}

export function extractAuthSessionId(req: Request): string | undefined {
  return getCookieValue(req, AUTH_SESSION_COOKIE_NAME)?.trim() || undefined;
}

export function setAuthSessionIdCookie(req: Request, sessionId: string = createAuthSessionId()): string {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return "";

  req.res?.cookie(
    AUTH_SESSION_COOKIE_NAME,
    normalizedSessionId,
    resolveCookieOptions(parseExpiresToSeconds(env.auth.refreshTokenExpiresIn)),
  );

  return normalizedSessionId;
}

export function clearAuthSessionIdCookie(req: Request): void {
  req.res?.clearCookie(AUTH_SESSION_COOKIE_NAME, resolveCookieOptions());
}

export function buildForceOfflineAuthSessionKey(sessionId: string): string {
  return `auth:session:force_offline:${sessionId}`;
}

export function getForceOfflineAuthSessionTtlSeconds(): number {
  return Math.max(1, env.auth.sessionCookie.forceOfflineTtlDays) * 24 * 60 * 60;
}
