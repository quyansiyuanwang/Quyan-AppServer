import { describe, expect, it, vi } from "vitest";
import { RelayChannelHealthService } from "../../../src/services/relay/relay-channel-health.service";

const HealthServiceCtor = RelayChannelHealthService as unknown as new (redis: any) => RelayChannelHealthService;

const createRedis = () => {
  const hashes = new Map<string, Record<string, string>>();
  return {
    isRedisAvailable: vi.fn(() => true),
    setIfNotExists: vi.fn(async (key: string) => {
      const dedupeKey = `dedupe:${key}`;
      if (hashes.has(dedupeKey)) return false;
      hashes.set(dedupeKey, {});
      return true;
    }),
    hIncrByFloatFieldsWithTtl: vi.fn(async (key: string, fields: Record<string, number>) => {
      const hash = hashes.get(key) ?? {};
      for (const [field, value] of Object.entries(fields)) hash[field] = String(Number(hash[field] ?? 0) + value);
      hashes.set(key, hash);
      return true;
    }),
    hSetFieldsWithTtl: vi.fn(async (key: string, fields: Record<string, string | number>) => {
      hashes.set(key, {
        ...(hashes.get(key) ?? {}),
        ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
      });
      return true;
    }),
    hGetAllMany: vi.fn(async (keys: string[]) =>
      Object.fromEntries(keys.filter((key) => hashes.has(key)).map((key) => [key, hashes.get(key)!])),
    ),
    deleteMany: vi.fn(async (keys: string[]) => {
      for (const key of keys) hashes.delete(key);
      return keys.length;
    }),
  };
};

describe("RelayChannelHealthService", () => {
  it("records one health sample per logical request and channel", async () => {
    const redis = createRedis();
    const service = new HealthServiceCtor(redis);
    const observedAt = new Date("2026-07-25T12:00:00.000Z");

    await service.recordAttempt({
      channelId: "channel-1",
      requestId: "request-1",
      success: true,
      statusCode: 200,
      latencyMs: 120,
      observedAt,
    });
    await service.recordAttempt({
      channelId: "channel-1",
      requestId: "request-1",
      success: false,
      statusCode: 503,
      latencyMs: 200,
      observedAt,
    });

    const health = await service.getHealth("channel-1", observedAt);
    expect(health.sampleCount).toBe(1);
    expect(health.successCount).toBe(1);
    expect(health.status2xxCount).toBe(1);
    expect(health.averageLatencyMs).toBe(120);
  });

  it("uses price or availability as the primary automatic-pool ranking factor", async () => {
    const redis = createRedis();
    const service = new HealthServiceCtor(redis);
    const now = new Date("2026-07-25T12:00:00.000Z");
    for (let index = 0; index < 3; index += 1)
      await service.recordAttempt({
        channelId: "stable",
        requestId: `stable-${index}`,
        success: true,
        statusCode: 200,
        observedAt: now,
      });
    for (let index = 0; index < 3; index += 1)
      await service.recordAttempt({
        channelId: "cheap",
        requestId: `cheap-${index}`,
        success: false,
        statusCode: 503,
        observedAt: now,
      });

    const members = [
      { id: "stable", name: "Stable", enabled: true, priority: 1, weight: 1, effectivePrice: 2 },
      { id: "cheap", name: "Cheap", enabled: true, priority: 2, weight: 1, effectivePrice: 1 },
    ];
    expect((await service.rankMembers(members, "price-first", now))[0]?.id).toBe("cheap");
    expect((await service.rankMembers(members, "stability-first", now))[0]?.id).toBe("stable");
  });

  it("falls back to configured priority when Redis is unavailable", async () => {
    const redis = createRedis();
    redis.isRedisAvailable.mockReturnValue(false);
    const service = new HealthServiceCtor(redis);
    const ranked = await service.rankMembers(
      [
        { id: "later", name: "Later", enabled: true, priority: 2, weight: 1, effectivePrice: 1 },
        { id: "first", name: "First", enabled: true, priority: 1, weight: 1, effectivePrice: 2 },
      ],
      "stability-first",
    );
    expect(ranked.map((member) => member.id)).toEqual(["first", "later"]);
  });

  it("uses administrator health values for manual channels without Redis samples", async () => {
    const service = new HealthServiceCtor(createRedis());
    const ranked = await service.rankMembers(
      [
        {
          id: "automatic",
          name: "Automatic",
          enabled: true,
          priority: 1,
          weight: 1,
          effectivePrice: 1,
          healthTrackingMode: "automatic",
        },
        {
          id: "manual",
          name: "Manual",
          enabled: true,
          priority: 2,
          weight: 1,
          effectivePrice: 2,
          healthTrackingMode: "manual",
          manualAvailability: 1,
          manualLatencyMs: 20,
        },
      ],
      "stability-first",
    );
    expect(ranked[0]?.id).toBe("manual");
    expect(ranked[0]?.source).toBe("manual");
    expect(ranked[0]?.health.averageLatencyMs).toBe(20);
  });

  it("keeps disabled channels in their configured priority slot and clears bucket data", async () => {
    const redis = createRedis();
    const service = new HealthServiceCtor(redis);
    const now = new Date("2026-07-25T12:00:00.000Z");
    await service.recordAttempt({ channelId: "tracked", requestId: "one", success: true, observedAt: now });
    const ranked = await service.rankMembers(
      [
        { id: "tracked", name: "Tracked", enabled: true, priority: 1, weight: 1, effectivePrice: 1 },
        {
          id: "disabled",
          name: "Disabled",
          enabled: true,
          priority: 2,
          weight: 1,
          effectivePrice: 1,
          healthTrackingMode: "disabled",
        },
        {
          id: "manual",
          name: "Manual",
          enabled: true,
          priority: 3,
          weight: 1,
          effectivePrice: 1,
          healthTrackingMode: "manual",
          manualAvailability: 1,
          manualLatencyMs: 1,
        },
      ],
      "stability-first",
      now,
    );
    expect(ranked[1]?.id).toBe("disabled");
    expect(ranked[1]?.source).toBe("disabled");
    await expect(service.clearHealth("tracked", now)).resolves.toBe(true);
    expect(redis.deleteMany).toHaveBeenCalledOnce();
  });
});
