import type { CookieOptions, Request } from "express";
import { EnvSpace } from "@/config/env";
import { getCookieValue } from "@/util/cookie";

export const TRUSTED_DEVICE_COOKIE_NAME = "two_factor_trusted_device";
const TRUSTED_DEVICE_ID_PATTERN = /^[a-f0-9]{64}$/i;

const resolveCookieOptions = (maxAgeSeconds?: number): CookieOptions => {
  const sameSite = EnvSpace.twoFactorTrustedDeviceCookieSameSite;
  const cookieDomain = EnvSpace.twoFactorTrustedDeviceCookieDomain;

  return {
    httpOnly: true,
    // Browsers require Secure when SameSite=None.
    secure: EnvSpace.isProduction || sameSite === "none",
    sameSite,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
    ...(typeof maxAgeSeconds === "number" && maxAgeSeconds > 0 ? { maxAge: maxAgeSeconds * 1000 } : {}),
  };
};

export function extractTrustedDeviceToken(req: Request): string | undefined {
  return getCookieValue(req, TRUSTED_DEVICE_COOKIE_NAME);
}

export function setTrustedDeviceTokenCookie(req: Request, token: string, maxAgeSeconds: number): void {
  const normalizedToken = token.trim();
  if (!normalizedToken) return;

  req.res?.cookie(TRUSTED_DEVICE_COOKIE_NAME, normalizedToken, resolveCookieOptions(maxAgeSeconds));
}

export function clearTrustedDeviceTokenCookie(req: Request): void {
  req.res?.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, resolveCookieOptions());
}

export function extractTrustedDeviceIdFromToken(token?: string | null): string | undefined {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) return undefined;

  const segments = normalizedToken.split(".");
  if (segments.length !== 2 && segments.length !== 3) return undefined;

  const rawDeviceId = segments.length === 3 ? segments[1] : segments[0];
  const deviceId = String(rawDeviceId || "")
    .trim()
    .toLowerCase();
  if (!TRUSTED_DEVICE_ID_PATTERN.test(deviceId)) return undefined;

  return deviceId;
}
