import type { CookieOptions, Request } from "express";
import { env } from "@/config/env";
import { getCookieValue } from "@/util/cookie";

export const AUTH_REFRESH_COOKIE_NAME = env.auth.refreshCookie.name;

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
  const sameSite = env.auth.refreshCookie.sameSite;
  const cookieDomain = env.auth.refreshCookie.domain;

  return {
    httpOnly: true,
    secure: env.runtime.isProduction || sameSite === "none",
    sameSite,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
    ...(typeof maxAgeSeconds === "number" && maxAgeSeconds > 0 ? { maxAge: maxAgeSeconds * 1000 } : {}),
  };
}

export function extractRefreshTokenCookie(req: Request): string | undefined {
  return getCookieValue(req, AUTH_REFRESH_COOKIE_NAME);
}

export function setRefreshTokenCookie(req: Request, token: string): void {
  const normalizedToken = token.trim();
  if (!normalizedToken) return;

  req.res?.cookie(
    AUTH_REFRESH_COOKIE_NAME,
    normalizedToken,
    resolveCookieOptions(parseExpiresToSeconds(env.auth.refreshTokenExpiresIn)),
  );
}

export function clearRefreshTokenCookie(req: Request): void {
  req.res?.clearCookie(AUTH_REFRESH_COOKIE_NAME, resolveCookieOptions());
}
