import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const redis = vi.hoisted(() => ({
  isRedisAvailable: vi.fn(),
  reserveFairWriteLock: vi.fn(),
  tryAcquireFairWriteLock: vi.fn(),
  releaseFairWriteLock: vi.fn(),
  extendIfValueMatches: vi.fn(),
}));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: () => redis } }));
import { RelayChannelProbeLockService } from "@/services/relay/relay-channel-probe-lock.service";
import { relayProbeQueueSlotKey } from "@/services/relay/relay-channel-probe-queue-policy";
beforeEach(() => {
  vi.resetAllMocks();
  redis.isRedisAvailable.mockReturnValue(true);
  redis.reserveFairWriteLock.mockResolvedValue(true);
  redis.tryAcquireFairWriteLock.mockResolvedValue("acquired");
});
afterEach(() => {
  vi.useRealTimers();
});
describe("short-lived probe queue coordination", () => {
  it("uses a queue-only namespace, separate from upstream calibration", async () => {
    const lock = RelayChannelProbeLockService.getInstance();
    await expect(lock.withQueueWrite("channel", async () => "result")).resolves.toBe("result");
    expect(redis.tryAcquireFairWriteLock).toHaveBeenCalledWith(
      "relay:channel-probe-queue-lock:v1:channel",
      expect.any(String),
      90_000,
    );
    await lock.withWrite("channel", async () => undefined);
    expect(redis.tryAcquireFairWriteLock).toHaveBeenCalledWith(
      "relay:channel-probe-lock:v1:channel",
      expect.any(String),
      90_000,
    );
  });
  it("releases owned queue coordination after failure", async () => {
    await expect(
      RelayChannelProbeLockService.getInstance().withQueueWrite("channel", async () => {
        throw new Error("fixture");
      }),
    ).rejects.toThrow("fixture");
    expect(redis.releaseFairWriteLock).toHaveBeenCalledWith(
      "relay:channel-probe-queue-lock:v1:channel",
      expect.any(String),
    );
  });
  it("fails closed without Redis rather than running a queue mutation", async () => {
    redis.isRedisAvailable.mockReturnValue(false);
    const mutate = vi.fn();
    await expect(RelayChannelProbeLockService.getInstance().withQueueWrite("channel", mutate)).rejects.toThrow();
    expect(mutate).not.toHaveBeenCalled();
  });
  it("fails closed on unavailable acquisition and releases the reservation", async () => {
    redis.tryAcquireFairWriteLock.mockResolvedValue(null);
    const mutate = vi.fn();
    await expect(RelayChannelProbeLockService.getInstance().withQueueWrite("channel", mutate)).rejects.toThrow();
    expect(mutate).not.toHaveBeenCalled();
    expect(redis.releaseFairWriteLock).toHaveBeenCalledOnce();
  });
  it("retains the deployed slot protocol for standalone and pooled runs", () => {
    expect(relayProbeQueueSlotKey("channel")).toBe("relay:channel-probe-run:v1:channel:channel");
    expect(relayProbeQueueSlotKey("channel", "member")).toBe("relay:channel-probe-run:v1:channel:member");
  });
});
