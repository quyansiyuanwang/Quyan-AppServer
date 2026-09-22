import type { Request } from "express";
import type { BrowserStateResetResponse } from "@/api/dto/auth/auth.dto";
import { JWTRefreshIns } from "@/util/auth";
import { clearRefreshTokenCookie, extractRefreshTokenCookie } from "@/util/auth-refresh-cookie";
import { clearAuthSessionIdCookie } from "@/util/auth-session";
import { clearImpersonationHandoffCookie } from "@/util/impersonation-cookie";
import { clearCaptchaTrustCookie } from "@/util/captcha-trust-cookie";
import { clearTrustedDeviceTokenCookie } from "@/util/trusted-device-token";

export class BrowserStateResetService {
  private static instance: BrowserStateResetService;
  static getInstance(): BrowserStateResetService {
    return (this.instance ??= new BrowserStateResetService());
  }

  async reset(request: Request): Promise<BrowserStateResetResponse> {
    let cookiesCleared = Boolean(request.res);
    // Each cookie retains its original Path/Domain/Secure attributes. Never accept client names.
    for (const clear of [
      clearRefreshTokenCookie,
      clearAuthSessionIdCookie,
      clearImpersonationHandoffCookie,
      clearCaptchaTrustCookie,
      clearTrustedDeviceTokenCookie,
    ]) {
      try {
        clear(request);
      } catch {
        cookiesCleared = false;
      }
    }
    let sessionRevoked = false;
    try {
      const token = extractRefreshTokenCookie(request);
      if (token) await JWTRefreshIns.revokeToken(token);
      sessionRevoked = true;
    } catch {
      // A malformed/stale credential or unavailable revocation store must not prevent clearing cookies.
      // Do not log the credential or its parsing error.
    }
    return { cookiesCleared, sessionRevoked };
  }
}
