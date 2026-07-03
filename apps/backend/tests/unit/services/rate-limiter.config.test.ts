import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("rate-limiter config numeric fallbacks", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("falls back to defaults when trusted-device rate limits are invalid", async () => {
    process.env.RATE_LIMIT_2FA_TRUSTED_DEVICE_IP_MAX = "NaN";
    process.env.RATE_LIMIT_2FA_TRUSTED_DEVICE_IP_WINDOW = "0";
    process.env.RATE_LIMIT_2FA_TRUSTED_DEVICE_USER_MAX = "-1";
    process.env.RATE_LIMIT_2FA_TRUSTED_DEVICE_USER_WINDOW = "invalid";

    const { RATE_LIMITER_CONFIG } = await import("../../../src/config/rate-limiter");

    expect(RATE_LIMITER_CONFIG.twoFactorTrustedDevice.perIp.maxRequests).toBe(60);
    expect(RATE_LIMITER_CONFIG.twoFactorTrustedDevice.perIp.windowMinutes).toBe(10);
    expect(RATE_LIMITER_CONFIG.twoFactorTrustedDevice.perUser.maxRequests).toBe(30);
    expect(RATE_LIMITER_CONFIG.twoFactorTrustedDevice.perUser.windowMinutes).toBe(10);
  });
});
