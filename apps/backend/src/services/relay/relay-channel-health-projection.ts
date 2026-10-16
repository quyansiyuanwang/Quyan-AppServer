import type { RelayChannel } from "@prisma/client";
import type {
  RelayChannelHealthDto,
  RelayChannelRoutingConfigDto,
  RelayChannelHealthTrackingMode,
  RelayAutomaticPoolHealthDto,
  RelayAutomaticPoolHealthMemberDto,
  TimePeriodMultiplierRule,
} from "@/api/dto/relay/relay-channel.dto";
import type { RelayChannelHealthService, RelayChannelHealthSnapshot } from "./relay-channel-health.service";
import type { EffectiveRelayPoolMember } from "./utils/relay-pool-members.util";
import { isChannelServiceEnabled } from "./relay-channel-management-projection";
import { computeMultiplierForTime } from "./time-period-multiplier.service";
export const DEFAULT_AUTOMATIC_POOL_RANKING_MODE = "price-first" as const;
export function getRelayChannelHealthTrackingConfig(channel?: Pick<RelayChannel, "routingConfig"> | null): {
  healthTrackingMode: RelayChannelHealthTrackingMode;
  manualAvailability?: number;
  manualLatencyMs?: number;
} {
  const routingConfig = channel?.routingConfig as RelayChannelRoutingConfigDto | null | undefined;
  const trackingMode: RelayChannelHealthTrackingMode =
    routingConfig?.healthTrackingMode === "manual" || routingConfig?.healthTrackingMode === "disabled"
      ? routingConfig.healthTrackingMode
      : "automatic";
  return {
    healthTrackingMode: trackingMode,
    manualAvailability:
      trackingMode === "manual" ? toOptionalFiniteHealthNumber(routingConfig?.manualAvailability) : undefined,
    manualLatencyMs:
      trackingMode === "manual" ? toOptionalFiniteHealthNumber(routingConfig?.manualLatencyMs) : undefined,
  };
}

export function toOptionalFiniteHealthNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function projectRelayChannelHealth(
  channel: Pick<RelayChannel, "id" | "routingConfig">,
  snapshot?: RelayChannelHealthSnapshot,
): RelayChannelHealthDto {
  const health = snapshot ?? {
    channelId: channel.id,
    windowStartAt: new Date(),
    windowEndAt: new Date(),
    sampleCount: 0,
    successCount: 0,
    failureCount: 0,
    availability: 1,
    averageLatencyMs: 0,
    status2xxCount: 0,
    status3xxCount: 0,
    status4xxCount: 0,
    status5xxCount: 0,
    statusOtherCount: 0,
  };
  const tracking = getRelayChannelHealthTrackingConfig(channel);
  if (tracking.healthTrackingMode === "manual") {
    return {
      ...health,
      availability: tracking.manualAvailability ?? 0.5,
      averageLatencyMs: tracking.manualLatencyMs ?? 0,
      trackingMode: "manual",
      source: "manual",
      manualAvailability: tracking.manualAvailability,
      manualLatencyMs: tracking.manualLatencyMs,
    };
  }
  if (tracking.healthTrackingMode === "disabled") {
    return { ...health, trackingMode: "disabled", source: "disabled" };
  }
  return { ...health, trackingMode: "automatic", source: "redis" };
}

export type RelayChannelHealthProjectionSource = Pick<
  RelayChannel,
  "id" | "name" | "status" | "providerServiceEnabled" | "routingConfig" | "multiplier" | "timePeriodMultipliers"
>;
/** Related member sources must be individually admitted before this read/projection. */
export async function projectRelayAutomaticPoolHealth(
  channel: Pick<RelayChannel, "id" | "name" | "routingConfig">,
  poolMembers: readonly EffectiveRelayPoolMember<RelayChannelHealthProjectionSource>[],
  healthService: Pick<RelayChannelHealthService, "rankMembers" | "getHealth">,
  now = new Date(),
): Promise<RelayAutomaticPoolHealthDto> {
  const rankingMode =
    (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined)?.rankingMode === "stability-first"
      ? "stability-first"
      : DEFAULT_AUTOMATIC_POOL_RANKING_MODE;
  const dynamicMemberRankingEnabled =
    (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined)?.dynamicMemberRankingEnabled !== false;
  const rankedMembers = await healthService.rankMembers(
    poolMembers.map((member) => {
      const memberChannel = member.memberChannel;
      const effectivePrice =
        Number(memberChannel?.multiplier ?? 1) *
        computeMultiplierForTime(
          (memberChannel?.timePeriodMultipliers as TimePeriodMultiplierRule[] | null | undefined) ?? [],
          now,
        );
      return {
        id: member.memberChannelId,
        name: memberChannel?.name ?? member.memberChannelId,
        enabled: member.enabled !== false && Boolean(memberChannel && isChannelServiceEnabled(memberChannel)),
        priority: member.priority,
        weight: Number(member.weight),
        effectivePrice,
        ...getRelayChannelHealthTrackingConfig(memberChannel),
      };
    }),
    rankingMode,
    now,
    {
      healthScoreThreshold: (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
        ?.healthScoreThreshold,
      latencyThresholdMs: (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
        ?.latencyThresholdMs,
      circuitBreakerThreshold: (channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
        ?.circuitBreakerThreshold,
    },
  );
  const window = rankedMembers[0]?.health ?? (await healthService.getHealth(channel.id, now));
  const displayedMembers = dynamicMemberRankingEnabled
    ? rankedMembers
    : [...rankedMembers].sort(
        (left, right) =>
          left.priority - right.priority || left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      );
  const members: RelayAutomaticPoolHealthMemberDto[] = displayedMembers.map((member, index) => ({
    ...member.health,
    name: member.name,
    enabled: member.enabled,
    priority: member.priority,
    weight: member.weight,
    effectivePrice: member.effectivePrice,
    score: member.score,
    rank: index + 1,
    eligible: member.eligible,
    exclusionReasons: member.exclusionReasons,
    trackingMode: member.healthTrackingMode ?? "automatic",
    source: member.source,
    manualAvailability:
      member.healthTrackingMode === "manual" ? toOptionalFiniteHealthNumber(member.manualAvailability) : undefined,
    manualLatencyMs:
      member.healthTrackingMode === "manual" ? toOptionalFiniteHealthNumber(member.manualLatencyMs) : undefined,
  }));

  return {
    channelId: channel.id,
    name: channel.name,
    rankingMode,
    dynamicMemberRankingEnabled,
    windowStartAt: window.windowStartAt,
    windowEndAt: window.windowEndAt,
    members,
  };
}
