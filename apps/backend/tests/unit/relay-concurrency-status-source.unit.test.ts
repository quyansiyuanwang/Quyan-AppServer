import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/services/infrastructure/redis.service", () => ({ RedisService: { getInstance: vi.fn() } }));
vi.mock("@/store/relay/platform-relay-configuration-read.repository", () => ({
  PlatformRelayConfigurationReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/infrastructure/ai-resource-config.service", () => ({
  getAIResourceConfig: () => ({
    relay: {
      resourceGuard: {
        imageMaxConcurrency: 2,
        imageQueueTimeoutMs: 1000,
        nonStreamUpstreamTimeoutMs: 10000,
      },
    },
  }),
}));
import { PlatformRelayConcurrencyReadRepository } from "@/store/relay/platform-relay-concurrency-read.repository";
import {
  relayConcurrencyKeyTarget,
  isRelayConcurrencySubjectId,
  projectRelayConcurrencyLimits,
  projectRelayConcurrencyTotals,
} from "@/util/relay-concurrency-status-projection";
const redis = { scanKeyPageWithResult: vi.fn(), ttl: vi.fn() },
  configuration = { configurationTarget: vi.fn(), hydrateConfiguration: vi.fn() };
const repo = new PlatformRelayConcurrencyReadRepository(redis, configuration as never);
beforeEach(() => {
  vi.resetAllMocks();
  redis.scanKeyPageWithResult.mockResolvedValue({ cursor: "0", keys: [] });
  redis.ttl.mockResolvedValue(10);
});
describe("confirmed concurrency telemetry source", () => {
  it("selects the requested user and always uses the registered global image pool", async () => {
    await repo.scan("default", "slot", "user-1", "7");
    expect(redis.scanKeyPageWithResult).toHaveBeenLastCalledWith("relay:concurrency:default:user-1:slot:*", "7");
    await repo.scan("image", "waiter", "user-1");
    expect(redis.scanKeyPageWithResult).toHaveBeenLastCalledWith("relay:concurrency:image:global:queue:waiter:*", "0");
  });
  it("keeps empty intermediate cursor pages distinct from scan completion", async () => {
    redis.scanKeyPageWithResult.mockResolvedValue({ cursor: "29", keys: [] });
    expect(await repo.scan("default", "waiter")).toEqual({ cursor: "29", keys: [] });
  });
  it.each(["*", "user:2", "../user", "user\n"])("rejects unsafe caller identities %j before Redis", async (id) => {
    expect(isRelayConcurrencySubjectId(id)).toBe(false);
    await expect(repo.scan("default", "slot", id)).rejects.toMatchObject({ statusCode: 403 });
    expect(redis.scanKeyPageWithResult).not.toHaveBeenCalled();
  });
  it.each([
    "relay:concurrency:default:other:slot:1",
    "relay:concurrency:image:global:slot:1",
    "relay:concurrency:default:user-1:queue:waiter:1",
    "relay:concurrency:default:user-1:slot:1\n",
  ])("rejects source keys outside the selected scan %j", async (key) => {
    redis.scanKeyPageWithResult.mockResolvedValue({ cursor: "0", keys: [key] });
    await expect(repo.scan("default", "slot", "user-1")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not turn a Redis outage into zero active requests", async () => {
    redis.scanKeyPageWithResult.mockResolvedValue(null);
    await expect(repo.scan("default", "slot")).rejects.toMatchObject({ statusCode: 503 });
    redis.ttl.mockResolvedValue(null);
    await expect(repo.ttl("relay:concurrency:default:user-1:slot:1")).rejects.toMatchObject({ statusCode: 503 });
  });
  it.each([-2, -1, 0, 10])("preserves confirmed Redis TTL semantics %s", async (ttl) => {
    redis.ttl.mockResolvedValue(ttl);
    expect(await repo.ttl("relay:concurrency:default:user-1:slot:1")).toBe(ttl);
  });
  it("never hydrates arbitrary keys or unknown pool identities", async () => {
    expect(relayConcurrencyKeyTarget("relay:concurrency:image:user-1:slot:1")).toBeUndefined();
    await expect(repo.ttl("fixture-secret")).rejects.toMatchObject({ statusCode: 403 });
    expect(redis.ttl).not.toHaveBeenCalled();
  });
  it("retains existing capacity caps and computes totals from the provided visible records", () => {
    expect(
      projectRelayConcurrencyLimits({
        maxConcurrency: 5,
        enableQueue: true,
        queueTimeout: 30000,
        upstreamStreamTimeout: 120000,
      }),
    ).toMatchObject({
      maxConcurrency: 5,
      effectiveImageMaxConcurrency: 2,
      effectiveImageQueueTimeoutMs: 1000,
    });
    expect(
      projectRelayConcurrencyTotals([
        {
          key: "fixture",
          userId: "user-1",
          scope: "default",
          source: "redis",
          activeCount: 2,
          queueLength: 3,
          ttlSeconds: 10,
        },
        {
          key: "fixture-image",
          userId: "*",
          scope: "image",
          source: "redis",
          activeCount: 1,
          queueLength: 1,
          ttlSeconds: null,
        },
      ]),
    ).toEqual({
      activeCount: 3,
      defaultScopeActiveCount: 2,
      imageScopeActiveCount: 1,
      queuedCount: 4,
      userCount: 1,
    });
  });
});
