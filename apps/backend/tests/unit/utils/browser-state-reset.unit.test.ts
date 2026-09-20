import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { browserStateResetGuard, isBrowserResetOriginAllowed } from "@/middleware/auth/browser-state-reset.middleware";
import { BrowserStateResetService } from "@/services/auth/browser-state-reset.service";
import { env } from "@/config/env";

const mocks = vi.hoisted(() => ({ revoke: vi.fn(), extract: vi.fn(), clear: vi.fn() }));
vi.mock("@/util/auth", () => ({ JWTRefreshIns: { revokeToken: mocks.revoke } }));
vi.mock("@/util/auth-refresh-cookie", () => ({
  clearRefreshTokenCookie: mocks.clear,
  extractRefreshTokenCookie: mocks.extract,
}));
vi.mock("@/util/auth-session", () => ({ clearAuthSessionIdCookie: mocks.clear }));
vi.mock("@/util/impersonation-cookie", () => ({ clearImpersonationHandoffCookie: mocks.clear }));
vi.mock("@/util/captcha-trust-cookie", () => ({ clearCaptchaTrustCookie: mocks.clear }));
vi.mock("@/util/trusted-device-token", () => ({ clearTrustedDeviceTokenCookie: mocks.clear }));

beforeEach(() => {
  vi.resetAllMocks();
});
describe("browser state reset security", () => {
  it("requires an exact configured origin and fails closed", () => {
    expect(isBrowserResetOriginAllowed(undefined, "")).toBe(false);
    expect(isBrowserResetOriginAllowed("null", "null")).toBe(false);
    expect(isBrowserResetOriginAllowed("https://evil.test", "https://auth.example.test")).toBe(false);
    expect(isBrowserResetOriginAllowed("https://auth.example.test.evil.test", "https://auth.example.test")).toBe(false);
    expect(isBrowserResetOriginAllowed("http://localhost:5173", "http://localhost:5173")).toBe(true);
  });
  it("rejects missing custom header and unexpected body fields", () => {
    const origin = env.runtime.corsAllowedOrigins.split(",")[0];
    const next = vi.fn();
    const request = {
      get: (key: string) => (key === "origin" ? origin : undefined),
      is: () => true,
      body: { confirm: true },
    } as unknown as Request;
    browserStateResetGuard(request, {} as Response, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    request.get = ((key: string) => (key === "origin" ? origin : "1")) as Request["get"];
    request.body = { confirm: true, userId: "foreign" };
    browserStateResetGuard(request, {} as Response, next);
    expect(next.mock.calls[1][0]).toMatchObject({ statusCode: 400 });
    request.body = { confirm: true };
    browserStateResetGuard(request, {} as Response, next);
    expect(next.mock.calls[2]).toEqual([]);
  });
  it("clears every cookie even when refresh revocation fails", async () => {
    mocks.extract.mockReturnValue("test-only-invalid-token");
    mocks.revoke.mockRejectedValue(new Error("malformed"));
    const result = await BrowserStateResetService.getInstance().reset({ res: {} } as Request);
    expect(mocks.clear).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ cookiesCleared: true, sessionRevoked: false });
  });
  it("continues after a cookie failure and reports partial completion", async () => {
    mocks.clear.mockImplementationOnce(() => {
      throw new Error("cookie failure");
    });
    const result = await BrowserStateResetService.getInstance().reset({ res: {} } as Request);
    expect(mocks.clear).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ cookiesCleared: false, sessionRevoked: true });
  });
});
