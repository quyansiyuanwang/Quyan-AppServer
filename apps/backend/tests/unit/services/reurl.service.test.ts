import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReURLService } from "../../../src/services/system/reurl.service";
import { RedisService } from "../../../src/services/infrastructure/redis.service";

describe("ReURLService", () => {
  const redisStore = new Map<string, string>();

  const redisMock = {
    set: vi.fn(async (key: string, value: string | number, _ttl?: number) => {
      redisStore.set(key, String(value));
    }),
    get: vi.fn(async (key: string) => redisStore.get(key) || null),
    delete: vi.fn(async (key: string) => {
      const existed = redisStore.has(key);
      redisStore.delete(key);
      return existed ? 1 : 0;
    }),
    isRedisAvailable: vi.fn(() => true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
    (ReURLService as any).instance = undefined;
    vi.spyOn(RedisService, "getInstance").mockReturnValue(redisMock as any);
  });

  it("returns singleton instance", () => {
    const first = ReURLService.getInstance();
    const second = ReURLService.getInstance();

    expect(first).toBe(second);
  });

  it("generates unique reurl ids", () => {
    const service = ReURLService.getInstance();

    const id1 = service.generateReURL("token-1", 60);
    const id2 = service.generateReURL("token-1", 60);

    expect(id1).not.toBe(id2);
  });

  it("stores and resolves token via redis", async () => {
    const service = ReURLService.getInstance();

    const reurlId = service.generateReURL("jwt-token", 60);
    const token = await service.getToken(reurlId);

    expect(token).toBe("jwt-token");
    expect(redisMock.set).toHaveBeenCalledTimes(1);
    expect(redisMock.get).toHaveBeenCalledWith(`reurl:token:${reurlId}`);
  });

  it("returns undefined when token does not exist", async () => {
    const service = ReURLService.getInstance();

    const token = await service.getToken("missing-id");

    expect(token).toBeUndefined();
  });

  it("revokes token by deleting redis key", async () => {
    const service = ReURLService.getInstance();

    const reurlId = service.generateReURL("jwt-token", 60);
    await service.revokeReURL(reurlId);

    const token = await service.getToken(reurlId);
    expect(token).toBeUndefined();
    expect(redisMock.delete).toHaveBeenCalledWith(`reurl:token:${reurlId}`);
  });

  it("normalizes ttl to at least one second", () => {
    const service = ReURLService.getInstance();

    service.generateReURL("jwt-token", 0);

    expect(redisMock.set).toHaveBeenCalledWith(expect.any(String), "jwt-token", 1);
  });

  it("keeps non-cache stats contract", () => {
    const service = ReURLService.getInstance();

    expect(service.getStats()).toEqual({
      size: -1,
      max: -1,
    });
  });
});
