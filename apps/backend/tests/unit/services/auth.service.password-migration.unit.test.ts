import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../../../src/services/auth/auth.service";
import { hashPassword, verifyPassword, verifyPasswordCompatibility } from "../../../src/util/crypto";
import md5 from "md5";

describe("AuthService legacy password migration", () => {
  it("upgrades a verified legacy MD5 password before continuing the login flow", async () => {
    const legacyUser = {
      id: "user-1",
      username: "legacy-user",
      password: "5f4dcc3b5aa765d61d8327deb882cf99",
      status: 1,
    };
    const userRepository = {
      findByUsername: vi.fn().mockResolvedValue(legacyUser),
      updateById: vi.fn().mockResolvedValue(legacyUser),
    };
    const twoFactorService = {
      isTwoFactorEnabled: vi.fn().mockResolvedValue(true),
      isTrustedWithinWindow: vi.fn().mockResolvedValue(false),
      createLoginChallenge: vi.fn().mockResolvedValue({ challengeToken: "challenge-1", expiresIn: 300 }),
    };
    const businessLogService = { logOperation: vi.fn().mockResolvedValue(undefined) };
    const redisService = { isRedisAvailable: vi.fn().mockReturnValue(false) };

    const service = new (AuthService as unknown as new (...dependencies: any[]) => AuthService)(
      {},
      userRepository,
      {},
      businessLogService,
      {},
      {},
      twoFactorService,
      redisService,
      {},
      {},
      {},
      {},
    );

    await expect(service.login("legacy-user", "password")).rejects.toMatchObject({
      statusCode: 401,
      code: 1018,
      data: {
        challengeToken: "challenge-1",
        expiresIn: 300,
        purpose: "login",
        method: "code",
      },
    });

    expect(userRepository.updateById).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ password: expect.any(String) }),
    );
    const [{ password: upgradedHash }] = userRepository.updateById.mock.calls[0].slice(1);
    expect(upgradedHash).not.toBe(legacyUser.password);
    expect(verifyPassword("password", upgradedHash)).toBe(true);
  });

  it("keeps the upgraded updateTime for the completed login snapshot", async () => {
    const previousUpdateTime = new Date("2026-01-01T00:00:00.000Z");
    const upgradedUpdateTime = new Date("2026-01-01T00:00:01.000Z");
    const legacyUser = {
      id: "user-2",
      username: "legacy-user-2",
      password: "5f4dcc3b5aa765d61d8327deb882cf99",
      status: 1,
      updateTime: previousUpdateTime,
    };
    const upgradedUser = {
      ...legacyUser,
      password: hashPassword("password"),
      updateTime: upgradedUpdateTime,
    };
    const userRepository = {
      findByUsername: vi.fn().mockResolvedValue(legacyUser),
      updateById: vi.fn().mockResolvedValue(upgradedUser),
    };
    const twoFactorService = {
      isTwoFactorEnabled: vi.fn().mockResolvedValue(false),
    };
    const businessLogService = { logOperation: vi.fn().mockResolvedValue(undefined) };
    const redisService = { isRedisAvailable: vi.fn().mockReturnValue(false) };

    const service = new (AuthService as unknown as new (...dependencies: any[]) => AuthService)(
      {},
      userRepository,
      {},
      businessLogService,
      {},
      {},
      twoFactorService,
      redisService,
      {},
      {},
      {},
      {},
    );
    const completeLogin = vi
      .spyOn(service, "completeAuthenticatedLogin")
      .mockResolvedValue({ access_token: "access-token" } as any);

    await expect(service.login("legacy-user-2", "password")).resolves.toEqual({
      access_token: "access-token",
    });

    expect(completeLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-2",
        updateTime: upgradedUpdateTime,
      }),
      undefined,
      expect.objectContaining({ source: "password_login" }),
    );
  });

  it("accepts historical bcrypt(MD5(password)) hashes for both raw and MD5 credentials", () => {
    const rawPassword = "legacy-bcrypt-password";
    const historicalHash = hashPassword(md5(rawPassword));

    expect(verifyPasswordCompatibility(rawPassword, historicalHash)).toEqual({
      valid: true,
      needsRehash: true,
    });
    expect(verifyPasswordCompatibility(md5(rawPassword), historicalHash)).toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it("accepts the legacy client MD5 value for a legacy stored hash", () => {
    const rawPassword = "legacy-password";
    expect(verifyPasswordCompatibility(md5(rawPassword), md5(rawPassword))).toEqual({
      valid: true,
      needsRehash: true,
    });
  });
});
