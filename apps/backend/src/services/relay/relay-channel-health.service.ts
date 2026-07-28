import { RedisService } from "@/services/infrastructure/redis.service";
import logger from "@/util/logger";
import type { RelayAutomaticPoolRankingMode, RelayChannelHealthTrackingMode } from "@/api/dto/relay/relay-channel.dto";

const BUCKET_SECONDS = 60;
const WINDOW_MINUTES = 15;
const RETENTION_SECONDS = 60 * 60;
const DEDUPE_TTL_SECONDS = RETENTION_SECONDS;
const MIN_SAMPLES_FOR_CONFIDENCE = 3;

export interface RelayChannelHealthSnapshot {
  channelId: string;
  windowStartAt: Date;
  windowEndAt: Date;
  sampleCount: number;
  successCount: number;
  failureCount: number;
  availability: number;
  averageLatencyMs: number;
  status2xxCount: number;
  status3xxCount: number;
  status4xxCount: number;
  status5xxCount: number;
  statusOtherCount: number;
  lastSeenAt?: Date;
  lastSuccessAt?: Date;
}

export interface RelayChannelHealthRecordInput {
  channelId: string;
  requestId: string;
  success: boolean;
  latencyMs?: number;
  statusCode?: number;
  observedAt?: Date;
}

export interface RelayChannelHealthRankingMemberInput {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  weight: number;
  effectivePrice: number;
  healthTrackingMode?: RelayChannelHealthTrackingMode;
  manualAvailability?: number | null;
  manualLatencyMs?: number | null;
}

export interface RelayAutomaticPoolHealthThresholds {
  healthScoreThreshold?: number | null;
  latencyThresholdMs?: number | null;
  circuitBreakerThreshold?: number | null;
}

export interface RelayChannelHealthRankingMember extends RelayChannelHealthRankingMemberInput {
  health: RelayChannelHealthSnapshot;
  score: number;
  source: "redis" | "manual" | "disabled";
  /** Whether this member can be selected after static state and pool health thresholds are applied. */
  eligible: boolean;
  /** Stable machine-readable explanations for a member excluded from the current pool route. */
  exclusionReasons: string[];
}

type HealthTotals = Omit<
  RelayChannelHealthSnapshot,
  "channelId" | "windowStartAt" | "windowEndAt" | "lastSeenAt" | "lastSuccessAt"
> & {
  lastSeenAt?: number;
  lastSuccessAt?: number;
};

export class RelayChannelHealthService {
  private static instance: RelayChannelHealthService;

  private constructor(private readonly redis: RedisService = RedisService.getInstance()) {}

  static getInstance(): RelayChannelHealthService {
    if (!this.instance) this.instance = new RelayChannelHealthService();
    return this.instance;
  }

  static get constants() {
    return {
      bucketSeconds: BUCKET_SECONDS,
      windowMinutes: WINDOW_MINUTES,
      retentionSeconds: RETENTION_SECONDS,
      minSamplesForConfidence: MIN_SAMPLES_FOR_CONFIDENCE,
    } as const;
  }

  async recordAttempt(input: RelayChannelHealthRecordInput): Promise<void> {
    const channelId = input.channelId.trim();
    const requestId = input.requestId.trim();
    if (!channelId || !requestId) return;

    try {
      const observedAt = input.observedAt ?? new Date();
      const bucket = this.getBucket(observedAt.getTime());
      const key = this.getBucketKey(channelId, bucket);
      const dedupeKey = `relay:channel-health:v1:sample:${channelId}:${requestId}`;
      const claimed = await this.redis.setIfNotExists(dedupeKey, "1", DEDUPE_TTL_SECONDS * 1000);
      if (claimed !== true) return;

      const statusCode = Number(input.statusCode);
      const latencyMs = Number(input.latencyMs);
      const fields: Record<string, number> = {
        sampleCount: 1,
        successCount: input.success ? 1 : 0,
        failureCount: input.success ? 0 : 1,
        latencyMsTotal: Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : 0,
        status2xxCount: statusCode >= 200 && statusCode < 300 ? 1 : 0,
        status3xxCount: statusCode >= 300 && statusCode < 400 ? 1 : 0,
        status4xxCount: statusCode >= 400 && statusCode < 500 ? 1 : 0,
        status5xxCount: statusCode >= 500 && statusCode < 600 ? 1 : 0,
        statusOtherCount: Number.isFinite(statusCode) && statusCode >= 100 && statusCode < 600 ? 0 : 1,
      };

      await this.redis.hIncrByFloatFieldsWithTtl(key, fields, RETENTION_SECONDS);
      await this.redis.hSetFieldsWithTtl(
        key,
        {
          lastSeenAt: observedAt.getTime(),
          ...(input.success ? { lastSuccessAt: observedAt.getTime() } : {}),
        },
        RETENTION_SECONDS,
      );
    } catch (error) {
      logger.warn("Failed to record relay channel health", { channelId, error });
    }
  }

  async getHealth(channelId: string, now = new Date()): Promise<RelayChannelHealthSnapshot> {
    const result = await this.getHealthMap([channelId], now);
    return result.get(channelId) ?? this.emptySnapshot(channelId, now);
  }

  async getHealthMap(channelIds: string[], now = new Date()): Promise<Map<string, RelayChannelHealthSnapshot>> {
    return (await this.getHealthMapWithAvailability(channelIds, now)).healthMap;
  }

  async clearHealth(channelId: string, now = new Date()): Promise<boolean> {
    const normalizedChannelId = channelId.trim();
    if (!normalizedChannelId) return false;

    try {
      const currentBucket = this.getBucket(now.getTime());
      const buckets = Array.from(
        { length: Math.ceil(RETENTION_SECONDS / BUCKET_SECONDS) },
        (_, index) => currentBucket - index * BUCKET_SECONDS,
      );
      const result = await this.redis.deleteMany(
        buckets.map((bucket) => this.getBucketKey(normalizedChannelId, bucket)),
      );
      return result !== null;
    } catch (error) {
      logger.warn("Failed to clear relay channel health", { channelId: normalizedChannelId, error });
      return false;
    }
  }

  private async getHealthMapWithAvailability(
    channelIds: string[],
    now: Date,
  ): Promise<{ healthMap: Map<string, RelayChannelHealthSnapshot>; available: boolean }> {
    const uniqueIds = [...new Set(channelIds.map((id) => id.trim()).filter(Boolean))];
    const buckets = this.getBuckets(now.getTime());
    const keys = uniqueIds.flatMap((channelId) => buckets.map((bucket) => this.getBucketKey(channelId, bucket)));
    let hashes: Record<string, Record<string, string>> = {};
    let available = this.redis.isRedisAvailable();

    if (available) {
      try {
        hashes = await this.redis.hGetAllMany(keys);
        available = this.redis.isRedisAvailable();
      } catch (error) {
        available = false;
        logger.warn("Failed to read relay channel health", { channelIds: uniqueIds, error });
      }
    }

    const output = new Map<string, RelayChannelHealthSnapshot>();
    for (const channelId of uniqueIds) {
      const totals = this.emptyTotals();
      for (const bucket of buckets) this.mergeHash(totals, hashes[this.getBucketKey(channelId, bucket)]);
      output.set(channelId, this.toSnapshot(channelId, totals, now));
    }
    return { healthMap: output, available };
  }

  async rankMembers(
    members: RelayChannelHealthRankingMemberInput[],
    rankingMode: RelayAutomaticPoolRankingMode,
    now = new Date(),
    thresholds: RelayAutomaticPoolHealthThresholds = {},
  ): Promise<RelayChannelHealthRankingMember[]> {
    const { healthMap, available } = await this.getHealthMapWithAvailability(
      members.map((member) => member.id),
      now,
    );
    const ranked: RelayChannelHealthRankingMember[] = members.map((member) => {
      const trackingMode = member.healthTrackingMode ?? "automatic";
      const baseHealth = healthMap.get(member.id) ?? this.emptySnapshot(member.id, now);
      const health =
        trackingMode === "manual"
          ? {
              ...baseHealth,
              availability: this.clampAvailability(member.manualAvailability),
              averageLatencyMs: this.normalizeLatency(member.manualLatencyMs),
            }
          : baseHealth;
      const availability =
        trackingMode === "disabled"
          ? 0
          : trackingMode === "automatic" && (!available || health.sampleCount < MIN_SAMPLES_FOR_CONFIDENCE)
            ? 0.5
            : health.availability;
      const weight = Math.max(Number(member.weight) || 0, 0.01);
      const price = Math.max(Number(member.effectivePrice) || 0, 0.01);
      const score = rankingMode === "stability-first" ? availability * weight : price;
      const hasTrustedAutomaticHealth =
        trackingMode === "automatic" && available && health.sampleCount >= MIN_SAMPLES_FOR_CONFIDENCE;
      const hasTrustedHealth = trackingMode === "manual" || hasTrustedAutomaticHealth;
      const exclusionReasons: string[] = [];
      if (!member.enabled) exclusionReasons.push("disabled");

      // Missing telemetry must not make an otherwise valid channel unavailable. Manual values are
      // administrator-provided and therefore trusted immediately; automatic values need a small sample set.
      if (hasTrustedHealth) {
        const healthThreshold = this.normalizeThreshold(thresholds.healthScoreThreshold);
        if (healthThreshold !== null && availability < healthThreshold) exclusionReasons.push("availability");

        const latencyThreshold = this.normalizeThreshold(thresholds.latencyThresholdMs);
        if (latencyThreshold !== null && health.averageLatencyMs > 0 && health.averageLatencyMs > latencyThreshold)
          exclusionReasons.push("latency");

        const breakerThreshold = this.normalizeThreshold(thresholds.circuitBreakerThreshold);
        if (breakerThreshold !== null && health.failureCount >= breakerThreshold)
          exclusionReasons.push("circuit-breaker");
      }
      const source: RelayChannelHealthRankingMember["source"] =
        trackingMode === "manual" ? "manual" : trackingMode === "disabled" ? "disabled" : "redis";
      return {
        ...member,
        healthTrackingMode: trackingMode,
        health,
        score,
        source,
        eligible: exclusionReasons.length === 0,
        exclusionReasons,
      };
    });

    const priorityOrder = (left: RelayChannelHealthRankingMember, right: RelayChannelHealthRankingMember): number =>
      left.priority - right.priority || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    ranked.sort((left, right) => {
      if (rankingMode === "price-first") {
        const priceOrder = left.effectivePrice - right.effectivePrice;
        if (Math.abs(priceOrder) > 1e-9) return priceOrder;
      } else {
        const scoreOrder = right.score - left.score;
        if (Math.abs(scoreOrder) > 1e-9) return scoreOrder;
      }
      const availabilityOrder = right.health.availability - left.health.availability;
      if (Math.abs(availabilityOrder) > 1e-9) return availabilityOrder;
      const priceOrder = left.effectivePrice - right.effectivePrice;
      if (Math.abs(priceOrder) > 1e-9) return priceOrder;
      return priorityOrder(left, right);
    });

    // If thresholds eliminate every enabled member, preserve availability by falling back to the
    // base order. Static disabled members remain unavailable in both cases.
    const hasEligibleEnabledMember = ranked.some((member) => member.enabled && member.eligible);
    if (!hasEligibleEnabledMember) {
      for (const member of ranked) {
        if (!member.enabled) continue;
        member.eligible = true;
        member.exclusionReasons = [];
      }
    }
    return ranked;
  }

  private normalizeThreshold(value: number | null | undefined): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }

  private clampAvailability(value: number | null | undefined): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0.5;
  }

  private normalizeLatency(value: number | null | undefined): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  }

  private getBuckets(timestampMs: number): number[] {
    const currentBucket = this.getBucket(timestampMs);
    return Array.from({ length: WINDOW_MINUTES }, (_, index) => currentBucket - index * BUCKET_SECONDS);
  }

  private getBucket(timestampMs: number): number {
    return Math.floor(timestampMs / 1000 / BUCKET_SECONDS) * BUCKET_SECONDS;
  }

  private getBucketKey(channelId: string, bucket: number): string {
    return `relay:channel-health:v1:${channelId}:${bucket}`;
  }

  private emptyTotals(): HealthTotals {
    return {
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
  }

  private emptySnapshot(channelId: string, now: Date): RelayChannelHealthSnapshot {
    return this.toSnapshot(channelId, this.emptyTotals(), now);
  }

  private mergeHash(totals: HealthTotals, hash?: Record<string, string>): void {
    if (!hash) return;
    const value = (field: string): number => {
      const parsed = Number(hash[field] ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    totals.sampleCount += value("sampleCount");
    totals.successCount += value("successCount");
    totals.failureCount += value("failureCount");
    totals.averageLatencyMs += value("latencyMsTotal");
    totals.status2xxCount += value("status2xxCount");
    totals.status3xxCount += value("status3xxCount");
    totals.status4xxCount += value("status4xxCount");
    totals.status5xxCount += value("status5xxCount");
    totals.statusOtherCount += value("statusOtherCount");
    const lastSeenAt = value("lastSeenAt");
    const lastSuccessAt = value("lastSuccessAt");
    totals.lastSeenAt = Math.max(totals.lastSeenAt ?? 0, lastSeenAt) || undefined;
    totals.lastSuccessAt = Math.max(totals.lastSuccessAt ?? 0, lastSuccessAt) || undefined;
  }

  private toSnapshot(channelId: string, totals: HealthTotals, now: Date): RelayChannelHealthSnapshot {
    const sampleCount = Math.round(totals.sampleCount);
    const successCount = Math.round(totals.successCount);
    const failureCount = Math.round(totals.failureCount);
    const availability = sampleCount > 0 ? successCount / sampleCount : 1;
    const latencyTotal = totals.averageLatencyMs;
    return {
      channelId,
      windowStartAt: new Date(now.getTime() - WINDOW_MINUTES * 60 * 1000),
      windowEndAt: now,
      sampleCount,
      successCount,
      failureCount,
      availability,
      averageLatencyMs: sampleCount > 0 ? latencyTotal / sampleCount : 0,
      status2xxCount: Math.round(totals.status2xxCount),
      status3xxCount: Math.round(totals.status3xxCount),
      status4xxCount: Math.round(totals.status4xxCount),
      status5xxCount: Math.round(totals.status5xxCount),
      statusOtherCount: Math.round(totals.statusOtherCount),
      lastSeenAt: totals.lastSeenAt ? new Date(totals.lastSeenAt) : undefined,
      lastSuccessAt: totals.lastSuccessAt ? new Date(totals.lastSuccessAt) : undefined,
    };
  }
}
