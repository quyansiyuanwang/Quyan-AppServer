import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelayProxyService } from "@/services/relay/relay-proxy.service";
import { EnvSpace } from "@/config/env";
import { LockBackendUnavailableError, TooManyRequestsError } from "@/util/errors";

describe("RelayProxyService distributed concurrency", () => {
  let service: any;
  let redis: Record<string, any>;
  let relayConfigService: Record<string, any>;

  beforeEach(() => {
    redis = {
      isRedisAvailable: vi.fn().mockReturnValue(true),
      acquireSemaphoreSlot: vi.fn().mockResolvedValue(false),
      reserveSemaphoreQueueTicket: vi.fn().mockResolvedValue(7),
      tryAcquireQueuedSemaphoreSlot: vi.fn().mockResolvedValue("relay:concurrency:image:global:slot:1"),
      cancelSemaphoreQueueTicket: vi.fn().mockResolvedValue(true),
      deleteIfValueMatches: vi.fn().mockResolvedValue(true),
      extendIfValueMatches: vi.fn().mockResolvedValue(true),
    };

    relayConfigService = {
      getRelayConfig: vi.fn().mockResolvedValue({
        maxConcurrency: 3,
        queueTimeout: 1000,
        enableQueue: true,
        upstreamStreamTimeout: 30000,
        globalMultiplier: 1,
      }),
    };

    service = new RelayProxyService(
      {} as any,
      {} as any,
      {} as any,
      relayConfigService as any,
      {} as any,
      {} as any,
      redis as any,
    );
  });

  it("builds image capacity policy with global image guard limits", async () => {
    const relayConfig = await relayConfigService.getRelayConfig();

    const policy = service.getCapacityPolicy("relayUpstreamConcurrency", {
      userId: "user-1",
      isImageRequest: true,
      isStreamRequest: false,
      relayConfig,
    });

    expect(policy).toEqual({
      userId: "user-1",
      scope: "image",
      maxConcurrency: Math.min(relayConfig.maxConcurrency, EnvSpace.relayResourceGuardConfig.imageMaxConcurrency),
      queueTimeout: Math.min(relayConfig.queueTimeout, EnvSpace.relayResourceGuardConfig.imageQueueTimeoutMs),
      enableQueue: true,
      slotTtlSeconds: Math.max(
        1,
        Math.ceil(EnvSpace.relayResourceGuardConfig.nonStreamUpstreamTimeoutMs / 1000) + 5,
      ),
    });
  });

  it("builds default capacity policy with user-scoped concurrency limits", async () => {
    const relayConfig = await relayConfigService.getRelayConfig();

    const policy = service.getCapacityPolicy("relayUpstreamConcurrency", {
      userId: "user-1",
      isImageRequest: false,
      isStreamRequest: true,
      relayConfig,
    });

    expect(policy).toEqual({
      userId: "user-1",
      scope: "default",
      maxConcurrency: relayConfig.maxConcurrency,
      queueTimeout: relayConfig.queueTimeout,
      enableQueue: true,
      slotTtlSeconds: Math.max(1, Math.ceil(relayConfig.upstreamStreamTimeout / 1000) + 5),
    });
  });

  it("acquires queued semaphore leases for image scope using global keys", async () => {
    const lease = await service.acquireConcurrencySlot({
      userId: "user-1",
      scope: "image",
      maxConcurrency: 2,
      queueTimeout: 1000,
      enableQueue: true,
      slotTtlSeconds: 30,
    });

    expect(redis.reserveSemaphoreQueueTicket).toHaveBeenCalledWith(
      "relay:concurrency:image:global",
      expect.any(String),
      30000,
    );
    expect(redis.tryAcquireQueuedSemaphoreSlot).toHaveBeenCalledWith(
      "relay:concurrency:image:global",
      2,
      expect.any(String),
      30000,
      7,
    );
    expect(lease).toEqual(
      expect.objectContaining({
        key: "relay:concurrency:image:global",
        baseKey: "relay:concurrency:image:global",
        slotKey: "relay:concurrency:image:global:slot:1",
        scope: "image",
        source: "redis",
        ttlMs: 30000,
        ttlSeconds: 30,
      }),
    );
  });

  it("fails closed when redis is unavailable", async () => {
    redis.isRedisAvailable.mockReturnValue(false);

    await expect(
      service.acquireConcurrencySlot({
        userId: "user-1",
        scope: "default",
        maxConcurrency: 1,
        queueTimeout: 1000,
        enableQueue: true,
        slotTtlSeconds: 10,
      }),
    ).rejects.toBeInstanceOf(LockBackendUnavailableError);
  });

  it("rejects immediately when queue is disabled and no slot is available", async () => {
    await expect(
      service.acquireConcurrencySlot({
        userId: "user-1",
        scope: "default",
        maxConcurrency: 1,
        queueTimeout: 1000,
        enableQueue: false,
        slotTtlSeconds: 10,
      }),
    ).rejects.toBeInstanceOf(TooManyRequestsError);
  });
});
