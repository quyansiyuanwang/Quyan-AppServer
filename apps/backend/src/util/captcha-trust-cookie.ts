import { createHmac, timingSafeEqual } from "crypto";
import type { CookieOptions, Request } from "express";
import { env } from "@/config/env";
import { getCookieValue } from "@/util/cookie";
import { extractClientIp } from "@/util/ip-extractor";

export const CAPTCHA_TRUST_COOKIE_NAME = env.security.captchaTrust.cookieName;

type CaptchaTrustPayload = {
  exp: number;
  ip: string;
};

function resolveCookieOptions(maxAgeSeconds?: number): CookieOptions {
  const sameSite = env.security.captchaTrust.cookieSameSite;
  const cookieDomain = env.security.captchaTrust.cookieDomain;

  return {
    httpOnly: true,
    secure: env.runtime.isProduction || sameSite === "none",
    sameSite,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
    ...(typeof maxAgeSeconds === "number" && maxAgeSeconds > 0 ? { maxAge: maxAgeSeconds * 1000 } : {}),
  };
}

function signPayload(payloadBase64: string): string {
  return createHmac("sha256", env.security.captchaTrust.secret).update(payloadBase64).digest("base64url");
}

function parseCaptchaTrustCookie(raw: string): CaptchaTrustPayload | null {
  const normalized = String(raw || "").trim();
  if (!normalized) return null;

  const segments = normalized.split(".");
  if (segments.length !== 2) return null;

  const [payloadBase64, signature] = segments;
  if (!payloadBase64 || !signature) return null;

  const expected = signPayload(payloadBase64);

  try {
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8")) as CaptchaTrustPayload;
    if (!payload || typeof payload.exp !== "number" || typeof payload.ip !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

export function extractCaptchaTrustCookie(req: Request): string | undefined {
  return getCookieValue(req, CAPTCHA_TRUST_COOKIE_NAME);
}

export function hasValidCaptchaTrustCookie(req: Request): boolean {
  const rawCookie = extractCaptchaTrustCookie(req);
  if (!rawCookie) return false;

  const payload = parseCaptchaTrustCookie(rawCookie);
  if (!payload) return false;
  if (payload.exp <= Date.now()) return false;
  return payload.ip === extractClientIp(req);
}

export function setCaptchaTrustCookie(req: Request, maxAgeSeconds: number): void {
  if (!req.res || maxAgeSeconds <= 0) return;

  const payload: CaptchaTrustPayload = {
    exp: Date.now() + maxAgeSeconds * 1000,
    ip: extractClientIp(req),
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signPayload(payloadBase64);
  req.res.cookie(CAPTCHA_TRUST_COOKIE_NAME, `${payloadBase64}.${signature}`, resolveCookieOptions(maxAgeSeconds));
}

export function clearCaptchaTrustCookie(req: Request): void {
  req.res?.clearCookie(CAPTCHA_TRUST_COOKIE_NAME, resolveCookieOptions());
}
