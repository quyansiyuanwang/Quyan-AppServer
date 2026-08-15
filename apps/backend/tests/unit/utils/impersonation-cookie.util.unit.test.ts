import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { env } from "@/config/env";
import {
  clearImpersonationHandoffCookie,
  IMPERSONATION_HANDOFF_COOKIE_NAME,
  setImpersonationHandoffCookie,
} from "@/util/impersonation-cookie";

describe("impersonation handoff cookie", () => {
  const originalIsProduction = env.runtime.isProduction;
  const originalSameSite = (env.auth.refreshCookie as any).sameSite;
  const originalCookieDomain = (env.auth.refreshCookie as any).domain;

  afterEach(() => {
    (env.runtime as any).isProduction = originalIsProduction;
    (env.auth.refreshCookie as any).sameSite = originalSameSite;
    (env.auth.refreshCookie as any).domain = originalCookieDomain;
  });

  it("stores only an opaque handoff id with the first-party cookie policy", () => {
    const cookie = vi.fn();
    const request = { res: { cookie } } as unknown as Request;
    (env.runtime as any).isProduction = true;
    (env.auth.refreshCookie as any).sameSite = "strict";
    (env.auth.refreshCookie as any).domain = ".qysyw.cn";

    setImpersonationHandoffCookie(request, "handoff-id");

    expect(cookie).toHaveBeenCalledWith(
      IMPERSONATION_HANDOFF_COOKIE_NAME,
      "handoff-id",
      expect.objectContaining({
        domain: ".qysyw.cn",
        httpOnly: true,
        maxAge: 60 * 60 * 1000,
        sameSite: "strict",
        secure: true,
      }),
    );
  });

  it("clears the cross-site handoff with matching cookie scope", () => {
    const clearCookie = vi.fn();
    const request = { res: { clearCookie } } as unknown as Request;
    (env.runtime as any).isProduction = false;
    (env.auth.refreshCookie as any).sameSite = "lax";

    clearImpersonationHandoffCookie(request);

    expect(clearCookie).toHaveBeenCalledWith(
      IMPERSONATION_HANDOFF_COOKIE_NAME,
      expect.objectContaining({ sameSite: "lax", secure: false }),
    );
  });
});
