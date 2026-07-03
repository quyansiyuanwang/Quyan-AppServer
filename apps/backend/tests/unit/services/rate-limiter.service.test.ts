import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiterService } from "../../../src/services/infrastructure/rate-limiter.service";
import { RedisService } from "../../../src/services/infrastructure/redis.service";
import { EmailRateLimitLogRepository } from "../../../src/store/auth/email-rate-limit-log.repository";

describe("RateLimiterService Redis fallback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (RateLimiterService as any).instance = undefined;
  });

  const createService = (redisAvailable: boolean) => {
    const redisMock = {
      isRedisAvailable: vi.fn().mockReturnValue(redisAvailable),
      get: vi.fn().mockResolvedValue("0"),
      ttl: vi.fn().mockResolvedValue(0),
      increment: vi.fn().mockResolvedValue(1),
    };

    const repoMock = {
      create: vi.fn(),
      countRequests: vi.fn().mockResolvedValue(0),
      findOldestRequest: vi.fn().mockResolvedValue(null),
      deleteOlderThan: vi.fn().mockResolvedValue(0),
    };

    vi.spyOn(RedisService, "getInstance").mockReturnValue(redisMock as any);
    vi.spyOn(EmailRateLimitLogRepository, "getInstance").mockReturnValue(repoMock as any);

    const service = RateLimiterService.getInstance();
    return {
      service,
      mocks: {
        redisMock,
      },
    };
  };

  it("fails open when Redis is unavailable", async () => {
    const { service, mocks } = createService(false);

    const result = await service.checkTwoFactorVerificationRateLimit("127.0.0.1", "challenge-token");

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("RATE_LIMIT_BACKEND_UNAVAILABLE");
    expect(mocks.redisMock.get).not.toHaveBeenCalled();
  });

  it("skips write operations when Redis is unavailable", async () => {
    const { service, mocks } = createService(false);

    await service.logTwoFactorEmailSendAttempt("127.0.0.1", "challenge-token");

    expect(mocks.redisMock.increment).not.toHaveBeenCalled();
  });

  it("keeps existing deny behavior when Redis is available", async () => {
    const { service, mocks } = createService(true);

    mocks.redisMock.get.mockResolvedValueOnce("20").mockResolvedValueOnce("0");
    mocks.redisMock.ttl.mockResolvedValueOnce(35);

    const result = await service.checkTwoFactorVerificationRateLimit("127.0.0.1", "challenge-token");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TWO_FACTOR_IP_RATE_LIMIT_EXCEEDED");
    expect(result.retryAfter).toBe(35);
  });

  it("fails open for trusted-device operation checks when Redis is unavailable", async () => {
    const { service, mocks } = createService(false);

    const result = await service.checkTwoFactorTrustedDeviceOperationRateLimit("127.0.0.1", "user-1");

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("RATE_LIMIT_BACKEND_UNAVAILABLE");
    expect(mocks.redisMock.get).not.toHaveBeenCalled();
  });

  it("denies trusted-device operations when per-user limit is exceeded", async () => {
    const { service, mocks } = createService(true);

    mocks.redisMock.get.mockResolvedValueOnce("0").mockResolvedValueOnce("30");
    mocks.redisMock.ttl.mockResolvedValueOnce(42);

    const result = await service.checkTwoFactorTrustedDeviceOperationRateLimit("127.0.0.1", "user-1");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TWO_FACTOR_TRUSTED_DEVICE_USER_RATE_LIMIT_EXCEEDED");
    expect(result.retryAfter).toBe(42);
  });

  it("records trusted-device operation attempts into both ip and user buckets", async () => {
    const { service, mocks } = createService(true);

    await service.logTwoFactorTrustedDeviceOperationAttempt("127.0.0.1", "user-1");

    expect(mocks.redisMock.increment).toHaveBeenCalledTimes(2);
    expect(mocks.redisMock.increment).toHaveBeenCalledWith(expect.stringContaining("2fa_trusted_device:ip"), 600);
    expect(mocks.redisMock.increment).toHaveBeenCalledWith(expect.stringContaining("2fa_trusted_device:user"), 600);
  });
});
