import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TwoFactorService } from "../../../src/services/auth/two-factor.service";
import { UserRepository } from "../../../src/store/users/user.repository";
import { TwoFactorCredentialRepository } from "../../../src/store/auth/two-factor.repository";
import { RedisService } from "../../../src/services/infrastructure/redis.service";
import { RateLimiterService } from "../../../src/services/infrastructure/rate-limiter.service";
import { EmailService } from "../../../src/services/auth/email.service";
import { UnauthorizedError } from "../../../src/util/errors";
import { env } from "../../../src/config/env";
import {
  TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_DEFAULT,
  TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MAX,
  TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MIN,
} from "../../../src/constant/two-factor";

describe("TwoFactorService security hardening", () => {
  const originalEnv = { ...process.env };
  const originalTwoFactorConfig = { ...env.auth.twoFactor };
  const originalTrustWindowMinutes = env.auth.twoFactorTrustWindowMinutes;
  const originalTrustedDeviceSecret = env.auth.trustedDeviceSecret;
  const originalAccessTokenSecret = env.auth.accessTokenSecret;
  const trustedDeviceSecret = "a".repeat(64);

  beforeEach(() => {
    vi.restoreAllMocks();
    (TwoFactorService as any).instance = undefined;
    (RateLimiterService as any).instance = undefined;
    process.env.TWO_FACTOR_TRUSTED_DEVICE_SECRET = trustedDeviceSecret;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    (env.auth as any).twoFactor = { ...originalTwoFactorConfig };
    (env.auth as any).twoFactorTrustWindowMinutes = originalTrustWindowMinutes;
    (env.auth as any).trustedDeviceSecret = originalTrustedDeviceSecret;
    (env.auth as any).accessTokenSecret = originalAccessTokenSecret;
  });

  const createService = () => {
    const userRepo = {
      findById: vi.fn(),
      updateById: vi.fn(),
    };

    const credentialRepo = {
      findByUserId: vi.fn(),
      updateRecoveryCodeHashes: vi.fn(),
      updateLastUsedAt: vi.fn(),
      deleteByUserId: vi.fn(),
    };

    const redis = {
      set: vi.fn(),
      get: vi.fn(),
      ttl: vi.fn(),
      delete: vi.fn(),
      increment: vi.fn(),
      decrement: vi.fn(),
      setIfNotExists: vi.fn(),
      deleteIfValueMatches: vi.fn(),
      extendIfValueMatches: vi.fn(),
      getKeysByPattern: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
      isRedisAvailable: vi.fn().mockReturnValue(true),
    };

    const email = {
      verifyCode: vi.fn(),
      sendLoginVerificationCode: vi.fn(),
    };

    const rateLimiter = {
      assertNamedBackoffRateLimit: vi.fn(async (_policyName: string, context: { identifier: string }) => {
        const key = `two_factor:rate_limit:${context.identifier}`;
        const recordRaw = await redis.get(key);
        if (!recordRaw) return;
        const record = JSON.parse(recordRaw as string);
        const now = Date.now();
        if (record.lockoutUntil > now) {
          const _retryAfter = Math.max(1, Math.ceil((record.lockoutUntil - now) / 1000));
          const err = new Error("请求过于频繁，请稍后再试") as any;
          err.statusCode = 429;
          throw err;
        }
      }),
      markNamedBackoffRateLimitFailure: vi.fn(async (_policyName: string, context: { identifier: string }) => {
        const key = `two_factor:rate_limit:${context.identifier}`;
        const now = Date.now();
        const recordRaw = await redis.get(key);
        const existing = recordRaw ? JSON.parse(recordRaw as string) : null;
        const stale = !existing || now - existing.lastAttempt > 15 * 60 * 1000;
        if (stale) {
          await redis.set(key, JSON.stringify({ count: 1, lastAttempt: now, lockoutUntil: 0 }), 900);
          return;
        }
        const count = existing.count + 1;
        const overLimitCount = Math.max(0, count - 5 + 1);
        const backoff = overLimitCount <= 0 ? 0 : Math.min(1000 * 2 ** (overLimitCount - 1), 15 * 60 * 1000);
        await redis.set(
          key,
          JSON.stringify({ count, lastAttempt: now, lockoutUntil: backoff > 0 ? now + backoff : 0 }),
          900,
        );
      }),
      clearNamedBackoffRateLimit: vi.fn(async (_policyName: string, context: { identifier: string }) => {
        const key = `two_factor:rate_limit:${context.identifier}`;
        await redis.delete(key);
      }),
    };

    vi.spyOn(UserRepository, "getInstance").mockReturnValue(userRepo as any);
    vi.spyOn(TwoFactorCredentialRepository, "getInstance").mockReturnValue(credentialRepo as any);
    vi.spyOn(RedisService, "getInstance").mockReturnValue(redis as any);
    vi.spyOn(EmailService, "getInstance").mockReturnValue(email as any);
    vi.spyOn(RateLimiterService, "getInstance").mockReturnValue(rateLimiter as any);

    const service = TwoFactorService.getInstance() as any;
    return {
      service,
      mocks: {
        userRepo,
        credentialRepo,
        redis,
      },
    };
  };

  it("returns status with trusted-device pagination capabilities", async () => {
    const { service, mocks } = createService();

    mocks.userRepo.findById.mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: true,
      twoFactorPasskeyRequired: false,
    });
    mocks.credentialRepo.findByUserId.mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      recoveryCodeHashes: ["hash-1"],
    });

    const status = await service.getStatus("user-1");

    expect(status).toEqual({
      enabled: true,
      passkeyRequired: false,
      hasRecoveryCodes: true,
      trustedDeviceCapabilities: {
        pageSizeMin: TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MIN,
        pageSizeMax: TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_MAX,
        pageSizeDefault: TWO_FACTOR_TRUSTED_DEVICE_PAGE_SIZE_DEFAULT,
      },
    });
  });

  it("uses configurable TOTP window steps", () => {
    const fixedNow = 1800000000000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);

    const { service } = createService();
    const secret = "JBSWY3DPEHPK3PXP";
    const counter = Math.floor(fixedNow / 1000 / 30);
    const previousCode = service.generateTotpAtCounter(secret, counter - 1);

    (env.auth as any).twoFactor = {
      ...env.auth.twoFactor,
      totpWindowSteps: 0,
    };
    expect(service.verifyTotpCode(secret, previousCode)).toBe(false);

    (env.auth as any).twoFactor = {
      ...env.auth.twoFactor,
      totpWindowSteps: 1,
    };
    expect(service.verifyTotpCode(secret, previousCode)).toBe(true);
  });

  it("uses configurable recovery code count", () => {
    (env.auth as any).twoFactor = {
      ...env.auth.twoFactor,
      recoveryCodeCount: 12,
    };

    const { service } = createService();
    const configuredCount = service.getRecoveryCodeCount();
    const codes = service.generateRecoveryCodes(configuredCount);

    expect(configuredCount).toBe(12);
    expect(codes).toHaveLength(12);
    expect(new Set(codes).size).toBe(12);
  });

  it("removes only the matched recovery hash", async () => {
    const { service, mocks } = createService();

    const recoveryCode = "ABCD-EFGH";
    const hash = service.hashRecoveryCode(recoveryCode);
    const otherHash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    mocks.credentialRepo.findByUserId.mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      recoveryCodeHashes: [hash, otherHash],
    });
    mocks.credentialRepo.updateRecoveryCodeHashes.mockResolvedValue({});
    mocks.credentialRepo.updateLastUsedAt.mockResolvedValue({});

    await service.verifyUserFactorOrRecoveryCode("user-1", { recoveryCode });

    expect(mocks.credentialRepo.updateRecoveryCodeHashes).toHaveBeenCalledWith("user-1", [otherHash]);
  });

  it("returns a generic error when credential is missing", async () => {
    const { service, mocks } = createService();
    mocks.credentialRepo.findByUserId.mockResolvedValue(null);

    await expect(service.verifyUserFactorOrRecoveryCode("user-1", { recoveryCode: "ABCD-EFGH" })).rejects.toMatchObject(
      {
        message: "二次验证失败",
      },
    );
  });

  it("rejects payloads with multiple verification methods", async () => {
    const { service } = createService();

    await expect(
      service.verifyUserFactorOrRecoveryCode("user-1", {
        code: "123456",
        recoveryCode: "ABCD-EFGH",
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("regenerates recovery codes and invalidates old ones", async () => {
    const { service, mocks } = createService();

    const oldRecoveryCode = "ABCD-EFGH";
    const oldHash = service.hashRecoveryCode(oldRecoveryCode);

    mocks.userRepo.findById.mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: true,
    });
    mocks.credentialRepo.findByUserId.mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      recoveryCodeHashes: [oldHash],
    });
    mocks.credentialRepo.updateRecoveryCodeHashes.mockResolvedValue({});
    mocks.credentialRepo.updateLastUsedAt.mockResolvedValue({});

    const result = await service.regenerateRecoveryCodes("user-1", {
      recoveryCode: oldRecoveryCode,
    });

    expect(result.recoveryCodes.length).toBeGreaterThan(0);
    expect(mocks.credentialRepo.updateRecoveryCodeHashes).toHaveBeenCalledTimes(2);

    const updatedHashes = mocks.credentialRepo.updateRecoveryCodeHashes.mock.calls[1][1] as string[];
    mocks.credentialRepo.findByUserId.mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      recoveryCodeHashes: updatedHashes,
    });

    await expect(service.verifyUserFactorOrRecoveryCode("user-1", { recoveryCode: oldRecoveryCode })).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("returns login reminder once per cooldown interval", async () => {
    const { service, mocks } = createService();

    (env.auth as any).twoFactor = {
      ...env.auth.twoFactor,
      reminderEnabled: true,
      reminderIntervalDays: 7,
    };

    mocks.redis.setIfNotExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await service.consumeLoginReminder("user-1", false);
    const second = await service.consumeLoginReminder("user-1", false);

    expect(first).toMatchObject({
      shouldSetupTwoFactor: true,
      intervalDays: 7,
    });
    expect(second).toBeNull();
    expect(mocks.redis.setIfNotExists).toHaveBeenCalledTimes(2);
  });

  it("revokes user sessions when disabling 2FA", async () => {
    const { service, mocks } = createService();

    const recoveryCode = "ABCD-EFGH";
    const hash = service.hashRecoveryCode(recoveryCode);

    mocks.userRepo.findById.mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: true,
      twoFactorPasskeyRequired: true,
    });
    mocks.credentialRepo.findByUserId.mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      recoveryCodeHashes: [hash],
    });
    mocks.credentialRepo.updateRecoveryCodeHashes.mockResolvedValue({});
    mocks.credentialRepo.updateLastUsedAt.mockResolvedValue({});
    mocks.credentialRepo.deleteByUserId.mockResolvedValue({});
    mocks.userRepo.updateById.mockResolvedValue({
      id: "user-1",
      twoFactorEnabled: false,
      twoFactorPasskeyRequired: false,
    });

    const result = await service.disable("user-1", { recoveryCode });

    expect(result).toEqual({
      enabled: false,
      passkeyRequired: false,
    });
    expect(mocks.redis.set).toHaveBeenCalledWith(
      expect.stringContaining("auth:user_revoke_after:user-1"),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("applies exponential backoff lockout after repeated invalid verification attempts", async () => {
    const { service, mocks } = createService();

    mocks.credentialRepo.findByUserId.mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      recoveryCodeHashes: [],
    });

    const stateByKey = new Map<string, { count: number; lastAttempt: number; lockoutUntil: number }>();
    mocks.redis.get.mockImplementation(async (key: string) => {
      const state = stateByKey.get(key);
      return state ? JSON.stringify(state) : null;
    });
    mocks.redis.set.mockImplementation(async (key: string, value: string) => {
      stateByKey.set(key, JSON.parse(value));
    });
    mocks.redis.delete.mockImplementation(async (key: string) => {
      stateByKey.delete(key);
      return 1;
    });

    for (let index = 0; index < 5; index++)
      await expect(service.verifyUserFactorOrRecoveryCode("user-1", { code: "000000" })).rejects.toThrow(
        UnauthorizedError,
      );

    await expect(service.verifyUserFactorOrRecoveryCode("user-1", { code: "000000" })).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("clears redis rate-limit state after successful verification", async () => {
    const { service, mocks } = createService();
    const fixedNow = 1800000000000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);

    const secret = "JBSWY3DPEHPK3PXP";
    const counter = Math.floor(fixedNow / 1000 / 30);
    const validCode = service.generateTotpAtCounter(secret, counter);

    mocks.credentialRepo.findByUserId.mockResolvedValue({
      secret,
      recoveryCodeHashes: [],
    });
    mocks.credentialRepo.updateLastUsedAt.mockResolvedValue({});

    const rateLimitKey = "two_factor:rate_limit:two_factor:factor_verify:user-1";
    mocks.redis.get.mockResolvedValue(
      JSON.stringify({
        count: 3,
        lastAttempt: fixedNow,
        lockoutUntil: 0,
      }),
    );

    await service.verifyUserFactorOrRecoveryCode("user-1", { code: validCode });

    expect(mocks.redis.delete).toHaveBeenCalledWith(rateLimitKey);
  });

  it("rejects when redis-backed rate-limit state is still locked", async () => {
    const { service, mocks } = createService();
    const fixedNow = 1800000000000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);

    const rateLimitKey = "two_factor:rate_limit:two_factor:factor_verify:user-1";
    mocks.redis.get.mockImplementation(async (key: string) => {
      if (key === rateLimitKey)
        return JSON.stringify({
          count: 6,
          lastAttempt: fixedNow,
          lockoutUntil: fixedNow + 3000,
        });

      return null;
    });

    await expect(service.verifyUserFactorOrRecoveryCode("user-1", { code: "000000" })).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("issues and verifies versioned trusted-device token", () => {
    const { service } = createService();

    const deviceId = service.generateTrustedDeviceId();
    const token = service.createTrustedDeviceToken("user-1", deviceId);

    expect(token.startsWith("v1.")).toBe(true);
    expect(service.verifyTrustedDeviceToken("user-1", token)).toEqual({ deviceId });
  });

  it("keeps backward compatibility for legacy trusted-device token", () => {
    const { service } = createService();

    const deviceId = service.generateTrustedDeviceId();
    const signature = service.signTrustedDeviceTokenLegacy("user-1", deviceId);
    const legacyToken = `${deviceId}.${signature}`;

    expect(service.verifyTrustedDeviceToken("user-1", legacyToken)).toEqual({ deviceId });
  });

  it("invalidates trusted-device token after secret rotation", () => {
    const { service } = createService();

    const oldSecret = "a".repeat(64);
    const rotatedSecret = "b".repeat(64);
    (env.auth as any).trustedDeviceSecret = oldSecret;

    const deviceId = service.generateTrustedDeviceId();
    const token = service.createTrustedDeviceToken("user-1", deviceId);

    (env.auth as any).trustedDeviceSecret = rotatedSecret;

    expect(service.verifyTrustedDeviceToken("user-1", token)).toBeNull();
  });

  it("rejects malformed trusted-device tokens safely", () => {
    const { service } = createService();

    expect(service.verifyTrustedDeviceToken("user-1", "")).toBeNull();
    expect(service.verifyTrustedDeviceToken("user-1", "just-one-segment")).toBeNull();
    expect(service.verifyTrustedDeviceToken("user-1", `v1.${"a".repeat(63)}.sig`)).toBeNull();
    expect(service.verifyTrustedDeviceToken("user-1", `v2.${"a".repeat(64)}.sig`)).toBeNull();
    expect(service.verifyTrustedDeviceToken("user-1", `v1.${"a".repeat(64)}.***`)).toBeNull();
  });

  it("returns trusted devices sorted and tolerates malformed snapshot data", async () => {
    const { service, mocks } = createService();

    const deviceA = "a".repeat(64);
    const deviceB = "b".repeat(64);
    const malformed = "c".repeat(64);
    const keyA = `two_factor:trusted:user-1:${deviceA}`;
    const keyB = `two_factor:trusted:user-1:${deviceB}`;
    const malformedKey = `two_factor:trusted:user-1:${malformed}`;

    mocks.redis.getKeysByPattern.mockResolvedValue([keyA, keyB, malformedKey, keyA]);
    mocks.redis.get.mockImplementation(async (key: string) => {
      if (key === keyA)
        return JSON.stringify({
          version: 1,
          trustedAt: "2026-04-10T10:00:00.000Z",
          lastUsedAt: "2026-04-12T10:00:00.000Z",
          ipAddress: "127.0.0.1",
          userAgent: "Agent-A",
          fingerprint: "fp-a",
        });
      if (key === keyB)
        return JSON.stringify({
          version: 1,
          trustedAt: "2026-04-11T10:00:00.000Z",
          lastUsedAt: "2026-04-13T10:00:00.000Z",
          ipAddress: "127.0.0.2",
          userAgent: "Agent-B",
          fingerprint: null,
        });
      if (key === malformedKey) return "not-json";
      return null;
    });
    mocks.redis.ttl.mockImplementation(async (key: string) => {
      if (key === keyA) return 100;
      if (key === keyB) return 200;
      return 50;
    });

    const devices = await service.listTrustedDevicesWithinWindow("user-1");

    expect(mocks.redis.getKeysByPattern).toHaveBeenCalledWith("two_factor:trusted:user-1:*", 200);
    expect(devices).toHaveLength(3);
    expect(devices[0]).toMatchObject({ deviceId: deviceB });
    expect(devices[1]).toMatchObject({ deviceId: deviceA });
    expect(devices[2]).toMatchObject({
      deviceId: malformed,
      trustedAt: null,
      lastUsedAt: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  it("refreshes trusted-device lastUsedAt on trust hit", async () => {
    const { service, mocks } = createService();

    const deviceId = "a".repeat(64);
    const key = `two_factor:trusted:user-1:${deviceId}`;
    const revokedKey = `two_factor:trusted:revoked:user-1:${deviceId}`;
    const trustedToken = service.createTrustedDeviceToken("user-1", deviceId);

    mocks.redis.get.mockImplementation(async (currentKey: string) => {
      if (currentKey === revokedKey) return null;
      if (currentKey === key)
        return JSON.stringify({
          version: 1,
          trustedAt: "2026-04-10T10:00:00.000Z",
          lastUsedAt: "2026-04-11T10:00:00.000Z",
          ipAddress: "127.0.0.1",
          userAgent: "Agent-A",
          fingerprint: "fp-a",
        });

      return null;
    });
    mocks.redis.ttl.mockResolvedValue(120);

    const trusted = await service.isTrustedWithinWindow("user-1", {
      ipAddress: "127.0.0.1",
      userAgent: "Agent-A",
      fingerprint: "fp-a",
      trustedDeviceToken: trustedToken,
    });

    expect(trusted).toBe(true);
    expect(mocks.redis.set).toHaveBeenCalledWith(key, expect.any(String), 120);

    const setCall = mocks.redis.set.mock.calls.find((call: any[]) => call[0] === key);
    expect(setCall).toBeTruthy();

    const snapshot = JSON.parse(setCall?.[1] || "{}") as {
      trustedAt?: string;
      lastUsedAt?: string;
    };

    expect(snapshot.trustedAt).toBe("2026-04-10T10:00:00.000Z");
    expect(typeof snapshot.lastUsedAt).toBe("string");
  });

  it("reuses existing trusted device by fingerprint when token is missing", async () => {
    const { service, mocks } = createService();
    (env.auth as any).twoFactorTrustWindowMinutes = 30;

    const deviceA = "a".repeat(64);
    const deviceB = "b".repeat(64);
    const keyA = `two_factor:trusted:user-1:${deviceA}`;
    const keyB = `two_factor:trusted:user-1:${deviceB}`;
    const fingerprint = "fingerprint-1";

    mocks.redis.getKeysByPattern.mockResolvedValue([keyA, keyB]);
    mocks.redis.get.mockImplementation(async (key: string) => {
      if (key === keyA)
        return JSON.stringify({
          version: 1,
          trustedAt: "2026-04-12T10:00:00.000Z",
          ipAddress: "127.0.0.1",
          userAgent: "Agent-A",
          fingerprint,
        });
      if (key === keyB)
        return JSON.stringify({
          version: 1,
          trustedAt: "2026-04-11T10:00:00.000Z",
          ipAddress: "127.0.0.1",
          userAgent: "Agent-A",
          fingerprint,
        });

      return null;
    });
    mocks.redis.ttl.mockResolvedValue(1800);

    const result = await service.markTrustedWithinWindow("user-1", {
      ipAddress: "127.0.0.1",
      userAgent: "Agent-New",
      fingerprint,
      trustedDeviceToken: null,
    });

    expect(result).not.toBeNull();
    expect(result?.trustedDeviceToken).toContain(`.${deviceA}.`);
    expect(mocks.redis.set).toHaveBeenCalledWith(keyA, expect.any(String), 1800);
    expect(mocks.redis.deleteMany).toHaveBeenCalledWith([keyB]);
  });

  it("rejects invalid userId when removing trusted device", async () => {
    const { service, mocks } = createService();

    const removed = await service.removeTrustedDeviceWithinWindow("bad:user", "a".repeat(64));

    expect(removed).toBe(false);
    expect(mocks.redis.delete).not.toHaveBeenCalled();
  });

  it("requires TWO_FACTOR_TRUSTED_DEVICE_SECRET to be configured", () => {
    const { service } = createService();
    (env.auth as any).trustedDeviceSecret = "";

    const deviceId = service.generateTrustedDeviceId();
    expect(() => service.createTrustedDeviceToken("user-1", deviceId)).toThrow(
      "TWO_FACTOR_TRUSTED_DEVICE_SECRET must be configured",
    );
  });

  it("requires TWO_FACTOR_TRUSTED_DEVICE_SECRET to be strong enough", () => {
    const { service } = createService();
    (env.auth as any).trustedDeviceSecret = "short-secret";

    const deviceId = service.generateTrustedDeviceId();
    expect(() => service.createTrustedDeviceToken("user-1", deviceId)).toThrow(
      "TWO_FACTOR_TRUSTED_DEVICE_SECRET must be at least 64 characters",
    );
  });

  it("requires TWO_FACTOR_TRUSTED_DEVICE_SECRET to be different from JWT_ACCESS_SECRET", () => {
    const { service } = createService();
    (env.auth as any).accessTokenSecret = trustedDeviceSecret;
    (env.auth as any).trustedDeviceSecret = trustedDeviceSecret;

    const deviceId = service.generateTrustedDeviceId();
    expect(() => service.createTrustedDeviceToken("user-1", deviceId)).toThrow(
      "TWO_FACTOR_TRUSTED_DEVICE_SECRET must be different from JWT_ACCESS_SECRET",
    );
  });

  it("writes a short-lived revocation marker when removing trusted device", async () => {
    const { service, mocks } = createService();
    const deviceId = "a".repeat(64);

    mocks.redis.get.mockResolvedValue(
      JSON.stringify({
        version: 1,
        trustedAt: "2026-04-12T10:00:00.000Z",
        lastUsedAt: "2026-04-13T10:00:00.000Z",
        ipAddress: "127.0.0.1",
        userAgent: "Agent-A",
        fingerprint: null,
      }),
    );
    mocks.redis.delete.mockResolvedValue(1);

    const removed = await service.removeTrustedDeviceWithinWindow("user-1", deviceId);

    expect(removed).toBe(true);
    expect(mocks.redis.set).toHaveBeenCalledWith(`two_factor:trusted:revoked:user-1:${deviceId}`, "1", 30);
    expect(mocks.redis.delete).toHaveBeenCalledWith(`two_factor:trusted:user-1:${deviceId}`);
  });

  it("does not delete trusted device when ownership check fails", async () => {
    const { service, mocks } = createService();
    mocks.redis.get.mockResolvedValue(null);

    const deviceId = "a".repeat(64);
    const removed = await service.removeTrustedDeviceWithinWindow("user-1", deviceId);

    expect(removed).toBe(false);
    expect(mocks.redis.set).not.toHaveBeenCalledWith(`two_factor:trusted:revoked:user-1:${deviceId}`, "1", 30);
    expect(mocks.redis.delete).not.toHaveBeenCalledWith(`two_factor:trusted:user-1:${deviceId}`);
  });
});
