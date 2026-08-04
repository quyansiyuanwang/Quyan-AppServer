import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../../../src/services/auth/auth.service";
import { verifyPassword } from "../../../src/util/crypto";

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

    await expect(service.login("legacy-user", "password")).resolves.toEqual({
      requiresTwoFactor: true,
      challengeToken: "challenge-1",
      expiresIn: 300,
    });

    expect(userRepository.updateById).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ password: expect.any(String) }),
    );
    const [{ password: upgradedHash }] = userRepository.updateById.mock.calls[0].slice(1);
    expect(upgradedHash).not.toBe(legacyUser.password);
    expect(verifyPassword("password", upgradedHash)).toBe(true);
  });
});
