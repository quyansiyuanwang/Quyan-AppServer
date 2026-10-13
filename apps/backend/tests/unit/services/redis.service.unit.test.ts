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

  it("performs exactly one atomic IP write with the original address keys", async () => {
    const client = { eval: vi.fn().mockResolvedValue(1), quit: vi.fn() };
    createRedisClientMock.mockReturnValue(client as any);
    const service = RedisService.getInstance(),
      ip = "2001:0DB8::1";
    expect(await service.writeIpErrorWeightWithResult(ip, { kind: "set", weight: 0 })).toBe(true);
    expect(client.eval).toHaveBeenCalledTimes(1);
    expect(client.eval.mock.calls[0]!.slice(1)).toEqual([
      4,
      RedisService.getIpErrorWeightKey(ip),
      RedisService.getIpErrorWeightTsKey(ip),
      RedisService.getIpErrorKey(ip),
      RedisService.getIpErrorBreakdownKey(ip),
      "set",
      "0",
      String(Date.now()),
    ]);
  });
  it.each([null, 0, "1"])("refuses unexpected IP mutation reply %s", async (reply) => {
    const client = { eval: vi.fn().mockResolvedValue(reply), quit: vi.fn() };
    createRedisClientMock.mockReturnValue(client as any);
    expect(await RedisService.getInstance().writeIpErrorWeightWithResult("192.0.2.1", { kind: "reset" })).toBe(false);
    expect(client.eval).toHaveBeenCalledTimes(1);
  });
  it("returns unknown on an IP write outage without retry", async () => {
    const client = { eval: vi.fn().mockRejectedValue(new Error("fixture outage")), quit: vi.fn() };
    createRedisClientMock.mockReturnValue(client as any);
    expect(await RedisService.getInstance().writeIpErrorWeightWithResult("192.0.2.1", { kind: "reset" })).toBeNull();
    expect(client.eval).toHaveBeenCalledTimes(1);
  });
  it.each([-1, 1.5, 1_000_001, NaN, Infinity])("never evaluates Redis for invalid weight %s", async (weight) => {
    const client = { eval: vi.fn(), quit: vi.fn() };
    createRedisClientMock.mockReturnValue(client as any);
    expect(await RedisService.getInstance().writeIpErrorWeightWithResult("192.0.2.1", { kind: "set", weight })).toBe(
      false,
    );
    expect(client.eval).not.toHaveBeenCalled();
  });
  it("never evaluates Redis for an unsafe address", async () => {
    const client = { eval: vi.fn(), quit: vi.fn() };
    createRedisClientMock.mockReturnValue(client as any);
    expect(await RedisService.getInstance().writeIpErrorWeightWithResult("192.0.2.*", { kind: "reset" })).toBe(false);
    expect(client.eval).not.toHaveBeenCalled();
  });
  it("confirms expiring revocation writes and treats outages as unknown instead of success", async () => {
    const client = {
      setex: vi.fn().mockResolvedValueOnce("OK").mockRejectedValueOnce(new Error("fixture outage")),
      set: vi.fn().mockResolvedValue("OK"),
      quit: vi.fn(),
    };
    createRedisClientMock.mockReturnValue(client as any);
    const service = RedisService.getInstance();
    expect(await service.setWithResult("fixture-marker", "fixture-value", 30)).toBe(true);
    expect(client.setex).toHaveBeenCalledWith("fixture-marker", 30, "fixture-value");
    expect(await service.setWithResult("fixture-marker", "fixture-value", 30)).toBeNull();
    expect(await service.setWithResult("fixture-marker", "fixture-value")).toBe(true);
  });
  it("does not confirm unexpected Redis replies", async () => {
    createRedisClientMock.mockReturnValue({ setex: vi.fn().mockResolvedValue(null), quit: vi.fn() } as any);
    expect(await RedisService.getInstance().setWithResult("fixture-marker", "fixture-value", 30)).toBe(false);
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
