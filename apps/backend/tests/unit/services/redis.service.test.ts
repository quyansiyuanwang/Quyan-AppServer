import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createRedisClientMock } = vi.hoisted(() => ({
  createRedisClientMock: vi.fn(),
}));

vi.mock("../../../src/config/redis", () => ({
  createRedisClient: createRedisClientMock,
}));

import { RedisService } from "../../../src/services/infrastructure/redis.service";

describe("RedisService circuit breaker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T00:00:00.000Z"));
    createRedisClientMock.mockReset();
    (RedisService as any).instance = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens circuit after repeated failures and short-circuits subsequent requests", async () => {
    const redisClientMock = {
      get: vi.fn().mockRejectedValue(new Error("boom")),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createRedisClientMock.mockReturnValue(redisClientMock as any);

    const redisService = RedisService.getInstance();

    for (let i = 0; i < 5; i++) await redisService.get("k");
    await redisService.get("k");

    expect(redisClientMock.get).toHaveBeenCalledTimes(5);
  });

  it("enters half-open state and closes circuit after successful probe", async () => {
    const redisClientMock = {
      get: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom-1"))
        .mockRejectedValueOnce(new Error("boom-2"))
        .mockRejectedValueOnce(new Error("boom-3"))
        .mockRejectedValueOnce(new Error("boom-4"))
        .mockRejectedValueOnce(new Error("boom-5"))
        .mockResolvedValueOnce("recovered")
        .mockResolvedValueOnce("normal"),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createRedisClientMock.mockReturnValue(redisClientMock as any);

    const redisService = RedisService.getInstance();

    for (let i = 0; i < 5; i++) await redisService.get("k");

    // While circuit is open, request should be short-circuited.
    await expect(redisService.get("k")).resolves.toBeNull();
    expect(redisClientMock.get).toHaveBeenCalledTimes(5);

    vi.advanceTimersByTime(30_000);

    // First request after cool-down becomes half-open probe and succeeds.
    await expect(redisService.get("k")).resolves.toBe("recovered");
    expect(redisClientMock.get).toHaveBeenCalledTimes(6);

    // Circuit should now be closed and requests should flow normally.
    await expect(redisService.get("k")).resolves.toBe("normal");
    expect(redisClientMock.get).toHaveBeenCalledTimes(7);
  });

  it("setIfNotExists uses NX semantics", async () => {
    const redisClientMock = {
      set: vi.fn().mockResolvedValueOnce("OK").mockResolvedValueOnce(null),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createRedisClientMock.mockReturnValue(redisClientMock as any);

    const redisService = RedisService.getInstance();

    await expect(redisService.setIfNotExists("lock:key", "owner-1", 1000)).resolves.toBe(true);
    await expect(redisService.setIfNotExists("lock:key", "owner-2", 1000)).resolves.toBe(false);
  });

  it("deleteIfValueMatches removes only owner-held locks", async () => {
    const redisClientMock = {
      eval: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createRedisClientMock.mockReturnValue(redisClientMock as any);

    const redisService = RedisService.getInstance();

    await expect(redisService.deleteIfValueMatches("lock:key", "owner-1")).resolves.toBe(true);
    await expect(redisService.deleteIfValueMatches("lock:key", "owner-2")).resolves.toBe(false);
  });

  it("extendIfValueMatches extends ttl only for matching owner", async () => {
    const redisClientMock = {
      eval: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createRedisClientMock.mockReturnValue(redisClientMock as any);

    const redisService = RedisService.getInstance();

    await expect(redisService.extendIfValueMatches("lock:key", "owner-1", 5000)).resolves.toBe(true);
    await expect(redisService.extendIfValueMatches("lock:key", "owner-2", 5000)).resolves.toBe(false);
  });

  it("acquireSemaphoreSlot returns slot key when available", async () => {
    const redisClientMock = {
      eval: vi.fn().mockResolvedValueOnce("relay:concurrency:default:user-1:slot:2").mockResolvedValueOnce(""),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createRedisClientMock.mockReturnValue(redisClientMock as any);

    const redisService = RedisService.getInstance();

    await expect(
      redisService.acquireSemaphoreSlot("relay:concurrency:default:user-1", 3, "owner-1", 5000),
    ).resolves.toBe("relay:concurrency:default:user-1:slot:2");
    await expect(
      redisService.acquireSemaphoreSlot("relay:concurrency:default:user-1", 3, "owner-1", 5000),
    ).resolves.toBe(false);
  });

  it("reserveSemaphoreQueueTicket stores and returns a FIFO ticket", async () => {
    const redisClientMock = {
      eval: vi.fn().mockResolvedValueOnce(4),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createRedisClientMock.mockReturnValue(redisClientMock as any);

    const redisService = RedisService.getInstance();

    await expect(
      redisService.reserveSemaphoreQueueTicket("relay:concurrency:image:global", "owner-1", 5000),
    ).resolves.toBe(4);
  });

  it("tryAcquireQueuedSemaphoreSlot returns wait, stale, or a slot key", async () => {
    const redisClientMock = {
      eval: vi
        .fn()
        .mockResolvedValueOnce("WAIT")
        .mockResolvedValueOnce("STALE")
        .mockResolvedValueOnce("relay:concurrency:image:global:slot:1"),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createRedisClientMock.mockReturnValue(redisClientMock as any);

    const redisService = RedisService.getInstance();

    await expect(
      redisService.tryAcquireQueuedSemaphoreSlot("relay:concurrency:image:global", 2, "owner-1", 5000, 1),
    ).resolves.toBe("wait");
    await expect(
      redisService.tryAcquireQueuedSemaphoreSlot("relay:concurrency:image:global", 2, "owner-1", 5000, 1),
    ).resolves.toBe("stale");
    await expect(
      redisService.tryAcquireQueuedSemaphoreSlot("relay:concurrency:image:global", 2, "owner-1", 5000, 1),
    ).resolves.toBe("relay:concurrency:image:global:slot:1");
  });

  it("cancelSemaphoreQueueTicket clears a queued waiter", async () => {
    const redisClientMock = {
      eval: vi.fn().mockResolvedValueOnce(1),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    createRedisClientMock.mockReturnValue(redisClientMock as any);

    const redisService = RedisService.getInstance();

    await expect(redisService.cancelSemaphoreQueueTicket("relay:concurrency:image:global", 3, "owner-1")).resolves.toBe(
      true,
    );
  });
});
