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

  it("treats a null latency threshold as disabled and averages only first-byte samples", async () => {
    const redis = createRedis();
    const service = new HealthServiceCtor(redis);
    const now = new Date("2026-07-25T12:00:00.000Z");
    for (let index = 0; index < 3; index += 1) {
      await service.recordAttempt({
        channelId: "slow",
        requestId: `slow-${index}`,
        success: index !== 2,
        statusCode: index === 2 ? 503 : 200,
        latencyMs: index === 2 ? undefined : 250,
        observedAt: now,
      });
    }

    expect((await service.getHealth("slow", now)).averageLatencyMs).toBe(250);
    const members = [
      { id: "slow", name: "Slow", enabled: true, priority: 1, weight: 1, effectivePrice: 1 },
      {
        id: "manual-fast",
        name: "Manual fast",
        enabled: true,
        priority: 2,
        weight: 1,
        effectivePrice: 2,
        healthTrackingMode: "manual" as const,
        manualAvailability: 1,
        manualLatencyMs: 10,
      },
    ];
    expect((await service.rankMembers(members, "price-first", now, { latencyThresholdMs: null }))[0]?.eligible).toBe(
      true,
    );
    const thresholded = await service.rankMembers(members, "price-first", now, { latencyThresholdMs: 100 });
    expect(thresholded.find((member) => member.id === "slow")?.exclusionReasons).toContain("latency");
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

  it("keeps price-first ordering when Redis is unavailable", async () => {
    const redis = createRedis();
    redis.isRedisAvailable.mockReturnValue(false);
    const service = new HealthServiceCtor(redis);
    const ranked = await service.rankMembers(
      [
        { id: "later", name: "Later", enabled: true, priority: 2, weight: 1, effectivePrice: 1 },
        { id: "first", name: "First", enabled: true, priority: 1, weight: 1, effectivePrice: 2 },
      ],
      "price-first",
    );
    expect(ranked.map((member) => member.id)).toEqual(["later", "first"]);
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

  it("does not let disabled health tracking reserve a configured priority slot and clears bucket data", async () => {
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
    expect(ranked.map((member) => member.id)).toEqual(["manual", "tracked", "disabled"]);
    expect(ranked[2]?.source).toBe("disabled");
    await expect(service.clearHealth("tracked", now)).resolves.toBe(true);
    expect(redis.deleteMany).toHaveBeenCalledOnce();
  });

  it("sorts price-first strictly by effective price regardless of member weight or priority", async () => {
    const service = new HealthServiceCtor(createRedis());
    const ranked = await service.rankMembers(
      [
        { id: "expensive", name: "Expensive", enabled: true, priority: 1, weight: 999, effectivePrice: 2 },
        { id: "cheap", name: "Cheap", enabled: true, priority: 9, weight: 0.01, effectivePrice: 1 },
      ],
      "price-first",
    );

    expect(ranked.map((member) => member.id)).toEqual(["cheap", "expensive"]);
  });

  it("applies health, latency, and circuit-breaker thresholds after health data is credible", async () => {
    const redis = createRedis();
    const service = new HealthServiceCtor(redis);
    const now = new Date("2026-07-25T12:00:00.000Z");
    for (let index = 0; index < 3; index += 1) {
      await service.recordAttempt({
        channelId: "unhealthy",
        requestId: `unhealthy-${index}`,
        success: false,
        statusCode: 503,
        latencyMs: 400,
        observedAt: now,
      });
    }
    for (let index = 0; index < 3; index += 1) {
      await service.recordAttempt({
        channelId: "healthy",
        requestId: `healthy-${index}`,
        success: true,
        statusCode: 200,
        latencyMs: 20,
        observedAt: now,
      });
    }

    const ranked = await service.rankMembers(
      [
        { id: "unhealthy", name: "Unhealthy", enabled: true, priority: 1, weight: 1, effectivePrice: 1 },
        { id: "healthy", name: "Healthy", enabled: true, priority: 2, weight: 1, effectivePrice: 2 },
      ],
      "price-first",
      now,
      { healthScoreThreshold: 0.8, latencyThresholdMs: 100, circuitBreakerThreshold: 2 },
    );

    const unhealthy = ranked.find((member) => member.id === "unhealthy")!;
    expect(unhealthy.eligible).toBe(false);
    expect(unhealthy.exclusionReasons).toEqual(["availability", "latency", "circuit-breaker"]);
    expect(ranked.find((member) => member.id === "healthy")?.eligible).toBe(true);
  });

  it("does not exclude members with insufficient health samples and safely falls back when all are excluded", async () => {
    const redis = createRedis();
    const service = new HealthServiceCtor(redis);
    const now = new Date("2026-07-25T12:00:00.000Z");
    await service.recordAttempt({
      channelId: "new",
      requestId: "new-1",
      success: false,
      statusCode: 503,
      observedAt: now,
    });
    const insufficient = await service.rankMembers(
      [{ id: "new", name: "New", enabled: true, priority: 1, weight: 1, effectivePrice: 1 }],
      "price-first",
      now,
      { healthScoreThreshold: 1 },
    );
    expect(insufficient[0]?.eligible).toBe(true);

    for (const id of ["one", "two"])
      for (let index = 0; index < 3; index += 1)
        await service.recordAttempt({
          channelId: id,
          requestId: `${id}-${index}`,
          success: false,
          statusCode: 503,
          observedAt: now,
        });
    const fallback = await service.rankMembers(
      [
        { id: "one", name: "One", enabled: true, priority: 2, weight: 1, effectivePrice: 2 },
        { id: "two", name: "Two", enabled: true, priority: 1, weight: 1, effectivePrice: 1 },
      ],
      "price-first",
      now,
      { healthScoreThreshold: 1 },
    );
    expect(fallback.map((member) => member.id)).toEqual(["two", "one"]);
    expect(fallback.every((member) => member.eligible)).toBe(true);
    expect(fallback.every((member) => member.exclusionReasons.length === 0)).toBe(true);
  });
});
