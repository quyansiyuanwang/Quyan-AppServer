import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";

describe("createApp CORS configuration", () => {
  const originalAllowedOrigins = env.runtime.corsAllowedOrigins;

  afterEach(() => {
    (env.runtime as any).corsAllowedOrigins = originalAllowedOrigins;
  });

  it("allows any origin when CORS_ALLOWED_ORIGINS is empty", async () => {
    (env.runtime as any).corsAllowedOrigins = "";
    const app = createApp();
    const origin = "https://any-origin.example";

    const response = await request(app).get("/__cors_probe_any").set("Origin", origin);

    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("allows configured origin and rejects non-allowlisted origin", async () => {
    (env.runtime as any).corsAllowedOrigins = "https://allowed.example,https://another.example";
    const app = createApp();

    const allowedResponse = await request(app).get("/__cors_probe_allowed").set("Origin", "https://allowed.example");
    expect(allowedResponse.headers["access-control-allow-origin"]).toBe("https://allowed.example");
    expect(allowedResponse.headers["access-control-allow-credentials"]).toBe("true");

    const blockedResponse = await request(app).get("/__cors_probe_blocked").set("Origin", "https://blocked.example");
    expect(blockedResponse.status).toBe(500);
    expect(blockedResponse.body?.message).toBe("Not allowed by CORS");
    expect(blockedResponse.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("includes credentials on allowed preflight requests", async () => {
    (env.runtime as any).corsAllowedOrigins = "https://allowed.example";
    const app = createApp();

    const response = await request(app)
      .options("/auth/login")
      .set("Origin", "https://allowed.example")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe("https://allowed.example");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("ignores malformed allowlist entries and keeps valid origins only", async () => {
    (env.runtime as any).corsAllowedOrigins = "invalid-origin,https://allowed.example,not-a-url";
    const app = createApp();

    const allowedResponse = await request(app)
      .get("/__cors_probe_mixed_allowed")
      .set("Origin", "https://allowed.example");
    expect(allowedResponse.headers["access-control-allow-origin"]).toBe("https://allowed.example");

    const blockedResponse = await request(app)
      .get("/__cors_probe_mixed_blocked")
      .set("Origin", "https://blocked.example");
    expect(blockedResponse.status).toBe(500);
    expect(blockedResponse.body?.message).toBe("Not allowed by CORS");
  });

  it("supports wildcard subdomain allowlist entries", async () => {
    (env.runtime as any).corsAllowedOrigins = "https://*.qysyw.cn,https://qysyw.cn";
    const app = createApp();

    const rootResponse = await request(app).get("/__cors_probe_wildcard_root").set("Origin", "https://qysyw.cn");
    expect(rootResponse.headers["access-control-allow-origin"]).toBe("https://qysyw.cn");

    const subdomainResponse = await request(app)
      .get("/__cors_probe_wildcard_subdomain")
      .set("Origin", "https://admin.qysyw.cn");
    expect(subdomainResponse.headers["access-control-allow-origin"]).toBe("https://admin.qysyw.cn");

    const blockedResponse = await request(app)
      .get("/__cors_probe_wildcard_blocked")
      .set("Origin", "https://qysyw.cn.evil.example");
    expect(blockedResponse.status).toBe(500);
    expect(blockedResponse.body?.message).toBe("Not allowed by CORS");
  });

  it("supports regex allowlist entries", async () => {
    (env.runtime as any).corsAllowedOrigins = "regex:^https://([a-z0-9-]+\\.)*qysyw\\.cn$";
    const app = createApp();

    const allowedResponse = await request(app)
      .get("/__cors_probe_regex_allowed")
      .set("Origin", "https://relay.qysyw.cn");
    expect(allowedResponse.headers["access-control-allow-origin"]).toBe("https://relay.qysyw.cn");

    const blockedResponse = await request(app)
      .get("/__cors_probe_regex_blocked")
      .set("Origin", "https://relay.qysyw.com");
    expect(blockedResponse.status).toBe(500);
    expect(blockedResponse.body?.message).toBe("Not allowed by CORS");
  });
});
