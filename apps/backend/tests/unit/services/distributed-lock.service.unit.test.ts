import { beforeEach, describe, expect, it, vi } from "vitest";
import { DistributedLockService } from "../../../src/services/infrastructure/distributed-lock.service";
import { RedisService } from "../../../src/services/infrastructure/redis.service";

describe("DistributedLockService", () => {
  const redisMock = {
    isRedisAvailable: vi.fn(),
    setIfNotExists: vi.fn(),
    deleteIfValueMatches: vi.fn(),
    extendIfValueMatches: vi.fn(),
  };

  const DistributedLockCtor = DistributedLockService as unknown as new (...args: any[]) => DistributedLockService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(RedisService, "getInstance").mockReturnValue(redisMock as any);
    redisMock.isRedisAvailable.mockReturnValue(true);
  });

  it("acquires lock when redis grants key", async () => {
    redisMock.setIfNotExists.mockResolvedValue(true);

    const service = new DistributedLockCtor(redisMock);
    const handle = await service.acquire("lock:test", { ttlMs: 1000 });

    expect(handle.acquired).toBe(true);
    expect(handle.key).toBe("lock:test");
    expect(handle.ownerToken.length).toBeGreaterThan(0);
  });

  it("releases lock with owner token", async () => {
    redisMock.setIfNotExists.mockResolvedValue(true);
    redisMock.deleteIfValueMatches.mockResolvedValue(true);

    const service = new DistributedLockCtor(redisMock);
    const handle = await service.acquire("lock:test", { ttlMs: 1000 });
    const released = await service.release(handle);

    expect(released).toBe(true);
    expect(redisMock.deleteIfValueMatches).toHaveBeenCalledWith(handle.key, handle.ownerToken);
  });

  it("runWithLock executes task under lock", async () => {
    redisMock.setIfNotExists.mockResolvedValue(true);
    redisMock.deleteIfValueMatches.mockResolvedValue(true);

    const service = new DistributedLockCtor(redisMock);

    const result = await service.runWithLock("lock:test", async () => "ok", { ttlMs: 1000 });

    expect(result).toBe("ok");
    expect(redisMock.setIfNotExists).toHaveBeenCalled();
    expect(redisMock.deleteIfValueMatches).toHaveBeenCalled();
  });

  it("buildKey creates normalized lock key", () => {
    const key = DistributedLockService.buildKey("billing", "charge", "user-1");
    expect(key).toBe("lock:billing:charge:user-1");
  });
});
