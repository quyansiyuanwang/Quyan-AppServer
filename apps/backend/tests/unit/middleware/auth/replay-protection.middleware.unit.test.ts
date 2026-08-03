import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Response } from "express";
import { CustomCode } from "@/constant/custom-code";
import { RedisService } from "@/services/infrastructure/redis.service";
import { createTestReplaySigningMaterial, TEST_REPLAY_CLIENT_FINGERPRINT } from "@/util/replay-signing-session";

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
  },
}));

vi.mock("@/util/logger", () => ({
  LogCategory: { SECURITY: "SECURITY" },
  getLogger: () => loggerMock,
}));

import { generateSign, replayProtectionMiddleware } from "@/middleware/auth/replay-protection.middleware";

describe("replayProtectionMiddleware", () => {
  const redisMock = {
    isRedisAvailable: vi.fn(),
    setIfNotExists: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(RedisService, "getInstance").mockReturnValue(redisMock as any);
    redisMock.isRedisAvailable.mockReturnValue(true);
    redisMock.setIfNotExists.mockResolvedValue(true);
  });

  function createRequest() {
    const body = { username: "tester", password: "secret" };
    const nonce = "nonce-1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const path = "/auth/login";
    const signingMaterial = createTestReplaySigningMaterial();

    return {
      body,
      headers: {
        "x-nonce": nonce,
        "x-timestamp": timestamp,
        "x-sign": generateSign(nonce, timestamp, JSON.stringify(body), path, signingMaterial.signingKey),
        "x-replay-session-id": signingMaterial.sessionId,
        "x-client-fingerprint": TEST_REPLAY_CLIENT_FINGERPRINT,
      },
      method: "POST",
      path,
      ip: "127.0.0.1",
    } as any;
  }

  it("rejects when redis is unavailable", async () => {
    redisMock.isRedisAvailable.mockReturnValue(false);
    const next = vi.fn() as unknown as NextFunction;

    await expect(replayProtectionMiddleware(createRequest(), {} as Response, next)).rejects.toMatchObject({
      statusCode: 503,
      code: CustomCode.REPLAY_PROTECTION_FAILED,
    });

    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when nonce reservation backend returns null", async () => {
    redisMock.setIfNotExists.mockResolvedValue(null);
    const next = vi.fn() as unknown as NextFunction;

    await expect(replayProtectionMiddleware(createRequest(), {} as Response, next)).rejects.toMatchObject({
      statusCode: 503,
      code: CustomCode.REPLAY_PROTECTION_FAILED,
    });

    expect(next).not.toHaveBeenCalled();
  });

  it("continues when nonce reservation succeeds", async () => {
    const next = vi.fn() as unknown as NextFunction;

    await expect(replayProtectionMiddleware(createRequest(), {} as Response, next)).resolves.toBeUndefined();

    expect(redisMock.setIfNotExists).toHaveBeenCalledWith(
      "replay:nonce:test:test-replay-client-fingerprint:nonce-1",
      "1",
      600000,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
