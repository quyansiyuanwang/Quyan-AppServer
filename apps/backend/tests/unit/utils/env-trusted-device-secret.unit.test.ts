import { afterEach, describe, expect, it, vi } from "vitest";

describe("env trusted-device secret validation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("throws on startup when trusted-device secret equals JWT access secret", async () => {
    const sharedSecret = "x".repeat(64);
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      JWT_ACCESS_SECRET: sharedSecret,
      TWO_FACTOR_TRUSTED_DEVICE_SECRET: sharedSecret,
    };

    vi.resetModules();

    await expect(import("../../../src/config/env")).rejects.toThrow(
      "TWO_FACTOR_TRUSTED_DEVICE_SECRET must be different from JWT_ACCESS_SECRET",
    );
  });

  it("throws on startup when trusted-device secret is shorter than 64 chars", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      TWO_FACTOR_TRUSTED_DEVICE_SECRET: "short-secret",
    };

    vi.resetModules();

    await expect(import("../../../src/config/env")).rejects.toThrow(
      "TWO_FACTOR_TRUSTED_DEVICE_SECRET must be at least 64 characters",
    );
  });

  it("starts successfully when trusted-device secret and JWT access secret differ", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      JWT_ACCESS_SECRET: "a".repeat(64),
      TWO_FACTOR_TRUSTED_DEVICE_SECRET: "b".repeat(64),
    };

    vi.resetModules();

    const module = await import("../../../src/config/env");
    expect(module.EnvSpace).toBeDefined();
  });

  it("reads trusted-device cookie sameSite from env", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      JWT_ACCESS_SECRET: "a".repeat(64),
      TWO_FACTOR_TRUSTED_DEVICE_SECRET: "b".repeat(64),
      TWO_FACTOR_TRUSTED_DEVICE_COOKIE_SAMESITE: "lax",
    };

    vi.resetModules();

    const module = await import("../../../src/config/env");
    expect(module.EnvSpace.twoFactorTrustedDeviceCookieSameSite).toBe("lax");
  });

  it("falls back to strict when trusted-device cookie sameSite is invalid", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      JWT_ACCESS_SECRET: "a".repeat(64),
      TWO_FACTOR_TRUSTED_DEVICE_SECRET: "b".repeat(64),
      TWO_FACTOR_TRUSTED_DEVICE_COOKIE_SAMESITE: "invalid-value",
    };

    vi.resetModules();

    const module = await import("../../../src/config/env");
    expect(module.EnvSpace.twoFactorTrustedDeviceCookieSameSite).toBe("strict");
  });

  it("reads trusted-device cookie domain from env", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      JWT_ACCESS_SECRET: "a".repeat(64),
      TWO_FACTOR_TRUSTED_DEVICE_SECRET: "b".repeat(64),
      TWO_FACTOR_TRUSTED_DEVICE_COOKIE_DOMAIN: " .qysyw.cn ",
    };

    vi.resetModules();

    const module = await import("../../../src/config/env");
    expect(module.EnvSpace.twoFactorTrustedDeviceCookieDomain).toBe(".qysyw.cn");
  });

  it("uses undefined when trusted-device cookie domain is empty", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      JWT_ACCESS_SECRET: "a".repeat(64),
      TWO_FACTOR_TRUSTED_DEVICE_SECRET: "b".repeat(64),
      TWO_FACTOR_TRUSTED_DEVICE_COOKIE_DOMAIN: "   ",
    };

    vi.resetModules();

    const module = await import("../../../src/config/env");
    expect(module.EnvSpace.twoFactorTrustedDeviceCookieDomain).toBeUndefined();
  });
});
