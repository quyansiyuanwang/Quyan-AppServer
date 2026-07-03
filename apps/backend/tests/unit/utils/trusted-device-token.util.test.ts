import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { EnvSpace } from "@/config/env";
import {
  clearTrustedDeviceTokenCookie,
  extractTrustedDeviceIdFromToken,
  setTrustedDeviceTokenCookie,
  TRUSTED_DEVICE_COOKIE_NAME,
} from "@/util/trusted-device-token";

describe("trusted-device token cookie options", () => {
  const originalIsProduction = EnvSpace.isProduction;
  const originalSameSite = (EnvSpace as any).twoFactorTrustedDeviceCookieSameSite;
  const originalCookieDomain = (EnvSpace as any).twoFactorTrustedDeviceCookieDomain;

  afterEach(() => {
    (EnvSpace as any).isProduction = originalIsProduction;
    (EnvSpace as any).twoFactorTrustedDeviceCookieSameSite = originalSameSite;
    (EnvSpace as any).twoFactorTrustedDeviceCookieDomain = originalCookieDomain;
  });

  it("uses configured sameSite for trusted-device cookie", () => {
    const cookie = vi.fn();
    const req = {
      res: { cookie },
    } as unknown as Request;

    (EnvSpace as any).isProduction = false;
    (EnvSpace as any).twoFactorTrustedDeviceCookieSameSite = "lax";

    setTrustedDeviceTokenCookie(req, "token-value", 120);

    expect(cookie).toHaveBeenCalledWith(
      TRUSTED_DEVICE_COOKIE_NAME,
      "token-value",
      expect.objectContaining({
        sameSite: "lax",
        secure: false,
        httpOnly: true,
      }),
    );
  });

  it("forces secure cookie when sameSite is none", () => {
    const cookie = vi.fn();
    const req = {
      res: { cookie },
    } as unknown as Request;

    (EnvSpace as any).isProduction = false;
    (EnvSpace as any).twoFactorTrustedDeviceCookieSameSite = "none";

    setTrustedDeviceTokenCookie(req, "token-value", 120);

    expect(cookie).toHaveBeenCalledWith(
      TRUSTED_DEVICE_COOKIE_NAME,
      "token-value",
      expect.objectContaining({
        sameSite: "none",
        secure: true,
      }),
    );
  });

  it("uses same cookie options when clearing trusted-device token", () => {
    const clearCookie = vi.fn();
    const req = {
      res: { clearCookie },
    } as unknown as Request;

    (EnvSpace as any).isProduction = true;
    (EnvSpace as any).twoFactorTrustedDeviceCookieSameSite = "strict";

    clearTrustedDeviceTokenCookie(req);

    expect(clearCookie).toHaveBeenCalledWith(
      TRUSTED_DEVICE_COOKIE_NAME,
      expect.objectContaining({
        sameSite: "strict",
        secure: true,
      }),
    );
  });

  it("applies configured cookie domain when issuing trusted-device cookie", () => {
    const cookie = vi.fn();
    const req = {
      res: { cookie },
    } as unknown as Request;

    (EnvSpace as any).isProduction = true;
    (EnvSpace as any).twoFactorTrustedDeviceCookieSameSite = "strict";
    (EnvSpace as any).twoFactorTrustedDeviceCookieDomain = ".qysyw.cn";

    setTrustedDeviceTokenCookie(req, "token-value", 120);

    expect(cookie).toHaveBeenCalledWith(
      TRUSTED_DEVICE_COOKIE_NAME,
      "token-value",
      expect.objectContaining({
        domain: ".qysyw.cn",
      }),
    );
  });

  it("extracts trusted-device id from v1 and legacy token formats", () => {
    const deviceId = "a".repeat(64);

    expect(extractTrustedDeviceIdFromToken(`v1.${deviceId}.sig`)).toBe(deviceId);
    expect(extractTrustedDeviceIdFromToken(`${deviceId}.legacysig`)).toBe(deviceId);
    expect(extractTrustedDeviceIdFromToken("invalid.token")).toBeUndefined();
  });
});
