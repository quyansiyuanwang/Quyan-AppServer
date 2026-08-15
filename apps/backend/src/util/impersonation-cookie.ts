import type { CookieOptions, Request } from "express";
import { env } from "@/config/env";
import { getCookieValue } from "@/util/cookie";
import { IMPERSONATION_TOKEN_TTL_SECONDS } from "@/util/auth";

/** A short-lived, opaque handoff used only to restore impersonation across site origins. */
export const IMPERSONATION_HANDOFF_COOKIE_NAME = "impersonation_handoff";

function cookieOptions(maxAgeSeconds?: number): CookieOptions {
  const sameSite = env.auth.refreshCookie.sameSite;
  return {
    httpOnly: true,
    secure: env.runtime.isProduction || sameSite === "none",
    sameSite,
    path: "/",
    ...(env.auth.refreshCookie.domain ? { domain: env.auth.refreshCookie.domain } : {}),
    ...(typeof maxAgeSeconds === "number" && maxAgeSeconds > 0 ? { maxAge: maxAgeSeconds * 1000 } : {}),
  };
}

export const extractImpersonationHandoffCookie = (request: Request): string | undefined =>
  getCookieValue(request, IMPERSONATION_HANDOFF_COOKIE_NAME);

export const setImpersonationHandoffCookie = (request: Request, handoffId: string): void => {
  const normalized = handoffId.trim();
  if (!normalized) return;
  request.res?.cookie(IMPERSONATION_HANDOFF_COOKIE_NAME, normalized, cookieOptions(IMPERSONATION_TOKEN_TTL_SECONDS));
};

export const clearImpersonationHandoffCookie = (request: Request): void => {
  request.res?.clearCookie(IMPERSONATION_HANDOFF_COOKIE_NAME, cookieOptions());
};
