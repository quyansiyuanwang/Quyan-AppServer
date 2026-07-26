import axios from "axios";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { EnvSpace } from "@/config/env";
import { assertSafeOutboundUrl } from "@/util/developer-outbound-url";
import { BadRequestError, ConflictError, LockBackendUnavailableError, NotFoundError } from "@/util/errors";
import { RelayChannelService } from "./relay-channel.service";
import { ModelPricingService } from "./model-pricing.service";
import { RelayConfigService } from "./relay-config.service";
import { computeMultiplierForTime } from "./time-period-multiplier.service";
import { RelayChannelProbeLockService } from "./relay-channel-probe-lock.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import logger from "@/util/logger";
import {
  RelayChannelProbeRepository,
  type RelayChannelProbeProfileRecord,
  type RelayChannelProbeRunRecord,
} from "@/store/relay/relay-channel-probe.repository";
import {
  DEFAULT_CACHE_CREATION_MULTIPLIER,
  DEFAULT_CACHE_READ_MULTIPLIER,
  TOKEN_PRICE_DIVISOR,
} from "@/constant/pricing";
import { extractTokenUsageMetrics, hasTokenValue, normalizeTokenBreakdown } from "@/util/token-usage.util";
import type {
  ApplyRelayChannelProbeRunsRequest,
  ApplyRelayChannelProbeRunsResponse,
  CreateRelayChannelProbeRunRequest,
  CreateRelayChannelProbeRunsRequest,
  CreateRelayChannelProbeRunsResponse,
  ClearRelayChannelProbeRunHistoryResponse,
  RelayChannelProbeOverviewItemDto,
  RelayChannelProbeProfileDto,
  RelayChannelProbeRunDto,
  RelayChannelProbeRunHistoryScope,
  RelayChannelProbeWorkflowStepDto,
  UpsertRelayChannelProbeProfileRequest,
} from "@/api/dto/relay/relay-channel-probe.dto";

const PROBE_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const RUN_LEASE_MS = 90_000;
const SUGGESTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const RUN_QUEUE_SLOT_TTL_MS = 2 * 60 * 60 * 1000;
const RUN_QUEUE_SLOT_PREFIX = "relay:channel-probe-run:v1";
const GROUP_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
// Upstream billing ledgers are commonly eventually consistent. Keep both
// snapshots outside the actual model request by a small, deterministic window
// while the channel write lock is held, so an in-app request cannot distort a
// calibration run between its two balance reads.
const PROBE_BEFORE_REQUEST_SETTLEMENT_DELAY_MS = 1_000;
const PROBE_AFTER_REQUEST_SETTLEMENT_DELAY_MS = 5_000;

type ProbeProfileRecord = RelayChannelProbeProfileRecord;
type ProbeRunRecord = RelayChannelProbeRunRecord;

export function readProbeJsonPath(source: unknown, path: string): unknown {
  const normalized = path
    .trim()
    .replace(/^\$\.?/, "")
    .replace(/\["([^"\\]+)"\]/g, ".$1")
    .replace(/\['([^'\\]+)'\]/g, ".$1")
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^\./, "");
  if (!normalized) return source;
  return normalized.split(".").reduce<unknown>((value, key) => {
    if (value == null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

export function interpolateProbeVariables(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === "string")
    return value.replace(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g, (_, key) => variables[key] ?? "");
  if (Array.isArray(value)) return value.map((item) => interpolateProbeVariables(item, variables));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        interpolateProbeVariables(item, variables),
      ]),
    );
  return value;
}

/**
 * Probe workflows contain credentials and extracted values. Unlike the generic
 * interpolation helper, never turn an absent value into an empty upstream
 * header, query parameter, or request body field.
 */
export function interpolateRequiredProbeVariables(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === "string")
    return value.replace(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g, (_, key) => {
      const resolved = variables[key];
      if (!resolved?.trim())
        throw new BadRequestError(`PROBE_VARIABLE_MISSING:${key}`, undefined, {
          messageKey: "relay.probeVariableMissing",
          messageParams: { variable: key },
        });
      return resolved;
    });
  if (Array.isArray(value)) return value.map((item) => interpolateRequiredProbeVariables(item, variables));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        interpolateRequiredProbeVariables(item, variables),
      ]),
    );
  return value;
}

export function normalizeProbeNetworkError(message: string): string {
  return /invalid ip address:\s*undefined/i.test(message) ? "PROBE_NETWORK_CONFIGURATION_INVALID" : message;
}

export function calculateSuggestedProbeMultiplier(
  upstreamBalanceDelta: number,
  upstreamRateMultiplier: number,
  distributionMultiplier: number,
  baseLocalCost: number,
): number | undefined {
  const value = (upstreamBalanceDelta * upstreamRateMultiplier * distributionMultiplier) / baseLocalCost;
  if (
    !Number.isFinite(value) ||
    upstreamBalanceDelta <= 0 ||
    upstreamRateMultiplier <= 0 ||
    baseLocalCost <= 0 ||
    value < 0 ||
    value > 1000
  )
    return undefined;
  // A channel multiplier must never be rounded below the measured upstream cost.
  return Math.ceil((value - Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function waitForProbeSettlement(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

type ProbeUsage = {
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

/**
 * Probe URLs are configured as API base URLs. Some providers include the API
 * version in that base URL while others use the origin only, so avoid adding a
 * duplicate version segment in either case.
 */
export function buildProbeUpstreamEndpoint(
  upstreamUrl: string,
  format: "openai" | "anthropic" | "gemini",
  model: string,
): string {
  const base = new URL(upstreamUrl);
  const endpointPath =
    format === "openai"
      ? "/v1/chat/completions"
      : format === "anthropic"
        ? "/v1/messages"
        : `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const normalizedBasePath = base.pathname.replace(/\/+$/, "");
  const normalizedEndpointPath = endpointPath.replace(/^\/+/, "");
  const endpointWithLeadingSlash = `/${normalizedEndpointPath}`;
  const path =
    normalizedBasePath && endpointWithLeadingSlash.startsWith(`${normalizedBasePath}/`)
      ? endpointWithLeadingSlash.slice(normalizedBasePath.length)
      : endpointWithLeadingSlash;
  base.pathname = `${normalizedBasePath}/${path.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  return base.toString();
}

export function assertProbeUsage(usage: ProbeUsage): void {
  if (usage.totalTokens > 0) return;
  throw new BadRequestError("最小模型请求未返回可计费用量；请确认上游地址包含正确 API 版本、请求格式和模型。");
}

function redactProbeErrorText(value: string): string {
  return value
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, "$1 [REDACTED]")
    .replace(/([?&](?:api[_-]?key|key|token|authorization)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|rk|dpk)_[A-Za-z0-9_-]+\b/gi, "[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 300);
}

function readProbeUpstreamMessage(data: unknown): string | undefined {
  if (typeof data === "string") return redactProbeErrorText(data) || undefined;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  const direct = [record.message, record.msg, record.detail, record.error_description].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  if (direct) return redactProbeErrorText(direct) || undefined;
  const nestedError = record.error;
  if (typeof nestedError === "string") return redactProbeErrorText(nestedError) || undefined;
  if (!nestedError || typeof nestedError !== "object" || Array.isArray(nestedError)) return undefined;
  const nested = nestedError as Record<string, unknown>;
  const nestedMessage = [nested.message, nested.msg, nested.detail].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  return nestedMessage ? redactProbeErrorText(nestedMessage) || undefined : undefined;
}

/** Formats upstream failures without exposing credentials, response bodies, or query parameters. */
export function formatProbeUpstreamError(
  status: number | undefined,
  requestUrl: string | undefined,
  responseData: unknown,
): string {
  let endpoint = "";
  if (requestUrl) {
    try {
      endpoint = new URL(requestUrl).pathname;
    } catch {
      endpoint = "";
    }
  }
  const parts = [
    status ? `上游响应 HTTP ${status}${endpoint ? `（${endpoint}）` : ""}` : "上游请求失败",
    readProbeUpstreamMessage(responseData),
  ].filter((value): value is string => Boolean(value));
  const details = parts.join("：");
  if (
    status === 403 &&
    /(?:\bip\b|IP|地址).{0,80}(?:white|allow|permit|白名单|允许|访问)|(?:white|allow|permit|白名单|允许访问).{0,80}(?:\bip\b|IP|地址)/i.test(
      details,
    )
  )
    parts.push("上游令牌 IP 白名单拒绝：请在上游将本服务端的公网出口 IP 加入允许列表；浏览器 IP 不参与服务端探针");
  else if (status === 401 || status === 403)
    parts.push("请检查渠道的上游 API Key、该 Key 的模型权限；余额工作流凭据不会替代渠道上游 Key");
  return parts.join("：");
}

function toNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

export class RelayChannelProbeService {
  private static instance: RelayChannelProbeService;
  private running = false;
  private lastCleanupAt = 0;
  private readonly channelLockService = RelayChannelProbeLockService.getInstance();
  private readonly repository = RelayChannelProbeRepository.getInstance();
  private readonly redis = RedisService.getInstance();

  static getInstance(): RelayChannelProbeService {
    if (!this.instance) this.instance = new RelayChannelProbeService();
    return this.instance;
  }

  async listOverview(actorUserId: string): Promise<RelayChannelProbeOverviewItemDto[]> {
    const channels = await RelayChannelService.getInstance().listChannels(actorUserId, true);
    const standalone = channels.filter((channel) => channel.channelType === "standalone");
    const channelIds = standalone.map((item) => item.id);
    const [profiles, runs] = await Promise.all([
      this.repository.listProfiles(channelIds),
      this.repository.listLatestRuns(channelIds),
    ]);
    const profileMap = new Map(profiles.map((profile) => [profile.relayChannelId, profile]));
    const runMap = new Map(runs.map((run) => [run.relayChannelId, run]));
    return standalone.map((channel) => ({
      channelId: channel.id,
      channelName: channel.name,
      enabled: channel.enabled,
      multiplier: channel.multiplier,
      allowedProbeFormats: this.toAllowedProbeFormats(channel.allowedFormats),
      allowedProbeModels: channel.allowedModels,
      profile: profileMap.has(channel.id) ? this.toProfileDto(profileMap.get(channel.id)!) : undefined,
      latestRun: runMap.has(channel.id) ? this.toRunDto(runMap.get(channel.id)!) : undefined,
    }));
  }

  async getProfile(channelId: string, actorUserId: string): Promise<RelayChannelProbeProfileDto> {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const profile = await this.repository.findProfile(channelId);
    if (!profile) throw new NotFoundError("渠道探针档案不存在");
    return this.toProfileDto(profile);
  }

  async upsertProfile(channelId: string, body: UpsertRelayChannelProbeProfileRequest, actorUserId: string) {
    const channel = await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    if (channel.channelType !== "standalone") throw new BadRequestError("仅独立渠道支持余额探针");
    this.assertProbeChannelCompatibility(channel, body.probeFormat, body.probeModel);
    const existing = await this.repository.findProfile(channelId);
    const encrypted = body.credentials ? this.encryptCredentials(body.credentials) : undefined;
    if (!existing && !encrypted) throw new BadRequestError("首次配置探针必须提供凭据");
    const profile = await this.repository.upsertProfile({
      where: { relayChannelId: channelId },
      create: {
        relayChannelId: channelId,
        enabled: body.enabled,
        probeFormat: body.probeFormat,
        probeModel: body.probeModel,
        probePayload: body.probePayload as Prisma.InputJsonValue,
        upstreamCurrency: body.upstreamCurrency || "CNY",
        localCurrency: body.localCurrency || "CNY",
        upstreamBalanceDivisor: body.upstreamBalanceDivisor ?? 1,
        upstreamRateMultiplier: body.upstreamRateMultiplier ?? 1,
        probeGroup: this.normalizeProbeGroup(body.probeGroup),
        distributionMultiplier: body.distributionMultiplier ?? 1,
        workflow: body.workflow as unknown as Prisma.InputJsonValue,
        encryptedCredentials: encrypted?.ciphertext,
        credentialIv: encrypted?.iv,
        credentialAuthTag: encrypted?.authTag,
      },
      update: {
        enabled: body.enabled,
        probeFormat: body.probeFormat,
        probeModel: body.probeModel,
        probePayload: body.probePayload as Prisma.InputJsonValue,
        upstreamCurrency: body.upstreamCurrency || "CNY",
        localCurrency: body.localCurrency || "CNY",
        upstreamBalanceDivisor: body.upstreamBalanceDivisor ?? 1,
        upstreamRateMultiplier: body.upstreamRateMultiplier ?? 1,
        probeGroup: this.normalizeProbeGroup(body.probeGroup),
        distributionMultiplier: body.distributionMultiplier ?? 1,
        workflow: body.workflow as unknown as Prisma.InputJsonValue,
        ...(encrypted
          ? {
              encryptedCredentials: encrypted.ciphertext,
              credentialIv: encrypted.iv,
              credentialAuthTag: encrypted.authTag,
            }
          : {}),
      },
    });
    return this.toProfileDto(profile);
  }

  async clearProfile(channelId: string, actorUserId: string): Promise<void> {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    await this.channelLockService.withWrite(channelId, async () => {
      if (await this.repository.findActiveRun(channelId))
        throw new ConflictError("渠道存在排队或运行中的探针，暂时不能清空档案");
      if (!(await this.repository.findProfile(channelId))) throw new NotFoundError("渠道探针档案不存在");
      await this.repository.deleteProfile(channelId);
    });
  }

  /** Cancels stuck queued/running work and releases its queue slot without changing the probe profile. */
  async resetRunState(channelId: string, actorUserId: string): Promise<void> {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const runIds = await this.repository.cancelActiveRuns(channelId, "探针任务已由操作人员重置");
    await Promise.all(
      runIds.map((runId) => this.redis.deleteIfValueMatches(this.getRunQueueSlotKey(channelId), runId)),
    );
    // A process restart can leave only the Redis reservation behind. At this point
    // all persisted active runs have been cancelled, so force-release the exact
    // channel slot even when there was no matching database row.
    await this.redis.delete(this.getRunQueueSlotKey(channelId));
  }

  async createRun(
    channelId: string,
    body: CreateRelayChannelProbeRunRequest,
    actorUserId: string,
  ): Promise<RelayChannelProbeRunDto> {
    const channel = await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const profile = await this.repository.findProfileWithChannel(channelId);
    if (!profile) throw new NotFoundError("渠道探针档案不存在");
    if (!profile.enabled) throw new BadRequestError("渠道探针已停用");
    this.assertProbeChannelCompatibility(channel, profile.probeFormat, profile.probeModel);
    if (profile.relayChannel.channelType !== "standalone") throw new BadRequestError("仅独立渠道支持余额探针");
    const active = await this.repository.findActiveRun(channelId);
    if (active) throw new ConflictError("该渠道已有探针任务正在排队或执行");
    if (!this.redis.isRedisAvailable())
      throw new LockBackendUnavailableError("Relay channel probe queue backend unavailable");
    const reservationId = randomUUID();
    const queueKey = this.getRunQueueSlotKey(channelId);
    const reserved = await this.redis.setIfNotExists(queueKey, reservationId, RUN_QUEUE_SLOT_TTL_MS);
    if (reserved === null) throw new LockBackendUnavailableError("Relay channel probe queue backend unavailable");
    if (!reserved) throw new ConflictError("该渠道已有探针任务正在排队或执行");

    try {
      const run = await this.repository.createRun({
        relayChannelId: channelId,
        profileId: profile.id,
        requestedByUserId: actorUserId,
        distributionMultiplier: body.distributionMultiplier ?? profile.distributionMultiplier,
      });
      const attached = await this.redis.replaceIfValueMatches(queueKey, reservationId, run.id, RUN_QUEUE_SLOT_TTL_MS);
      // The persistent run remains authoritative if Redis recovers between the
      // reservation and attachment. The database active-run check still keeps
      // later submissions from creating a second task.
      if (attached !== true)
        logger.warn("Relay channel probe queue slot could not be attached", { channelId, runId: run.id });
      return this.toRunDto(run);
    } catch (error) {
      await this.redis.deleteIfValueMatches(queueKey, reservationId).catch(() => null);
      throw error;
    }
  }

  async createRuns(
    body: CreateRelayChannelProbeRunsRequest,
    actorUserId: string,
  ): Promise<CreateRelayChannelProbeRunsResponse> {
    const queued: RelayChannelProbeRunDto[] = [];
    const rejected: Array<{ channelId: string; reason: string }> = [];

    // Queue one record at a time so a blocked or already-running channel never prevents
    // independent channels from being scheduled.
    for (const channelId of body.channelIds) {
      try {
        queued.push(
          await this.createRun(channelId, { distributionMultiplier: body.distributionMultiplier }, actorUserId),
        );
      } catch (error) {
        rejected.push({
          channelId,
          reason: error instanceof Error ? error.message : "探针任务创建失败",
        });
      }
    }
    return { queued, rejected };
  }

  async listRuns(channelId: string, actorUserId: string, page = 1, pageSize = 20) {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const result = await this.repository.listRuns(channelId, page, pageSize);
    return { items: result.items.map((record) => this.toRunDto(record)), total: result.total, page, pageSize };
  }

  async clearRunHistory(
    channelId: string,
    scope: RelayChannelProbeRunHistoryScope,
    actorUserId: string,
  ): Promise<ClearRelayChannelProbeRunHistoryResponse> {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const result = await this.repository.clearRunHistory(channelId, scope);
    return { deleted: result.count };
  }

  async applyRuns(
    body: ApplyRelayChannelProbeRunsRequest,
    actorUserId: string,
  ): Promise<ApplyRelayChannelProbeRunsResponse> {
    const runs = await this.repository.findRunsWithChannels(body.runIds);
    const overrides = new Map((body.overrides || []).map((item) => [item.runId, item.multiplier]));
    const rejected: Array<{ runId: string; reason: string }> = [];
    let applied = 0;
    for (const run of runs) {
      try {
        await RelayChannelService.getInstance().getChannel(run.relayChannelId, actorUserId);
        if (run.status !== "succeeded" || run.suggestedMultiplier == null || run.appliedAt)
          throw new BadRequestError("探针结果不可应用");
        if (!run.finishedAt || Date.now() - run.finishedAt.getTime() > SUGGESTION_MAX_AGE_MS)
          throw new BadRequestError("探针建议已过期");
        if (
          run.sourceChannelMultiplier == null ||
          Number(run.relayChannel.multiplier) !== Number(run.sourceChannelMultiplier)
        )
          throw new ConflictError("渠道倍率已变更，请重新探针");
        const targetMultiplier = overrides.get(run.id) ?? Number(run.suggestedMultiplier);
        const appliedRun = await this.repository.applySuggestedMultiplier({
          runId: run.id,
          channelId: run.relayChannelId,
          expectedMultiplier: run.sourceChannelMultiplier,
          suggestedMultiplier: targetMultiplier,
          actorUserId,
        });
        if (!appliedRun) throw new ConflictError("渠道倍率已变更，请重新探针");
        applied += 1;
      } catch (error) {
        rejected.push({ runId: run.id, reason: error instanceof Error ? error.message : "应用失败" });
      }
    }
    const foundRunIds = new Set(runs.map((run) => run.id));
    for (const runId of body.runIds) if (!foundRunIds.has(runId)) rejected.push({ runId, reason: "探针记录不存在" });
    return { applied, rejected };
  }

  start(): void {
    setInterval(() => void this.processNext(), 5_000).unref();
    setInterval(() => void this.cleanupExpiredRuns(), 60 * 60 * 1000).unref();
    void this.processNext();
    void this.cleanupExpiredRuns();
  }

  private async processNext(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const owner = randomUUID();
      const now = new Date();
      const candidate = await this.repository.findClaimableRun(now);
      if (!candidate) return;
      const claimed = await this.repository.claimRun(candidate.id, owner, now, new Date(Date.now() + RUN_LEASE_MS));
      if (!claimed.count) return;
      await this.executeRun(candidate.id, owner);
    } finally {
      this.running = false;
    }
  }

  private async executeRun(runId: string, owner: string): Promise<void> {
    const run = await this.repository.findRunWithProfile(runId);
    if (!run || run.leaseOwner !== owner) return;
    if (!run.profile) {
      await this.repository.completeClaimedRun(runId, owner, {
        status: "cancelled",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorMessage: "探针档案已清空，任务已取消",
      });
      return;
    }
    const leaseHeartbeat = setInterval(
      () => {
        void this.repository.heartbeatRun(runId, owner, new Date(Date.now() + RUN_LEASE_MS));
      },
      Math.floor(RUN_LEASE_MS / 3),
    );
    leaseHeartbeat.unref();
    try {
      const profile = run.profile;
      const executeProbe = () =>
        this.channelLockService.withWrite(profile.relayChannelId, async () => {
          const variables = this.decryptCredentials(profile);
          const workflow = profile.workflow as unknown as RelayChannelProbeWorkflowStepDto[];
          const beforeBalance = await this.runProbePhase("读取请求前余额", () => this.runWorkflow(workflow, variables));
          await waitForProbeSettlement(PROBE_BEFORE_REQUEST_SETTLEMENT_DELAY_MS);
          const upstreamResponse = await this.runProbePhase("最小模型请求", () =>
            this.callUpstream(profile, variables),
          );
          const usage = this.extractUsage(upstreamResponse);
          assertProbeUsage(usage);
          await waitForProbeSettlement(PROBE_AFTER_REQUEST_SETTLEMENT_DELAY_MS);
          const afterBalance = await this.runProbePhase("读取请求后余额", () => this.runWorkflow(workflow, variables));
          return { before: beforeBalance, after: afterBalance, usage };
        });
      const { before, usage, after } = profile.probeGroup
        ? await this.channelLockService.withWrite(
            this.getProbeGroupLockId(profile.probeGroup),
            executeProbe,
            GROUP_LOCK_TIMEOUT_MS,
          )
        : await executeProbe();
      const balanceDivisor = Number(profile.upstreamBalanceDivisor);
      if (!Number.isFinite(balanceDivisor) || balanceDivisor <= 0) throw new BadRequestError("上游余额换算除数无效");
      const normalizedBefore = before / balanceDivisor;
      const normalizedAfter = after / balanceDivisor;
      if (!Number.isFinite(normalizedBefore) || !Number.isFinite(normalizedAfter))
        throw new BadRequestError("上游余额换算结果无效");
      const upstreamDelta = normalizedBefore - normalizedAfter;
      const upstreamRateMultiplier = Number(profile.upstreamRateMultiplier);
      const baseCost = await this.calculateBaseCost(profile, usage);
      const comparable =
        profile.upstreamCurrency === profile.localCurrency &&
        upstreamDelta > 0 &&
        baseCost > 0 &&
        usage.totalTokens > 0;
      const suggested = comparable
        ? calculateSuggestedProbeMultiplier(
            upstreamDelta,
            upstreamRateMultiplier,
            Number(run.distributionMultiplier),
            baseCost,
          )
        : undefined;
      await this.repository.completeClaimedRun(runId, owner, {
        status: "succeeded",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        upstreamBalanceBefore: normalizedBefore,
        upstreamBalanceAfter: normalizedAfter,
        upstreamBalanceDelta: upstreamDelta,
        upstreamRateMultiplier,
        localBalanceBefore: 0,
        localBalanceAfter: comparable
          ? -(upstreamDelta * upstreamRateMultiplier * Number(run.distributionMultiplier))
          : 0,
        localBalanceDelta: comparable ? upstreamDelta * upstreamRateMultiplier * Number(run.distributionMultiplier) : 0,
        baseLocalCost: baseCost,
        requestTokens: usage.requestTokens,
        responseTokens: usage.responseTokens,
        totalTokens: usage.totalTokens,
        suggestedMultiplier: suggested,
        sourceChannelMultiplier: profile.relayChannel.multiplier,
      });
    } catch (error) {
      await this.repository.completeClaimedRun(runId, owner, {
        status: axios.isAxiosError(error) && error.code === "ECONNABORTED" ? "timed_out" : "failed",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorMessage: this.safeError(error),
      });
    } finally {
      clearInterval(leaseHeartbeat);
      await this.redis
        .deleteIfValueMatches(this.getRunQueueSlotKey(run.profile.relayChannelId), runId)
        .catch(() => null);
    }
  }

  private async runWorkflow(
    workflow: RelayChannelProbeWorkflowStepDto[],
    variables: Record<string, string>,
  ): Promise<number> {
    let balance: number | undefined;
    for (const step of workflow) {
      const rawUrl = interpolateRequiredProbeVariables(step.url, variables) as string;
      const safe = await assertSafeOutboundUrl(rawUrl);
      const response = await axios.request({
        method: step.method,
        url: safe.url.toString(),
        headers: interpolateRequiredProbeVariables(step.headers || {}, variables) as Record<string, string>,
        params: interpolateRequiredProbeVariables(step.query || {}, variables),
        data: interpolateRequiredProbeVariables(step.body || {}, variables),
        httpAgent: safe.httpAgent,
        httpsAgent: safe.httpsAgent,
        // A probe must use the validated and DNS-pinned target directly. Letting
        // Axios inherit HTTP(S)_PROXY bypasses that boundary and can turn a bad
        // deployment proxy into an opaque "Invalid IP address" probe failure.
        proxy: false,
        timeout: PROBE_TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      for (const [name, path] of Object.entries(step.extract || {})) {
        const value = readProbeJsonPath(response.data, path);
        if (value == null) throw new BadRequestError(`探针变量 ${name} 未在上游响应中找到`);
        variables[name] = String(value);
      }
      if (step.balancePath) {
        balance = toNumber(readProbeJsonPath(response.data, step.balancePath));
        if (balance === undefined) throw new BadRequestError("上游余额字段不是有效数值");
      }
    }
    if (balance === undefined) throw new BadRequestError("余额工作流未返回余额");
    return balance;
  }

  private async callUpstream(
    profile: ProbeProfileRecord,
    variables: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const channel = profile.relayChannel;
    const format = profile.probeFormat as "openai" | "anthropic" | "gemini";
    const upstreamUrl =
      format === "anthropic"
        ? channel.anthropicUpstreamUrl
        : format === "gemini"
          ? channel.geminiUpstreamUrl
          : channel.openaiUpstreamUrl;
    const apiKey =
      format === "anthropic"
        ? channel.anthropicUpstreamApiKey
        : format === "gemini"
          ? channel.geminiUpstreamApiKey
          : channel.openaiUpstreamApiKey;
    if (!upstreamUrl || !apiKey) throw new BadRequestError("渠道缺少对应格式的上游配置");
    const base = await assertSafeOutboundUrl(upstreamUrl);
    const payload = interpolateRequiredProbeVariables(
      { ...(profile.probePayload as Record<string, unknown>), model: profile.probeModel },
      variables,
    ) as Record<string, unknown>;
    const headers: Record<string, string> =
      format === "anthropic"
        ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${apiKey}` };
    const endpointUrl = new URL(buildProbeUpstreamEndpoint(base.url.toString(), format, profile.probeModel));
    if (format === "gemini") endpointUrl.searchParams.set("key", apiKey);
    const response = await axios.post(endpointUrl.toString(), payload, {
      headers,
      httpAgent: base.httpAgent,
      httpsAgent: base.httpsAgent,
      proxy: false,
      timeout: PROBE_TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return response.data as Record<string, unknown>;
  }

  private extractUsage(response: Record<string, unknown>) {
    const usage = (response.usage || response.usageMetadata || {}) as Record<string, unknown>;
    const metrics = extractTokenUsageMetrics(usage);
    const hasExplicitInputTokens =
      hasTokenValue(usage.prompt_tokens) || hasTokenValue(usage.input_tokens) || hasTokenValue(usage.promptTokenCount);
    const normalized = normalizeTokenBreakdown(
      metrics.inputTokens,
      metrics.outputTokens,
      metrics.totalTokens,
      hasExplicitInputTokens ? 0 : 0,
    );
    return {
      requestTokens: normalized.requestTokens,
      responseTokens: normalized.responseTokens,
      totalTokens: normalized.totalTokens,
      cacheCreationTokens: metrics.cacheCreationTokens,
      cacheReadTokens: metrics.cacheReadTokens,
    };
  }

  private async calculateBaseCost(
    profile: ProbeProfileRecord,
    usage: {
      requestTokens: number;
      responseTokens: number;
      totalTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
    },
  ) {
    const mappedModel =
      ((profile.relayChannel.modelMapping as Record<string, string> | null) || {})[profile.probeModel] ||
      profile.probeModel;
    const rate = (await ModelPricingService.getInstance().getModelPricing()).find((item) => item.model === mappedModel);
    if (!rate) throw new BadRequestError("探针模型没有本地定价配置");
    const relayConfig = await RelayConfigService.getInstance().getRelayConfig();
    const timeMultiplier = computeMultiplierForTime(
      (profile.relayChannel.timePeriodMultipliers as any[]) || [],
      new Date(),
    );
    const multiplier = Number(relayConfig.globalMultiplier || 1) * timeMultiplier;
    if (rate.pricingType === "per-request")
      return Math.max(0, Math.ceil(Number(rate.fixedPrice || 0) * multiplier * 10_000) / 10_000);

    const inputRate = Number(rate.inputPrice || 0) / TOKEN_PRICE_DIVISOR;
    const outputRate = Number(rate.outputPrice || 0) / TOKEN_PRICE_DIVISOR;
    const billableInputTokens =
      profile.relayChannel.inputTokensIncludeCacheRead !== false
        ? Math.max(0, usage.requestTokens - usage.cacheReadTokens)
        : usage.requestTokens;
    const cacheCreationMultiplier = Number(rate.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER);
    const cacheReadMultiplier = Number(rate.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER);
    const rawCost =
      (billableInputTokens * inputRate +
        usage.cacheCreationTokens * inputRate * cacheCreationMultiplier +
        usage.cacheReadTokens * inputRate * cacheReadMultiplier +
        usage.responseTokens * outputRate) *
      multiplier;
    return Number.isFinite(rawCost) ? Math.max(0, Math.ceil(rawCost * 10_000) / 10_000) : 0;
  }

  private getEncryptionKey(): Buffer {
    const secret = EnvSpace.relayChannelProbeConfig.masterKey;
    if (secret.length < 64) throw new BadRequestError("渠道探针主密钥未配置");
    return createHash("sha256").update(secret).digest();
  }
  private encryptCredentials(credentials: Record<string, string>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]).toString(
      "base64",
    );
    return { ciphertext, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
  }
  private decryptCredentials(profile: ProbeProfileRecord): Record<string, string> {
    if (!profile.encryptedCredentials || !profile.credentialIv || !profile.credentialAuthTag)
      throw new BadRequestError("渠道探针凭据未配置");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.getEncryptionKey(),
      Buffer.from(profile.credentialIv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(profile.credentialAuthTag, "base64"));
    return JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(profile.encryptedCredentials, "base64")), decipher.final()]).toString(
        "utf8",
      ),
    );
  }
  private toProfileDto(profile: any): RelayChannelProbeProfileDto {
    return {
      id: profile.id,
      relayChannelId: profile.relayChannelId,
      enabled: profile.enabled,
      probeFormat: profile.probeFormat,
      probeModel: profile.probeModel,
      probePayload: profile.probePayload as Record<string, unknown>,
      upstreamCurrency: profile.upstreamCurrency,
      localCurrency: profile.localCurrency,
      upstreamBalanceDivisor: Number(profile.upstreamBalanceDivisor),
      upstreamRateMultiplier: Number(profile.upstreamRateMultiplier),
      probeGroup: profile.probeGroup || undefined,
      distributionMultiplier: Number(profile.distributionMultiplier),
      workflow: profile.workflow as RelayChannelProbeWorkflowStepDto[],
      credentialNames: profile.encryptedCredentials ? Object.keys(this.decryptCredentials(profile)) : [],
      createTime: profile.createTime,
      updateTime: profile.updateTime,
    };
  }
  private toRunDto(run: ProbeRunRecord): RelayChannelProbeRunDto {
    const n = (value: Prisma.Decimal | null) => (value == null ? undefined : Number(value));
    return {
      id: run.id,
      relayChannelId: run.relayChannelId,
      profileId: run.profileId || undefined,
      status: run.status as RelayChannelProbeRunDto["status"],
      queuedAt: run.queuedAt,
      startedAt: run.startedAt || undefined,
      finishedAt: run.finishedAt || undefined,
      distributionMultiplier: Number(run.distributionMultiplier),
      upstreamBalanceBefore: n(run.upstreamBalanceBefore),
      upstreamBalanceAfter: n(run.upstreamBalanceAfter),
      upstreamBalanceDelta: n(run.upstreamBalanceDelta),
      upstreamRateMultiplier: Number(run.upstreamRateMultiplier),
      localBalanceBefore: n(run.localBalanceBefore),
      localBalanceAfter: n(run.localBalanceAfter),
      localBalanceDelta: n(run.localBalanceDelta),
      baseLocalCost: n(run.baseLocalCost),
      requestTokens: run.requestTokens || undefined,
      responseTokens: run.responseTokens || undefined,
      totalTokens: run.totalTokens || undefined,
      suggestedMultiplier: n(run.suggestedMultiplier),
      sourceChannelMultiplier: n(run.sourceChannelMultiplier),
      appliedMultiplier: n(run.appliedMultiplier),
      appliedAt: run.appliedAt || undefined,
      errorMessage: run.errorMessage || undefined,
      requestedByUserId: run.requestedByUserId,
      createTime: run.createTime,
      updateTime: run.updateTime,
    };
  }
  private safeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.response)
        return formatProbeUpstreamError(error.response.status, error.config?.url, error.response.data);
      return normalizeProbeNetworkError(redactProbeErrorText(error.message) || "上游请求失败");
    }
    const message = error instanceof Error ? error.message : "探针执行失败";
    return normalizeProbeNetworkError(redactProbeErrorText(message) || "探针执行失败");
  }

  private async runProbePhase<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new Error(`${phase}失败：${this.safeError(error)}`);
    }
  }

  private normalizeProbeGroup(value: string | undefined): string | null {
    const group = value?.trim();
    return group || null;
  }

  private toAllowedProbeFormats(value: string): Array<"openai" | "anthropic" | "gemini"> {
    const values = value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item): item is "openai" | "anthropic" | "gemini" => ["openai", "anthropic", "gemini"].includes(item));
    return values.length || value.trim().toLowerCase() === "all"
      ? values.length
        ? values
        : ["openai", "anthropic", "gemini"]
      : [];
  }

  private getProbeGroupLockId(group: string): string {
    const fingerprint = createHash("sha256").update(group).digest("hex").slice(0, 32);
    return `probe-group:${fingerprint}`;
  }

  private assertProbeChannelCompatibility(
    channel: Awaited<ReturnType<RelayChannelService["getChannel"]>>,
    format: string,
    model: string,
  ): void {
    const configuredFormats = channel.allowedFormats
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (!configuredFormats.includes("all") && !configuredFormats.includes(format))
      throw new BadRequestError(`渠道不支持 ${format} 格式探针请求`);

    if (channel.allowedModels.length && !channel.allowedModels.includes(model))
      throw new BadRequestError(`渠道不支持探针模型 ${model}，请从渠道已配置模型中选择`);

    const upstreamConfigured =
      format === "openai"
        ? Boolean(channel.openaiUpstreamUrl && channel.hasOpenaiUpstreamApiKey)
        : format === "anthropic"
          ? Boolean(channel.anthropicUpstreamUrl && channel.hasAnthropicUpstreamApiKey)
          : Boolean(channel.geminiUpstreamUrl && channel.hasGeminiUpstreamApiKey);
    if (!upstreamConfigured) throw new BadRequestError(`渠道缺少 ${format} 格式的上游地址或凭据`);
  }

  private async cleanupExpiredRuns(): Promise<void> {
    if (Date.now() - this.lastCleanupAt < 60 * 60 * 1000) return;
    this.lastCleanupAt = Date.now();
    await this.repository.deleteRunsBefore(new Date(Date.now() - RUN_RETENTION_MS));
  }

  private getRunQueueSlotKey(channelId: string): string {
    return `${RUN_QUEUE_SLOT_PREFIX}:${channelId}`;
  }
}
