import { describe, expect, it } from "vitest";
import { buildAuthConfig } from "@/config/env/auth";
import { buildRuntimeConfig } from "@/config/env/runtime";
import type { EnvSnapshot } from "@/config/env/source";

describe("central-login default origins", () => {
  it("allows the local legacy frontend as an exact first-party origin", () => {
    const source = {
      NODE_ENV: "development",
      PORT: "10001",
      ROOT_DOMAIN: "qysyw.test",
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
    } as EnvSnapshot;
    const runtime = buildRuntimeConfig(source);
    const config = buildAuthConfig(source, runtime);

    expect(config.centralLogin.allowedOrigins).toContain("https://legacy.qysyw.test:5174");
    expect(runtime.corsAllowedOrigins).toContain("https://ai.console.qysyw.test:5173");
    expect(config.refreshCookie.domain).toBe(".qysyw.test");
    expect(config.sessionCookie.domain).toBe(".qysyw.test");
  });

  it("derives exact production origins from ROOT_DOMAIN", () => {
    const source = {
      NODE_ENV: "production",
      PORT: "10001",
      ROOT_DOMAIN: "md.qysyw.cn",
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      AUTH_CENTER_JWT_PRIVATE_KEY: "test-private-key",
      AUTH_CENTER_JWT_PUBLIC_KEY: "test-public-key",
    } as EnvSnapshot;
    const runtime = buildRuntimeConfig(source);
    const auth = buildAuthConfig(source, runtime);

    expect(runtime.corsAllowedOrigins).toContain("https://ai.console.md.qysyw.cn");
    expect(auth.centralLogin.allowedOrigins).toContain("https://auth.md.qysyw.cn");
    expect(auth.webAuthn).toMatchObject({
      rpId: "md.qysyw.cn",
      origins: ["https://auth.md.qysyw.cn"],
    });
    expect(auth.social.frontendBaseUrl).toBe("https://auth.md.qysyw.cn");
    expect(auth.authCenter.issuer).toBe("https://api.md.qysyw.cn/auth-center");
  });

  it("expands additional trusted roots into exact origins", () => {
    const source = {
      NODE_ENV: "production",
      PORT: "10001",
      ROOT_DOMAIN: "qysyw.cn",
      ADDITIONAL_ROOT_DOMAINS: "md.qysyw.cn",
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      AUTH_CENTER_JWT_PRIVATE_KEY: "test-private-key",
      AUTH_CENTER_JWT_PUBLIC_KEY: "test-public-key",
    } as EnvSnapshot;
    const runtime = buildRuntimeConfig(source);
    const auth = buildAuthConfig(source, runtime);

    expect(runtime.trustedRootDomains).toEqual(["qysyw.cn", "md.qysyw.cn"]);
    expect(runtime.corsAllowedOrigins).toContain("https://terminal.md.qysyw.cn");
    expect(auth.centralLogin.allowedOrigins).toContain("https://auth.md.qysyw.cn");
    expect(auth.webAuthn.origins).toEqual(["https://auth.qysyw.cn", "https://auth.md.qysyw.cn"]);
    expect(auth.centralLogin.allowedOrigins).not.toContain("https://*.md.qysyw.cn");
  });

  it("rejects WebAuthn origins outside the configured auth site family", () => {
    const source = {
      NODE_ENV: "production",
      PORT: "10001",
      ROOT_DOMAIN: "qysyw.cn",
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      AUTH_CENTER_JWT_PRIVATE_KEY: "test-private-key",
      AUTH_CENTER_JWT_PUBLIC_KEY: "test-public-key",
      WEBAUTHN_ALLOWED_ORIGINS: "https://www.qysyw.cn",
    } as EnvSnapshot;
    const runtime = buildRuntimeConfig(source);

    expect(() => buildAuthConfig(source, runtime)).toThrow(
      "WEBAUTHN_ALLOWED_ORIGINS may only include exact auth origins",
    );
  });
});
