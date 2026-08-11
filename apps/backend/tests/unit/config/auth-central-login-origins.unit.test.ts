import { describe, expect, it } from "vitest";
import { buildAuthConfig } from "@/config/env/auth";
import type { EnvSnapshot } from "@/config/env/source";

describe("central-login default origins", () => {
  it("allows the local legacy frontend as an exact first-party origin", () => {
    const config = buildAuthConfig(
      {
        JWT_ACCESS_SECRET: "test-access-secret",
        JWT_REFRESH_SECRET: "test-refresh-secret",
      } as EnvSnapshot,
      { isProduction: false, isTest: true, port: 10001 },
    );

    expect(config.centralLogin.allowedOrigins).toContain("https://legacy.qysyw.test:5174");
  });
});
