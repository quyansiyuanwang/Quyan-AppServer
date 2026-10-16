import { describe, expect, it, vi } from "vitest";
import {
  projectRelayChannelHealth,
  projectRelayAutomaticPoolHealth,
  getRelayChannelHealthTrackingConfig,
} from "@/services/relay/relay-channel-health-projection";
import type { RelayChannelHealthProjectionSource } from "@/services/relay/relay-channel-health-projection";
import type { RelayChannelHealthSnapshot } from "@/services/relay/relay-channel-health.service";
const now = new Date("2026-10-16T00:00:00Z");
const snapshot = (channelId: string): RelayChannelHealthSnapshot => ({
  channelId,
  windowStartAt: now,
  windowEndAt: now,
  sampleCount: 4,
  successCount: 3,
  failureCount: 1,
  availability: 0.75,
  averageLatencyMs: 123,
  status2xxCount: 3,
  status3xxCount: 0,
  status4xxCount: 1,
  status5xxCount: 0,
  statusOtherCount: 0,
});
const source = (): RelayChannelHealthProjectionSource => ({
  id: "member",
  name: "Member",
  status: 1,
  providerServiceEnabled: true,
  routingConfig: null,
  multiplier: 2 as never,
  timePeriodMultipliers: [],
});
describe("credential-free channel health projections", () => {
  it.each(["automatic", "manual", "disabled"] as const)("preserves %s health semantics", (mode) => {
    const channel = {
      id: "channel",
      routingConfig: { healthTrackingMode: mode, manualAvailability: 0.9, manualLatencyMs: 30 },
    };
    const dto = projectRelayChannelHealth(channel, snapshot(channel.id));
    expect(dto).toMatchObject({
      channelId: "channel",
      trackingMode: mode,
      source: mode === "automatic" ? "redis" : mode,
      sampleCount: 4,
    });
    expect(dto.availability).toBe(mode === "manual" ? 0.9 : 0.75);
    expect(dto.averageLatencyMs).toBe(mode === "manual" ? 30 : 123);
  });
  it("never reads credentials, URLs or rich user relations", async () => {
    const channel = source();
    for (const key of [
      "openaiUpstreamApiKey",
      "anthropicUpstreamApiKey",
      "geminiUpstreamApiKey",
      "openaiUpstreamUrl",
      "providers",
    ])
      Object.defineProperty(channel, key, {
        enumerable: true,
        get() {
          throw new Error("unexpected rich read");
        },
      });
    expect(projectRelayChannelHealth(channel, snapshot(channel.id))).toMatchObject({ trackingMode: "automatic" });
    const health = {
      getHealth: vi.fn().mockResolvedValue(snapshot("root")),
      rankMembers: vi.fn().mockResolvedValue([]),
    };
    await projectRelayAutomaticPoolHealth(
      { id: "root", name: "Pool", routingConfig: null },
      [{ memberChannelId: channel.id, memberChannel: channel, enabled: true, priority: 1, weight: 2 }],
      health,
      now,
    );
    expect(health.rankMembers).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "member", effectivePrice: 2, enabled: true })],
      "price-first",
      now,
      expect.any(Object),
    );
  });
  it("retains manual defaults, missing snapshots and unknown tracking mode behavior", () => {
    expect(projectRelayChannelHealth({ id: "empty", routingConfig: null })).toMatchObject({
      channelId: "empty",
      sampleCount: 0,
      availability: 1,
    });
    expect(projectRelayChannelHealth({ id: "manual", routingConfig: { healthTrackingMode: "manual" } })).toMatchObject({
      availability: 0.5,
      averageLatencyMs: 0,
      source: "manual",
    });
    expect(getRelayChannelHealthTrackingConfig({ routingConfig: { healthTrackingMode: "unknown" } })).toEqual({
      healthTrackingMode: "automatic",
      manualAvailability: undefined,
      manualLatencyMs: undefined,
    });
  });
  it("preserves threshold inputs, static ordering, ranks and member health identity", async () => {
    const ranked = [
      {
        id: "b",
        name: "B",
        priority: 2,
        weight: 1,
        effectivePrice: 2,
        enabled: true,
        health: snapshot("b"),
        score: 2,
        source: "redis" as const,
        eligible: true,
        exclusionReasons: [],
      },
      {
        id: "a",
        name: "A",
        priority: 1,
        weight: 1,
        effectivePrice: 1,
        enabled: false,
        health: snapshot("a"),
        score: 1,
        source: "disabled" as const,
        healthTrackingMode: "disabled" as const,
        eligible: false,
        exclusionReasons: ["disabled"],
      },
    ];
    const health = { getHealth: vi.fn(), rankMembers: vi.fn().mockResolvedValue(ranked) };
    const dto = await projectRelayAutomaticPoolHealth(
      {
        id: "pool",
        name: "Pool",
        routingConfig: {
          rankingMode: "stability-first",
          dynamicMemberRankingEnabled: false,
          healthScoreThreshold: 90,
          latencyThresholdMs: 500,
        },
      },
      [],
      health,
      now,
    );
    expect(dto.members.map((row) => [row.channelId, row.rank])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(dto.members[0]).toMatchObject({ trackingMode: "disabled", eligible: false, exclusionReasons: ["disabled"] });
    expect(health.rankMembers).toHaveBeenCalledWith([], "stability-first", now, {
      healthScoreThreshold: 90,
      latencyThresholdMs: 500,
      circuitBreakerThreshold: undefined,
    });
    expect(health.getHealth).not.toHaveBeenCalled();
  });
});
