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
import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER, TOKEN_PRICE_DIVISOR } from "@/constant/pricing";
import { extractTokenUsageMetrics, hasTokenValue, normalizeTokenBreakdown } from "@/util/token-usage.util";
import type {
  ApplyRelayChannelProbeRunsRequest,
  ApplyRelayChannelProbeRunsResponse,
  CreateRelayChannelProbeRunRequest,
  RelayChannelProbeOverviewItemDto,
  RelayChannelProbeProfileDto,
  RelayChannelProbeRunDto,
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
  if (typeof value === "string") return value.replace(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g, (_, key) => variables[key] ?? "");
  if (Array.isArray(value)) return value.map((item) => interpolateProbeVariables(item, variables));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, interpolateProbeVariables(item, variables)]));
  return value;
}

export function calculateSuggestedProbeMultiplier(
  upstreamBalanceDelta: number,
  distributionMultiplier: number,
  baseLocalCost: number,
): number | undefined {
  const value = (upstreamBalanceDelta * distributionMultiplier) / baseLocalCost;
  if (!Number.isFinite(value) || upstreamBalanceDelta <= 0 || baseLocalCost <= 0 || value < 0 || value > 1000)
    return undefined;
  return Math.round(value * 1_000_000) / 1_000_000;
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
    const [profiles, runs] = await Promise.all([this.repository.listProfiles(channelIds), this.repository.listLatestRuns(channelIds)]);
    const profileMap = new Map(profiles.map((profile) => [profile.relayChannelId, profile]));
    const runMap = new Map(runs.map((run) => [run.relayChannelId, run]));
    return standalone.map((channel) => ({
      channelId: channel.id,
      channelName: channel.name,
      enabled: channel.enabled,
      multiplier: channel.multiplier,
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
        distributionMultiplier: body.distributionMultiplier ?? 1,
        workflow: body.workflow as unknown as Prisma.InputJsonValue,
        ...(encrypted
          ? { encryptedCredentials: encrypted.ciphertext, credentialIv: encrypted.iv, credentialAuthTag: encrypted.authTag }
          : {}),
      },
    });
    return this.toProfileDto(profile);
  }

  async createRun(channelId: string, body: CreateRelayChannelProbeRunRequest, actorUserId: string): Promise<RelayChannelProbeRunDto> {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const profile = await this.repository.findProfileWithChannel(channelId);
    if (!profile) throw new NotFoundError("渠道探针档案不存在");
    if (!profile.enabled) throw new BadRequestError("渠道探针已停用");
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

  async listRuns(channelId: string, actorUserId: string, page = 1, pageSize = 20) {
    await RelayChannelService.getInstance().getChannel(channelId, actorUserId);
    const result = await this.repository.listRuns(channelId, page, pageSize);
    return { items: result.items.map((record) => this.toRunDto(record)), total: result.total, page, pageSize };
  }

  async applyRuns(body: ApplyRelayChannelProbeRunsRequest, actorUserId: string): Promise<ApplyRelayChannelProbeRunsResponse> {
    const runs = await this.repository.findRunsWithChannels(body.runIds);
    const rejected: Array<{ runId: string; reason: string }> = [];
    let applied = 0;
    for (const run of runs) {
      try {
        await RelayChannelService.getInstance().getChannel(run.relayChannelId, actorUserId);
        if (run.status !== "succeeded" || run.suggestedMultiplier == null || run.appliedAt)
          throw new BadRequestError("探针结果不可应用");
        if (!run.finishedAt || Date.now() - run.finishedAt.getTime() > SUGGESTION_MAX_AGE_MS)
          throw new BadRequestError("探针建议已过期");
        if (run.sourceChannelMultiplier == null || Number(run.relayChannel.multiplier) !== Number(run.sourceChannelMultiplier)) throw new ConflictError("渠道倍率已变更，请重新探针");
        const appliedRun = await this.repository.applySuggestedMultiplier({
          runId: run.id,
          channelId: run.relayChannelId,
          expectedMultiplier: run.sourceChannelMultiplier,
          suggestedMultiplier: run.suggestedMultiplier,
          actorUserId,
        });
        if (!appliedRun) throw new ConflictError("渠道倍率已变更，请重新探针");
        applied += 1;
      } catch (error) {
        rejected.push({ runId: run.id, reason: error instanceof Error ? error.message : "应用失败" });
      }
    }
    const foundRunIds = new Set(runs.map((run) => run.id));
    for (const runId of body.runIds)
      if (!foundRunIds.has(runId)) rejected.push({ runId, reason: "探针记录不存在" });
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
    const leaseHeartbeat = setInterval(() => {
      void this.repository.heartbeatRun(runId, owner, new Date(Date.now() + RUN_LEASE_MS));
    }, Math.floor(RUN_LEASE_MS / 3));
    leaseHeartbeat.unref();
    try {
      const profile = run.profile;
      const { before, response, after } = await this.channelLockService.withWrite(profile.relayChannelId, async () => {
        const variables = this.decryptCredentials(profile);
        const beforeBalance = await this.runWorkflow(profile.workflow as unknown as RelayChannelProbeWorkflowStepDto[], variables);
        const upstreamResponse = await this.callUpstream(profile, variables);
        const afterBalance = await this.runWorkflow(profile.workflow as unknown as RelayChannelProbeWorkflowStepDto[], variables);
        return { before: beforeBalance, response: upstreamResponse, after: afterBalance };
      });
      const upstreamDelta = before - after;
      const usage = this.extractUsage(response);
      const baseCost = await this.calculateBaseCost(profile, usage);
      const comparable = profile.upstreamCurrency === profile.localCurrency && upstreamDelta > 0 && baseCost > 0 && usage.totalTokens > 0;
      const suggested = comparable
        ? calculateSuggestedProbeMultiplier(upstreamDelta, Number(run.distributionMultiplier), baseCost)
        : undefined;
      await this.repository.completeRun(runId, {
        status: "succeeded", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null,
        upstreamBalanceBefore: before, upstreamBalanceAfter: after, upstreamBalanceDelta: upstreamDelta,
        localBalanceBefore: 0, localBalanceAfter: comparable ? -(upstreamDelta * Number(run.distributionMultiplier)) : 0,
        localBalanceDelta: comparable ? upstreamDelta * Number(run.distributionMultiplier) : 0,
        baseLocalCost: baseCost, requestTokens: usage.requestTokens, responseTokens: usage.responseTokens, totalTokens: usage.totalTokens,
        suggestedMultiplier: suggested, sourceChannelMultiplier: profile.relayChannel.multiplier,
      });
    } catch (error) {
      await this.repository.completeRun(runId, {
        status: axios.isAxiosError(error) && error.code === "ECONNABORTED" ? "timed_out" : "failed",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorMessage: this.safeError(error),
      });
    } finally {
      clearInterval(leaseHeartbeat);
      await this.redis.deleteIfValueMatches(this.getRunQueueSlotKey(run.profile.relayChannelId), runId).catch(() => null);
    }
  }

  private async runWorkflow(workflow: RelayChannelProbeWorkflowStepDto[], variables: Record<string, string>): Promise<number> {
    let balance: number | undefined;
    for (const step of workflow) {
      const rawUrl = interpolateProbeVariables(step.url, variables) as string;
      const safe = await assertSafeOutboundUrl(rawUrl);
      const response = await axios.request({ method: step.method, url: safe.url.toString(), headers: interpolateProbeVariables(step.headers || {}, variables) as Record<string, string>, params: interpolateProbeVariables(step.query || {}, variables), data: interpolateProbeVariables(step.body || {}, variables), httpAgent: safe.httpAgent, httpsAgent: safe.httpsAgent, timeout: PROBE_TIMEOUT_MS, maxRedirects: 0, maxContentLength: MAX_RESPONSE_BYTES, validateStatus: (status) => status >= 200 && status < 300 });
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

  private async callUpstream(profile: ProbeProfileRecord, variables: Record<string, string>): Promise<Record<string, unknown>> {
    const channel = profile.relayChannel;
    const format = profile.probeFormat;
    const upstreamUrl = format === "anthropic" ? channel.anthropicUpstreamUrl : format === "gemini" ? channel.geminiUpstreamUrl : channel.openaiUpstreamUrl;
    const apiKey = format === "anthropic" ? channel.anthropicUpstreamApiKey : format === "gemini" ? channel.geminiUpstreamApiKey : channel.openaiUpstreamApiKey;
    if (!upstreamUrl || !apiKey) throw new BadRequestError("渠道缺少对应格式的上游配置");
    const base = await assertSafeOutboundUrl(upstreamUrl);
    const payload = interpolateProbeVariables({ ...(profile.probePayload as Record<string, unknown>), model: profile.probeModel }, variables) as Record<string, unknown>;
    const headers: Record<string, string> = format === "anthropic" ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${apiKey}` };
    const endpoint = format === "gemini" ? `${base.url.toString().replace(/\/$/, "")}/models/${encodeURIComponent(profile.probeModel)}:generateContent?key=${encodeURIComponent(apiKey)}` : `${base.url.toString().replace(/\/$/, "")}/${format === "anthropic" ? "v1/messages" : "chat/completions"}`;
    const response = await axios.post(endpoint, payload, { headers, httpAgent: base.httpAgent, httpsAgent: base.httpsAgent, timeout: PROBE_TIMEOUT_MS, maxRedirects: 0, maxContentLength: MAX_RESPONSE_BYTES, validateStatus: (status) => status >= 200 && status < 300 });
    return response.data as Record<string, unknown>;
  }

  private extractUsage(response: Record<string, unknown>) {
    const usage = (response.usage || response.usageMetadata || {}) as Record<string, unknown>;
    const metrics = extractTokenUsageMetrics(usage);
    const hasExplicitInputTokens = hasTokenValue(usage.prompt_tokens) || hasTokenValue(usage.input_tokens) || hasTokenValue(usage.promptTokenCount);
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

  private async calculateBaseCost(profile: ProbeProfileRecord, usage: { requestTokens: number; responseTokens: number; totalTokens: number; cacheCreationTokens: number; cacheReadTokens: number }) {
    const mappedModel = ((profile.relayChannel.modelMapping as Record<string, string> | null) || {})[profile.probeModel] || profile.probeModel;
    const rate = (await ModelPricingService.getInstance().getModelPricing()).find((item) => item.model === mappedModel);
    if (!rate) throw new BadRequestError("探针模型没有本地定价配置");
    const relayConfig = await RelayConfigService.getInstance().getRelayConfig();
    const timeMultiplier = computeMultiplierForTime((profile.relayChannel.timePeriodMultipliers as any[]) || [], new Date());
    const multiplier = Number(relayConfig.globalMultiplier || 1) * timeMultiplier;
    if (rate.pricingType === "per-request")
      return Math.max(0, Math.ceil(Number(rate.fixedPrice || 0) * multiplier * 10_000) / 10_000);

    const inputRate = Number(rate.inputPrice || 0) / TOKEN_PRICE_DIVISOR;
    const outputRate = Number(rate.outputPrice || 0) / TOKEN_PRICE_DIVISOR;
    const billableInputTokens = profile.relayChannel.inputTokensIncludeCacheRead !== false
      ? Math.max(0, usage.requestTokens - usage.cacheReadTokens)
      : usage.requestTokens;
    const cacheCreationMultiplier = Number(rate.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER);
    const cacheReadMultiplier = Number(rate.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER);
    const rawCost = (
      billableInputTokens * inputRate +
      usage.cacheCreationTokens * inputRate * cacheCreationMultiplier +
      usage.cacheReadTokens * inputRate * cacheReadMultiplier +
      usage.responseTokens * outputRate
    ) * multiplier;
    return Number.isFinite(rawCost) ? Math.max(0, Math.ceil(rawCost * 10_000) / 10_000) : 0;
  }

  private getEncryptionKey(): Buffer {
    const secret = EnvSpace.relayChannelProbeConfig.masterKey;
    if (secret.length < 64) throw new BadRequestError("渠道探针主密钥未配置");
    return createHash("sha256").update(secret).digest();
  }
  private encryptCredentials(credentials: Record<string, string>) {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]).toString("base64");
    return { ciphertext, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
  }
  private decryptCredentials(profile: ProbeProfileRecord): Record<string, string> {
    if (!profile.encryptedCredentials || !profile.credentialIv || !profile.credentialAuthTag) throw new BadRequestError("渠道探针凭据未配置");
    const decipher = createDecipheriv("aes-256-gcm", this.getEncryptionKey(), Buffer.from(profile.credentialIv, "base64"));
    decipher.setAuthTag(Buffer.from(profile.credentialAuthTag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(profile.encryptedCredentials, "base64")), decipher.final()]).toString("utf8"));
  }
  private toProfileDto(profile: any): RelayChannelProbeProfileDto { return { id: profile.id, relayChannelId: profile.relayChannelId, enabled: profile.enabled, probeFormat: profile.probeFormat, probeModel: profile.probeModel, probePayload: profile.probePayload as Record<string, unknown>, upstreamCurrency: profile.upstreamCurrency, localCurrency: profile.localCurrency, distributionMultiplier: Number(profile.distributionMultiplier), workflow: profile.workflow as RelayChannelProbeWorkflowStepDto[], credentialNames: profile.encryptedCredentials ? Object.keys(this.decryptCredentials(profile)) : [], createTime: profile.createTime, updateTime: profile.updateTime }; }
  private toRunDto(run: ProbeRunRecord): RelayChannelProbeRunDto { const n = (value: Prisma.Decimal | null) => value == null ? undefined : Number(value); return { id: run.id, relayChannelId: run.relayChannelId, profileId: run.profileId, status: run.status as RelayChannelProbeRunDto["status"], queuedAt: run.queuedAt, startedAt: run.startedAt || undefined, finishedAt: run.finishedAt || undefined, distributionMultiplier: Number(run.distributionMultiplier), upstreamBalanceBefore: n(run.upstreamBalanceBefore), upstreamBalanceAfter: n(run.upstreamBalanceAfter), upstreamBalanceDelta: n(run.upstreamBalanceDelta), localBalanceBefore: n(run.localBalanceBefore), localBalanceAfter: n(run.localBalanceAfter), localBalanceDelta: n(run.localBalanceDelta), baseLocalCost: n(run.baseLocalCost), requestTokens: run.requestTokens || undefined, responseTokens: run.responseTokens || undefined, totalTokens: run.totalTokens || undefined, suggestedMultiplier: n(run.suggestedMultiplier), sourceChannelMultiplier: n(run.sourceChannelMultiplier), appliedMultiplier: n(run.appliedMultiplier), appliedAt: run.appliedAt || undefined, errorMessage: run.errorMessage || undefined, requestedByUserId: run.requestedByUserId, createTime: run.createTime, updateTime: run.updateTime }; }
  private safeError(error: unknown): string { const message = error instanceof Error ? error.message : "探针执行失败"; return message.replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]").slice(0, 500); }

  private async cleanupExpiredRuns(): Promise<void> {
    if (Date.now() - this.lastCleanupAt < 60 * 60 * 1000) return;
    this.lastCleanupAt = Date.now();
    await this.repository.deleteRunsBefore(new Date(Date.now() - RUN_RETENTION_MS));
  }

  private getRunQueueSlotKey(channelId: string): string {
    return `${RUN_QUEUE_SLOT_PREFIX}:${channelId}`;
  }
}
