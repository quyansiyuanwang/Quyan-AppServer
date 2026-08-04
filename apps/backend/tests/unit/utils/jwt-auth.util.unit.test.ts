import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { env } from "@/config/env";
import { JWTAccessIns } from "@/util/auth";
import { RedisService } from "@/services/infrastructure/redis.service";

describe("JWT util auth", () => {
  const redisMock = {
    isJtiBlacklisted: vi.fn(),
    blacklistJti: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(RedisService, "getInstance").mockReturnValue(redisMock as any);
    redisMock.isJtiBlacklisted.mockResolvedValue(false);
    redisMock.blacklistJti.mockResolvedValue(undefined);
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("verifyToken returns null when decoded payload is a string", async () => {
    const token = jwt.sign("raw-string-payload", env.auth.accessTokenSecret);

    const payload = await JWTAccessIns.verifyToken(token);

    expect(payload).toBeNull();
    expect(redisMock.isJtiBlacklisted).not.toHaveBeenCalled();
  });

  it("verifyToken returns null when jti is blacklisted", async () => {
    redisMock.isJtiBlacklisted.mockResolvedValue(true);
    const token = JWTAccessIns.generateToken({
      userId: "u-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const payload = await JWTAccessIns.verifyToken(token);

    expect(payload).toBeNull();
    expect(redisMock.isJtiBlacklisted).toHaveBeenCalledTimes(1);
    expect(redisMock.isJtiBlacklisted).toHaveBeenCalledWith(expect.any(String));
  });

  it("verifyToken returns payload when jti is not blacklisted", async () => {
    redisMock.isJtiBlacklisted.mockResolvedValue(false);
    const token = JWTAccessIns.generateToken({
      userId: "u-2",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: 1,
    });

    const payload = await JWTAccessIns.verifyToken(token);

    expect(payload).toEqual(
      expect.objectContaining({
        userId: "u-2",
        status: 1,
      }),
    );
    expect(payload?.jti).toBeTruthy();
  });

  it("verifyToken returns null when user sessions are revoked", async () => {
    redisMock.isJtiBlacklisted.mockResolvedValue(false);
    const token = JWTAccessIns.generateToken({
      userId: "u-4",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const decoded = jwt.decode(token) as { iat?: number };
    const revokedAfter = (decoded.iat || Math.floor(Date.now() / 1000)) + 1;
    redisMock.get.mockResolvedValue(String(revokedAfter));

    const payload = await JWTAccessIns.verifyToken(token);

    expect(payload).toBeNull();
  });

  it("revokeToken blacklists token jti with positive ttl", async () => {
    const token = JWTAccessIns.generateToken({
      userId: "u-3",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await JWTAccessIns.revokeToken(token);

    expect(redisMock.blacklistJti).toHaveBeenCalledTimes(1);
    const [jti, ttl] = redisMock.blacklistJti.mock.calls[0];
    expect(typeof jti).toBe("string");
    expect(jti.length).toBeGreaterThan(0);
    expect(ttl).toBeGreaterThan(0);
  });

  it("revokeToken ignores invalid token errors", async () => {
    await expect(JWTAccessIns.revokeToken("invalid-token")).resolves.toBeUndefined();
    expect(redisMock.blacklistJti).not.toHaveBeenCalled();
  });
});
