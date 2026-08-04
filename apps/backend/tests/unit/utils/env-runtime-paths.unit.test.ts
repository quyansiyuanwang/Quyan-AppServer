import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("env runtime path guards", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();

  afterEach(() => {
    process.env = { ...originalEnv };
    process.chdir(originalCwd);
    vi.resetModules();
  });

  it("throws when started with cwd inside dist", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "env-dist-guard-"));
    const distDir = path.join(tempRoot, "dist");
    fs.mkdirSync(distDir, { recursive: true });

    process.chdir(distDir);
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      PORT: "10001",
      DATABASE_URL: "mysql://root:password@localhost:3306/app_test",
      JWT_ACCESS_SECRET: "a".repeat(64),
      JWT_REFRESH_SECRET: "b".repeat(64),
      TWO_FACTOR_TRUSTED_DEVICE_SECRET: "c".repeat(64),
    };

    vi.resetModules();

    await expect(import("../../../src/config/env")).rejects.toThrow(
      "Backend must not be started with process.cwd() inside dist",
    );
  });

  it("prefers explicit ENV_FILE_PATH when loading .env", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "env-explicit-path-"));
    const explicitEnvPath = path.join(tempRoot, ".env");

    fs.writeFileSync(
      explicitEnvPath,
      [
        "PORT=19001",
        "DATABASE_URL=mysql://root:password@localhost:3306/app_test",
        "PROTECTED_GROUP_NAME=admin",
        "REDIS_HOST=127.0.0.1",
        "REDIS_PASSWORD=",
        `JWT_ACCESS_SECRET=${"a".repeat(64)}`,
        `JWT_REFRESH_SECRET=${"b".repeat(64)}`,
        `TWO_FACTOR_TRUSTED_DEVICE_SECRET=${"c".repeat(64)}`,
      ].join("\n"),
      "utf8",
    );

    process.chdir(tempRoot);
    process.env = {
      ...originalEnv,
      NODE_ENV: "development",
      ENV_FILE_PATH: explicitEnvPath,
    };

    delete process.env.PORT;
    delete process.env.DATABASE_URL;
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.TWO_FACTOR_TRUSTED_DEVICE_SECRET;

    vi.resetModules();

    const module = await import("../../../src/config/env");
    expect(module.env.runtime.port).toBe(19001);
    expect(module.env.database.hiddenUrl).toContain("****@");
  });
});
