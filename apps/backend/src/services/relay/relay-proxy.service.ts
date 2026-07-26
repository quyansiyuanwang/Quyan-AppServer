import axios from "axios";
import { randomUUID } from "crypto";
import https from "https";
import http from "http";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { RelayTokenRepository, RelayTokenWithChannel } from "@/store/relay/relay-token.repository";
import type { RelayTokenWithRelations } from "@/store/relay/relay-token.store";

// HTTP Agent configuration for connection pooling and keep-alive
// Reduced limits for low-spec servers (2v2g) to prevent resource exhaustion
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10, // Reduced from 100 - prevents too many concurrent connections
  maxFreeSockets: 2, // Reduced from 10 - limits idle connections
  timeout: 60000,
  scheduling: "lifo", // Use LIFO to reuse recent connections
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10, // Reduced from 100
  maxFreeSockets: 2, // Reduced from 10
  timeout: 60000,
  scheduling: "lifo",
});
import { RelayUsageRepository } from "@/store/relay/relay-usage.repository";
import { RelayProxyRepository } from "@/store/relay/relay-proxy.repository";
import type { ModelPricingDto } from "@/api/dto/relay/model-pricing.dto";
import type { RelayChannelRoutingConfigDto, RelayChannelRoutingStrategy } from "@/api/dto/relay/relay-channel.dto";
import type { RelayTokenStore } from "@/store/relay/relay-token.store";
import type { RelayUsageStore } from "@/store/relay/relay-usage.store";
import type { RelayProxyStore } from "@/store/relay/relay-proxy.store";
import { Prisma, RelayToken, RelayChannel } from "@prisma/client";
import {
  BadRequestError,
  ForbiddenError,
  GatewayTimeoutError,
  LockBackendUnavailableError,
  PayloadTooLargeError,
  TooManyRequestsError,
} from "@/util/errors";
import { RelayConfigService } from "./relay-config.service";
import { ModelPricingService } from "./model-pricing.service";
import {
  RelayPoolResolverService,
  type RelayPoolMemberGraph,
  type RelayResolvedChannelCandidate,
} from "./relay-pool-resolver.service";
import { computeMultiplierForTime, type TimePeriodRule } from "./time-period-multiplier.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { UsageChargeService } from "@/services/billing/usage-charge.service";
import { trackErrorForIp } from "@/middleware/error-tracker";
import { extractTokenUsageMetrics, hasTokenValue, normalizeTokenBreakdown } from "@/util/token-usage.util";
import { isModelIdAllowed, isModelNameAllowed, resolveModelId } from "@/util/model-resolution.util";
import { resolveMappedModel } from "@/util/model-mapping.util";
import {
  parseRelayRequestFormats,
  parseRelayChannelAllowedModelNames,
  parseRelayTokenAllowedModelIds,
  supportsRelayRequestFormat,
} from "@/util/relay-model-availability.util";
import {
  DEFAULT_CACHE_CREATION_MULTIPLIER,
  DEFAULT_CACHE_READ_MULTIPLIER,
  TOKEN_PRICE_DIVISOR,
} from "@/constant/pricing";
import { MONTHLY_PASS_QUOTA_WINDOW_MS } from "@/constant/monthly-pass";
import { RELAY_PROXY_DESCRIPTION_MAX_LENGTH, RELAY_PROXY_PROMPT_PREVIEW_MAX_LENGTH } from "@/constant/relay-proxy";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import { matchesRetryStatusRule, normalizeRetryStatusRules } from "@/util/relay-failover-status-rule.util";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { EnvSpace } from "@/config/env";
import logger from "@/util/logger";
import BusinessLogService from "@/services/system/businesslog.service";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { maskSensitiveData } from "@/util/mask-sensitive-data";
import { RelayChannelHealthService } from "./relay-channel-health.service";
import { RelayChannelProbeLockService } from "./relay-channel-probe-lock.service";

const PREFIX = "/relay/proxy";

const OPENAI_PATHS = [
  "/chat/completions",
  "/responses",
  "/images/generations",
  "/images/edits",
  "/images/variations",
  "/v1/chat/completions",
  "/v1/responses",
  "/v1/images/generations",
  "/v1/images/edits",
  "/v1/images/variations",
].map((p) => PREFIX + p);
const ANTHROPIC_PATHS = ["/messages", "/v1/messages"].map((p) => PREFIX + p);
const GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID = "global";
const GLOBAL_CONCURRENCY_STATUS_USER_ID = "*";
const CONCURRENCY_QUEUE_POLL_INTERVAL_MS = 100;
const RELAY_TOKEN_QUOTA_COMPARE_EPSILON = 1e-8;

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

interface RelayFailoverRuntimeConfig {
  enabled: boolean;
  maxRetries: number;
  retryStatusCodes: string[];
  failoverThreshold: number;
  failbackCooldownMinutes: number;
}

interface StreamForwardResult {
  handled: boolean;
  success: boolean;
  retryable: boolean;
  statusCode?: number;
  triggerError?: string;
}

interface ImageForwardResult extends StreamForwardResult {
  headers?: any;
  data?: any;
}

interface RelayAttemptPlan {
  channels: RelayResolvedChannelCandidate[];
  failoverConfig: RelayFailoverRuntimeConfig;
}

export interface RelayTokenAvailabilityInput {
  allowedModels?: string | null;
  modelMapping?: Prisma.JsonValue | Record<string, string> | null;
  channel?: RelayChannel | null;
  routingMode?: string | null;
  automaticProxyPoolChannel?: RelayChannel | null;
  channelConfigs?: Array<{
    channel?: RelayChannel | null;
    priority?: number | null;
  }> | null;
  failoverConfig?: {
    enabled?: boolean | null;
    maxRetries?: number | null;
    retryStatusCodes?: Prisma.JsonValue | string[] | null;
    failoverThreshold?: number | null;
    failbackCooldownMinutes?: number | null;
  } | null;
}

type RelayChannelWithPool = NonNullable<RelayTokenWithRelations["channel"]>;

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const JSON_CONTENT_TYPE_RE = /(^|;)\s*application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i;

type RelayChannelSkipReason =
  | "channel-no-models"
  | "channel-model-not-allowed"
  | "channel-upstream-missing"
  | "insufficient-balance";

interface RelayAttemptIssue {
  channelName: string;
  attemptNumber: number;
  reason: string;
  statusCode?: number;
}

interface SelectedRateConfig {
  pricingType: "token-based" | "per-request";
  fixedPrice?: number;
  input: number;
  output: number;
  multiplier: number;
  cacheCreationMultiplier: number;
  cacheReadMultiplier: number;
}

type RelayConcurrencyScope = "default" | "image";

type RelayCapacityPolicyName = "relayUpstreamConcurrency";

interface RelayCapacityPolicyContextMap {
  relayUpstreamConcurrency: {
    userId: string;
    isImageRequest: boolean;
    isStreamRequest: boolean;
    relayConfig: Awaited<ReturnType<RelayConfigService["getRelayConfig"]>>;
  };
}

interface RelayCapacityPolicy {
  userId: string;
  scope: RelayConcurrencyScope;
  maxConcurrency: number;
  queueTimeout: number;
  enableQueue: boolean;
  slotTtlSeconds: number;
}

interface RelayConcurrencyLease {
  key: string;
  baseKey: string;
  slotKey: string;
  scope: RelayConcurrencyScope;
  source: "redis";
  ownerToken: string;
  ttlMs: number;
  ttlSeconds: number;
}

class RelayChannelSkipError extends BadRequestError {
  constructor(
    message: string,
    public readonly reason: RelayChannelSkipReason,
  ) {
    super(message);
  }
}

export class RelayProxyService {
  private static instance: RelayProxyService;
  private readonly logicalRequestIds = new WeakMap<object, string>();

  constructor(
    private readonly relayTokenRepo: RelayTokenStore = RelayTokenRepository.getInstance(),
    private readonly relayUsageRepo: RelayUsageStore = RelayUsageRepository.getInstance(),
    private readonly relayProxyRepository: RelayProxyStore = RelayProxyRepository.getInstance(),
    private readonly relayConfigService: RelayConfigService = RelayConfigService.getInstance(),
    private readonly modelPricingService: ModelPricingService = ModelPricingService.getInstance(),
    private readonly usageChargeService: UsageChargeService = UsageChargeService.getInstance(),
    private readonly redis: RedisService = RedisService.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
    private readonly relayPoolResolver: RelayPoolResolverService = RelayPoolResolverService.getInstance(),
    private readonly relayChannelHealthService: RelayChannelHealthService = RelayChannelHealthService.getInstance(),
    private readonly relayChannelProbeLockService: RelayChannelProbeLockService = RelayChannelProbeLockService.getInstance(),
  ) {}

  static getInstance(): RelayProxyService {
    if (!RelayProxyService.instance) RelayProxyService.instance = new RelayProxyService();

    return RelayProxyService.instance;
  }

  private async recordFailedAttempt(params: {
    relayToken: RelayToken;
    selectedModelName: string;
    selectedRateConfig: SelectedRateConfig | null;
    req: any;
    path: string;
    statusCode: number;
    startTime: number;
    firstByteTime: number | null;
    isStreaming: boolean;
    executionChannelId: string | null;
    displayChannelId: string | null;
    displayChannelName: string | null;
    channelMultiplier: number;
    relayGlobalMultiplier: number;
    timeMultiplier?: number;
    originalModel?: string;
  }): Promise<void> {
    const {
      relayToken,
      selectedModelName,
      selectedRateConfig,
      req,
      path,
      statusCode,
      startTime,
      firstByteTime,
      isStreaming,
      executionChannelId,
      displayChannelId,
      displayChannelName,
      channelMultiplier,
      relayGlobalMultiplier,
      originalModel,
    } = params;

    const isPerRequestPricing = this.isPerRequestPricingConfig(selectedRateConfig);
    const modelMult =
      selectedRateConfig && typeof selectedRateConfig === "object" && selectedRateConfig.multiplier != null
        ? Number(selectedRateConfig.multiplier)
        : 1;
    const cacheCreationMult =
      selectedRateConfig?.cacheCreationMultiplier != null
        ? Number(selectedRateConfig.cacheCreationMultiplier)
        : DEFAULT_CACHE_CREATION_MULTIPLIER;
    const cacheReadMult =
      selectedRateConfig?.cacheReadMultiplier != null
        ? Number(selectedRateConfig.cacheReadMultiplier)
        : DEFAULT_CACHE_READ_MULTIPLIER;

    await this.relayProxyRepository.recordUsageWithZeroChargeTransaction({
      userId: relayToken.userId,
      relayTokenId: relayToken.id,
      requestId: this.getLogicalRequestId(req),
      requestTokens: 0,
      responseTokens: 0,
      totalTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      path,
      method: req.method,
      statusCode,
      ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
      totalOutputTime: startTime ? Date.now() - startTime : 0,
      timeToFirstByte: firstByteTime ? firstByteTime - startTime : null,
      isStreaming,
      modelName: selectedModelName,
      inputRate: isPerRequestPricing ? 0 : Number(selectedRateConfig?.input || 0),
      outputRate: isPerRequestPricing ? 0 : Number(selectedRateConfig?.output || 0),
      multiplier: modelMult,
      cacheCreationMultiplier: cacheCreationMult,
      cacheReadMultiplier: cacheReadMult,
      executionChannelId,
      displayChannelId,
      displayChannelName,
      channelMultiplier,
      globalMultiplier: relayGlobalMultiplier,
      timeMultiplier: params.timeMultiplier,
      pricingType: selectedRateConfig?.pricingType,
      fixedPrice: selectedRateConfig?.fixedPrice,
      originalModel,
    });
  }

  private isStreamRequest(body: any, req?: any): boolean {
    // OpenAI/Anthropic: check stream parameter in body
    if (body?.stream === true) return true;

    // Gemini: check if URL contains streamGenerateContent
    if (req?.path?.includes("streamGenerateContent")) return true;

    return false;
  }

  private truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}…`;
  }

  private extractTextPreview(value: unknown): string[] {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    }

    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (const item of value) parts.push(...this.extractTextPreview(item));
      return parts;
    }

    if (!value || typeof value !== "object") return [];

    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.text === "string") parts.push(record.text);
    if (typeof record.input_text === "string") parts.push(record.input_text);
    if (typeof record.content === "string") parts.push(record.content);
    if (Array.isArray(record.content)) parts.push(...this.extractTextPreview(record.content));
    if (Array.isArray(record.parts)) parts.push(...this.extractTextPreview(record.parts));
    return parts.map((item) => item.trim()).filter(Boolean);
  }

  private extractPromptPreview(req: any, requestFormat: "openai" | "anthropic" | "gemini"): string | null {
    const body = req?.body;
    if (!body || Buffer.isBuffer(body)) return null;

    const chunks: string[] = [];

    if (requestFormat === "openai") {
      if (Array.isArray(body.messages))
        for (const message of body.messages) {
          if (message?.role !== "user") continue;
          chunks.push(...this.extractTextPreview(message.content));
        }

      if (typeof body.input === "string") chunks.push(body.input);
      else if (Array.isArray(body.input)) chunks.push(...this.extractTextPreview(body.input));
    } else if (requestFormat === "anthropic") {
      if (Array.isArray(body.messages))
        for (const message of body.messages) {
          if (message?.role !== "user") continue;
          chunks.push(...this.extractTextPreview(message.content));
        }
    } else if (Array.isArray(body.contents))
      for (const content of body.contents) {
        if (content?.role && content.role !== "user") continue;
        chunks.push(...this.extractTextPreview(content?.parts));
      }

    const joined = chunks
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" | ");

    if (!joined) return null;
    return this.truncateText(joined, RELAY_PROXY_PROMPT_PREVIEW_MAX_LENGTH);
  }

  private buildRelayBusinessLogDescription(modelId: string, requestFormat: string, path: string): string {
    const raw = `AI中转请求 model=${modelId} format=${requestFormat} path=${path}`;
    return this.truncateText(raw, RELAY_PROXY_DESCRIPTION_MAX_LENGTH);
  }

  private async logRelayBusinessOperation(params: {
    relayToken: RelayTokenWithChannel;
    req: any;
    requestFormat: "openai" | "anthropic" | "gemini";
    selectedModelName: string;
    selectedModelId: string;
    channelId?: string | null;
    channelName?: string | null;
    success: boolean;
    statusCode?: number;
    errorMessage?: string;
    originalModelName?: string;
  }): Promise<void> {
    const context = buildBusinessLogRequestContext(params.req);
    const promptPreview = this.extractPromptPreview(params.req, params.requestFormat);

    await this.businessLogService.logOperation({
      operationType: params.success
        ? OperationType.RELAY_PROXY_REQUEST_SUCCESS
        : OperationType.RELAY_PROXY_REQUEST_FAILED,
      operationCategory: OperationCategory.RELAY,
      actorUserId: params.relayToken.userId,
      targetResourceType: "RELAY_TOKEN",
      targetResourceId: params.relayToken.id,
      description: this.buildRelayBusinessLogDescription(
        params.selectedModelId,
        params.requestFormat,
        params.req?.path || "unknown",
      ),
      success: params.success,
      errorMessage: params.errorMessage,
      metadata: maskSensitiveData({
        requestFormat: params.requestFormat,
        method: params.req?.method,
        path: params.req?.path,
        modelName: params.selectedModelName,
        modelId: params.selectedModelId,
        channelId: params.channelId || null,
        channelName: params.channelName || null,
        statusCode: params.statusCode,
        promptPreview,
        originalModelName: params.originalModelName,
      }),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
    });
  }

  /** Returns true when the rate config uses a flat per-request fee rather than token-based billing. */
  private isPerRequestPricingConfig(rateConfig: any): boolean {
    return rateConfig != null && typeof rateConfig === "object" && rateConfig.pricingType === "per-request";
  }

  private isMultipartRequest(req: any): boolean {
    const contentType = String(req.headers?.["content-type"] || req.headers?.["Content-Type"] || "");
    return contentType.toLowerCase().startsWith("multipart/form-data");
  }

  private extractRequestedModelFromMultipartBody(req: any): string | null {
    if (!Buffer.isBuffer(req.body)) return null;

    const bodyText = req.body.toString("utf8");
    const match = bodyText.match(/name="model"\r\n\r\n([^\r\n]+)/i);
    return match?.[1]?.trim() || null;
  }

  private extractRequestedModel(req: any, requestFormat: "openai" | "anthropic" | "gemini"): string | null {
    if (typeof req.body?.model === "string") return req.body.model;

    if (requestFormat === "openai" && this.isMultipartRequest(req))
      return this.extractRequestedModelFromMultipartBody(req);

    if (requestFormat === "gemini") {
      // Extract model from Gemini URL path: /v1beta/models/gemini-pro:generateContent or /v1beta/models/gemini-pro/generateContent
      const fullPath = req.originalUrl || req.url || req.path;
      const colonMatch = fullPath.match(/\/models\/([^/:]+):/);
      const slashMatch = fullPath.match(/\/models\/([^/]+)\//);
      const requestedModel = colonMatch ? colonMatch[1] : slashMatch ? slashMatch[1] : null;

      logger.debug("Gemini model extraction", {
        path: req.path,
        originalUrl: req.originalUrl,
        url: req.url,
        fullPath,
        colonMatch: colonMatch?.[1],
        slashMatch: slashMatch?.[1],
        extractedModel: requestedModel,
      });

      return requestedModel;
    }

    return null;
  }

  private isOpenAIFormat(req: any): boolean {
    const path = req.path;
    // 检查固定路径
    if (OPENAI_PATHS.some((p) => path.startsWith(p))) return true;

    // 检查任意版本号的路径 (如 /relay/proxy/v4/chat/completions)
    if (path.startsWith(PREFIX)) {
      const pathAfterPrefix = path.substring(PREFIX.length);
      // 匹配 /v*/chat/completions、/v*/responses、/v*/images/generations、/v*/images/edits 或 /v*/images/variations
      // 同时支持常见的拼写错误：image/generation (单数)
      return /^\/v\d+(?:beta)?\/(chat\/completions|responses|images?\/(generations?|edits?|variations?))/.test(
        pathAfterPrefix,
      );
    }

    return false;
  }

  private isGeminiFormat(req: any): boolean {
    return (
      req.path.includes("/models/") &&
      (req.path.includes("generateContent") || req.path.includes("streamGenerateContent"))
    );
  }

  private isAnthropicFormat(req: any): boolean {
    const path = req.path;
    // 检查固定路径
    if (ANTHROPIC_PATHS.some((p) => path.startsWith(p))) return true;

    // 检查任意版本号的路径 (如 /relay/proxy/v2/messages)
    if (path.startsWith(PREFIX)) {
      const pathAfterPrefix = path.substring(PREFIX.length);
      // 匹配 /v*/messages
      return /^\/v\d+(?:beta)?\/messages/.test(pathAfterPrefix);
    }

    return false;
  }

  private getRequestFormat(req: any): "openai" | "anthropic" | "gemini" {
    if (this.isGeminiFormat(req)) return "gemini";

    if (this.isOpenAIFormat(req)) return "openai";

    if (this.isAnthropicFormat(req)) return "anthropic";

    // 特殊处理：空路径或只有前缀的情况
    if (req.path === PREFIX || req.path === `${PREFIX}/`)
      throw new BadRequestError(
        `Missing API endpoint path. Please specify a valid endpoint like /relay/proxy/v1/chat/completions or /relay/proxy/v1/images/generations.`,
      );

    throw new BadRequestError(
      `Unsupported request path for format detection: ${req.path}. Only OpenAI (/chat/completions, /responses, /images/generations, /images/edits, /images/variations), Anthropic (/messages), and Gemini (/models/*:generateContent or :streamGenerateContent) are allowed.`,
    );
  }

  private resolveRequestedModelConfig(modelPricing: ModelPricingDto[], requestedModel: string): ModelPricingDto | null {
    const normalizedRequestedModel = requestedModel.trim();
    if (!normalizedRequestedModel) return null;

    // Only match by provider (model ID)
    const providerMatch = modelPricing.find((config) => {
      const provider = (config.provider || "").trim();
      return provider && provider === normalizedRequestedModel;
    });

    return providerMatch || null;
  }

  private resolveRequestedModelConfigs(modelPricing: ModelPricingDto[], requestedModel: string): ModelPricingDto[] {
    const normalizedRequestedModel = requestedModel.trim();
    if (!normalizedRequestedModel) return [];

    // Find all models matching the provider (model ID)
    return modelPricing.filter((config) => {
      const modelId = resolveModelId(config).trim();
      return modelId && modelId === normalizedRequestedModel;
    });
  }

  private resolveChannelModelConfig(
    channel: RelayChannel,
    requestedModelId: string,
    candidateConfigs: ModelPricingDto[],
  ): ModelPricingDto | null {
    const allowedModelNames = parseRelayChannelAllowedModelNames(channel);

    // null means unrestricted; an explicit empty list denies every model.
    if (allowedModelNames === null) return candidateConfigs[0] || null;

    // Find the first model config whose name is in the channel's allowedModels
    for (const config of candidateConfigs) if (isModelNameAllowed(allowedModelNames, config.model || "")) return config;

    return null;
  }

  private validateChannelModelConfig(
    channel: RelayChannel,
    modelConfig: ModelPricingDto | null,
    requestedModelId: string,
  ): void {
    if (!modelConfig) {
      const allowedModelNames = parseRelayChannelAllowedModelNames(channel);
      const allowedModelsStr =
        allowedModelNames && allowedModelNames.length > 0 ? allowedModelNames.join(", ") : "none";
      throw new RelayChannelSkipError(
        `Channel does not support model ${requestedModelId}. Allowed models: ${allowedModelsStr}`,
        "channel-model-not-allowed",
      );
    }
  }

  private resolveChannelUpstreamConfig(
    channel: RelayChannel,
    requestFormat: "openai" | "anthropic" | "gemini",
  ): {
    upstreamUrl: string;
    upstreamApiKey: string;
    channelMultiplier: number;
  } {
    const effectiveConfig = {
      openaiUpstreamUrl: channel.openaiUpstreamUrl || undefined,
      openaiUpstreamApiKey: channel.openaiUpstreamApiKey || undefined,
      anthropicUpstreamUrl: channel.anthropicUpstreamUrl || undefined,
      anthropicUpstreamApiKey: channel.anthropicUpstreamApiKey || undefined,
      geminiUpstreamUrl: channel.geminiUpstreamUrl || undefined,
      geminiUpstreamApiKey: channel.geminiUpstreamApiKey || undefined,
      channelMultiplier: Number(channel.multiplier),
    };

    if (requestFormat === "openai") {
      if (!effectiveConfig.openaiUpstreamUrl)
        throw new RelayChannelSkipError("Channel does not have OpenAI upstream configured", "channel-upstream-missing");
      if (!effectiveConfig.openaiUpstreamApiKey)
        throw new RelayChannelSkipError("Channel does not have OpenAI API key configured", "channel-upstream-missing");

      return {
        upstreamUrl: effectiveConfig.openaiUpstreamUrl,
        upstreamApiKey: effectiveConfig.openaiUpstreamApiKey,
        channelMultiplier: effectiveConfig.channelMultiplier,
      };
    }

    if (requestFormat === "anthropic") {
      if (!effectiveConfig.anthropicUpstreamUrl)
        throw new RelayChannelSkipError(
          "Channel does not have Anthropic upstream configured",
          "channel-upstream-missing",
        );
      if (!effectiveConfig.anthropicUpstreamApiKey)
        throw new RelayChannelSkipError(
          "Channel does not have Anthropic API key configured",
          "channel-upstream-missing",
        );

      return {
        upstreamUrl: effectiveConfig.anthropicUpstreamUrl,
        upstreamApiKey: effectiveConfig.anthropicUpstreamApiKey,
        channelMultiplier: effectiveConfig.channelMultiplier,
      };
    }

    if (!effectiveConfig.geminiUpstreamUrl)
      throw new RelayChannelSkipError("Channel does not have Gemini upstream configured", "channel-upstream-missing");
    if (!effectiveConfig.geminiUpstreamApiKey)
      throw new RelayChannelSkipError("Channel does not have Gemini API key configured", "channel-upstream-missing");

    return {
      upstreamUrl: effectiveConfig.geminiUpstreamUrl,
      upstreamApiKey: effectiveConfig.geminiUpstreamApiKey,
      channelMultiplier: effectiveConfig.channelMultiplier,
    };
  }

  private isFallbackEligibleLocalError(error: unknown): error is RelayChannelSkipError {
    return error instanceof RelayChannelSkipError && error.reason !== "insufficient-balance";
  }

  private appendAttemptIssue(
    issues: RelayAttemptIssue[],
    displayChannel: RelayChannel,
    attemptNumber: number,
    reason: string,
    statusCode?: number,
  ): void {
    issues.push({
      channelName: displayChannel.name || "configured channel",
      attemptNumber,
      reason,
      statusCode,
    });
  }

  private buildAttemptExhaustedError(
    requestedModel: string,
    maxRetries: number,
    issues: RelayAttemptIssue[],
    lastError?: unknown,
  ): BadRequestError {
    const issueSummary = issues
      .map((issue) => `#${issue.attemptNumber} ${issue.channelName}: ${issue.reason}`)
      .join("; ");

    const fallbackMessage = lastError instanceof Error ? lastError.message : "No available relay channel";
    const detail = issueSummary ? ` Attempt summary: ${issueSummary}` : ` Last error: ${fallbackMessage}`;

    return new BadRequestError(`Model ${requestedModel} could not be routed within maxRetries=${maxRetries}.${detail}`);
  }

  private normalizeRelayTokenQuotaUnit(value?: string | null): "amount" | "request" | "token" {
    if (value === "request" || value === "token") return value;
    return "amount";
  }

  private getRelayTokenWindowConsumed(
    summary:
      | {
          requestCount: number;
          totalTokens: number;
          chargedAmount: number;
          coveredAmount: number;
        }
      | undefined,
    unit: "amount" | "request" | "token",
  ): number {
    if (!summary) return 0;
    if (unit === "request") return summary.requestCount;
    if (unit === "token") return summary.totalTokens;
    return round4(summary.chargedAmount + summary.coveredAmount);
  }

  private formatRelayTokenQuotaWindowHours(hours: number): string {
    if (hours <= 0) return "0m";

    const totalMinutes = Math.round(hours * 60);
    const minutesPerMonth = 30 * 24 * 60;
    const minutesPerDay = 24 * 60;
    const months = Math.floor(totalMinutes / minutesPerMonth);
    const afterMonths = totalMinutes % minutesPerMonth;
    const days = Math.floor(afterMonths / minutesPerDay);
    const afterDays = afterMonths % minutesPerDay;
    const wholeHours = Math.floor(afterDays / 60);
    const minutes = afterDays % 60;

    const parts = [
      months > 0 ? `${months}mo` : null,
      days > 0 ? `${days}d` : null,
      wholeHours > 0 ? `${wholeHours}h` : null,
      minutes > 0 ? `${minutes}m` : null,
    ].filter(Boolean);

    return parts.length ? parts.join(" ") : "0m";
  }

  private formatRelayTokenQuotaValue(value: number, unit: "amount" | "request" | "token"): string {
    if (unit === "amount") return `${round4(value)}`;
    return `${Math.max(0, Math.floor(value))}`;
  }

  private isRelayTokenQuotaExceeded(consumed: number, limit: number, unit: "amount" | "request" | "token"): boolean {
    if (unit === "amount") return round4(consumed) + RELAY_TOKEN_QUOTA_COMPARE_EPSILON >= round4(limit);
    return consumed >= Math.floor(limit);
  }

  private async assertRelayTokenQuotaAvailable(relayToken: RelayTokenWithChannel): Promise<void> {
    const lifetimeQuotaLimit = relayToken.quotaLimit == null ? null : Number(relayToken.quotaLimit);
    const usedQuota = Number(relayToken.usedQuota || 0);

    if (lifetimeQuotaLimit != null && usedQuota + RELAY_TOKEN_QUOTA_COMPARE_EPSILON >= lifetimeQuotaLimit)
      throw new TooManyRequestsError(
        `Relay token lifetime quota exceeded (${this.formatRelayTokenQuotaValue(usedQuota, "amount")}/${this.formatRelayTokenQuotaValue(lifetimeQuotaLimit, "amount")})`,
      );

    const quotaWindows = relayToken.quotaWindows || [];
    if (quotaWindows.length === 0) return;

    const now = new Date();
    const uniqueWindowHours = [
      ...new Set(quotaWindows.map((quotaWindow) => Number(quotaWindow.quotaWindowHours))),
    ].filter((hours) => Number.isFinite(hours) && hours > 0);

    if (uniqueWindowHours.length === 0) return;

    const aggregateEntries = await Promise.all(
      uniqueWindowHours.map(async (windowHours) => {
        const startDate = new Date(now.getTime() - windowHours * MONTHLY_PASS_QUOTA_WINDOW_MS);
        const [summary] = await this.relayUsageRepo.aggregateByRelayTokenIds([relayToken.id], startDate, now);
        return [windowHours, summary] as const;
      }),
    );

    const summaryByWindowHours = new Map(aggregateEntries);

    for (const quotaWindow of quotaWindows) {
      const quotaUnit = this.normalizeRelayTokenQuotaUnit(quotaWindow.quotaUnit);
      const quotaLimit = Number(quotaWindow.quotaLimit);
      const quotaWindowHours = Number(quotaWindow.quotaWindowHours);
      const summary = summaryByWindowHours.get(quotaWindowHours);
      const consumed = this.getRelayTokenWindowConsumed(summary, quotaUnit);

      if (!this.isRelayTokenQuotaExceeded(consumed, quotaLimit, quotaUnit)) continue;

      throw new TooManyRequestsError(
        `Relay token ${quotaUnit} quota exceeded in ${this.formatRelayTokenQuotaWindowHours(quotaWindowHours)} window (${this.formatRelayTokenQuotaValue(consumed, quotaUnit)}/${this.formatRelayTokenQuotaValue(quotaLimit, quotaUnit)})`,
      );
    }
  }

  async getAvailableModelsForToken(
    relayToken: RelayTokenAvailabilityInput,
    requestFormat: "openai" | "anthropic" | "gemini",
  ): Promise<string[]> {
    const modelPricing = await this.modelPricingService.getModelPricing();
    const attemptPlan = await this.buildAttemptPlan(relayToken);
    const eligibleChannels = attemptPlan.channels
      .map((candidate) => candidate.resolvedChannel)
      .filter((channel) => supportsRelayRequestFormat(channel.allowedFormats, requestFormat));

    if (eligibleChannels.length === 0) {
      const allowedFormats = [
        ...new Set(
          attemptPlan.channels.flatMap((candidate) =>
            parseRelayRequestFormats(candidate.resolvedChannel.allowedFormats),
          ),
        ),
      ].join(",");
      throw new BadRequestError(
        `Channel does not support ${requestFormat} format requests. Allowed formats: ${allowedFormats || "none"}`,
      );
    }

    const tokenAllowedModelIds = parseRelayTokenAllowedModelIds(relayToken.allowedModels);
    const formatScopedModels = modelPricing.filter((model) =>
      supportsRelayRequestFormat(model.supportedFormats, requestFormat),
    );
    const modelIds = new Set<string>();

    for (const channel of eligibleChannels) {
      const channelAllowedModelNames = parseRelayChannelAllowedModelNames(channel);
      let channelScopedModels = formatScopedModels;
      if (channelAllowedModelNames != null)
        channelScopedModels = formatScopedModels.filter((model) =>
          isModelNameAllowed(channelAllowedModelNames, model.model || ""),
        );

      for (const model of channelScopedModels) {
        const modelId = resolveModelId(model);
        if (!modelId) continue;
        if (tokenAllowedModelIds.length > 0 && !isModelIdAllowed(tokenAllowedModelIds, model)) continue;
        modelIds.add(modelId);
      }

      // Include mapped model names from channel and token model mappings
      // so clients can discover models that will be mapped for billing
      const chMapping = channel.modelMapping as Record<string, string> | null | undefined;
      if (chMapping)
        for (const key of Object.keys(chMapping)) {
          // Only expose literal model names — skip wildcard patterns like "*" or "gpt-*"
          if (key && !key.includes("*") && !key.includes("?")) modelIds.add(key);
          if (chMapping[key]) modelIds.add(chMapping[key]);
        }
    }

    // Also include token-level model mapping keys/values
    const tokenMapping = relayToken.modelMapping as Record<string, string> | null | undefined;
    if (tokenMapping)
      for (const key of Object.keys(tokenMapping)) {
        // Only expose literal model names — skip wildcard patterns like "*" or "gpt-*"
        if (key && !key.includes("*") && !key.includes("?")) modelIds.add(key);
        if (tokenMapping[key]) modelIds.add(tokenMapping[key]);
      }

    return [...modelIds].sort((left, right) => left.localeCompare(right));
  }

  async getAvailableModelMapForToken(relayToken: RelayTokenAvailabilityInput): Promise<{
    openai: string[];
    anthropic: string[];
    gemini: string[];
  }> {
    const getModels = async (requestFormat: "openai" | "anthropic" | "gemini") => {
      try {
        return await this.getAvailableModelsForToken(relayToken, requestFormat);
      } catch (error) {
        if (error instanceof BadRequestError) return [];
        throw error;
      }
    };

    const [openai, anthropic, gemini] = await Promise.all([
      getModels("openai"),
      getModels("anthropic"),
      getModels("gemini"),
    ]);
    return { openai, anthropic, gemini };
  }

  private rewriteGeminiModelPath(path: string, upstreamModelId: string): string {
    return path.replace(/(\/models\/)([^/:]+)(?=[:/])/, `$1${encodeURIComponent(upstreamModelId)}`);
  }

  private buildUpstreamPath(
    requestPath: string,
    requestFormat: "openai" | "anthropic" | "gemini",
    upstreamModelId: string,
  ): string {
    const normalizedPath = requestPath.replace(/^\/relay\/proxy/, "");
    if (requestFormat !== "gemini") return normalizedPath;
    return this.rewriteGeminiModelPath(normalizedPath, upstreamModelId);
  }

  private buildForwardBody(
    requestBody: any,
    requestFormat: "openai" | "anthropic" | "gemini",
    upstreamModelId: string,
  ): any {
    if (Buffer.isBuffer(requestBody)) return requestBody;
    if (!requestBody || typeof requestBody !== "object") return requestBody;

    const clonedBody = Array.isArray(requestBody) ? [...requestBody] : { ...requestBody };
    if (requestFormat !== "gemini" || "model" in clonedBody) clonedBody.model = upstreamModelId;
    return clonedBody;
  }

  private isOpenAIChatCompletionsPath(requestPath: string): boolean {
    const normalizedPath = requestPath.replace(/^\/relay\/proxy/, "");
    return /^\/(?:v\d+(?:beta)?\/)?chat\/completions(?:\/|$)/.test(normalizedPath);
  }

  private addOpenAIStreamUsageOption(
    requestBody: any,
    requestFormat: "openai" | "anthropic" | "gemini",
    requestPath: string,
  ): { body: any; autoInjected: boolean } {
    if (
      requestFormat !== "openai" ||
      !this.isOpenAIChatCompletionsPath(requestPath) ||
      !requestBody ||
      typeof requestBody !== "object" ||
      Buffer.isBuffer(requestBody) ||
      requestBody.stream !== true
    )
      return { body: requestBody, autoInjected: false };

    const streamOptions = requestBody.stream_options;
    if (
      streamOptions !== undefined &&
      (!streamOptions || typeof streamOptions !== "object" || Array.isArray(streamOptions))
    )
      return { body: requestBody, autoInjected: false };

    if (streamOptions && Object.prototype.hasOwnProperty.call(streamOptions, "include_usage"))
      return { body: requestBody, autoInjected: false };

    return {
      body: {
        ...requestBody,
        stream_options: { ...(streamOptions || {}), include_usage: true },
      },
      autoInjected: true,
    };
  }

  private removeAutoInjectedOpenAIStreamUsageOption(requestBody: any): any {
    const streamOptions = requestBody?.stream_options;
    if (!streamOptions || typeof streamOptions !== "object" || Array.isArray(streamOptions)) return requestBody;

    const { include_usage: _includeUsage, ...remainingStreamOptions } = streamOptions;
    const body = { ...requestBody };
    if (Object.keys(remainingStreamOptions).length === 0) delete body.stream_options;
    else body.stream_options = remainingStreamOptions;
    return body;
  }

  private static getConcurrencyKey(userId: string, scope: RelayConcurrencyScope) {
    const resourceId = scope === "image" ? GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID : userId;
    return `relay:concurrency:${scope}:${resourceId}`;
  }

  private hasNestedRecordMatch(value: unknown, matcher: (record: Record<string, any>) => boolean): boolean {
    if (Buffer.isBuffer(value)) return false;
    if (Array.isArray(value)) return value.some((item) => this.hasNestedRecordMatch(item, matcher));
    if (!value || typeof value !== "object") return false;

    const record = value as Record<string, any>;
    if (matcher(record)) return true;

    return Object.values(record).some((item) => this.hasNestedRecordMatch(item, matcher));
  }

  private hasOpenAIImagePayload(body: unknown): boolean {
    return this.hasNestedRecordMatch(body, (record) => {
      const type = String(record.type || "").trim();

      if (type === "image_url") {
        if (typeof record.image_url === "string") return record.image_url.trim().length > 0;
        if (record.image_url && typeof record.image_url === "object")
          return typeof record.image_url.url === "string" && record.image_url.url.trim().length > 0;
        return false;
      }

      if (type !== "input_image") return false;

      if (typeof record.image_url === "string") return record.image_url.trim().length > 0;
      if (record.image_url && typeof record.image_url === "object")
        return typeof record.image_url.url === "string" && record.image_url.url.trim().length > 0;

      return typeof record.file_id === "string" && record.file_id.trim().length > 0;
    });
  }

  private hasAnthropicImagePayload(body: unknown): boolean {
    return this.hasNestedRecordMatch(body, (record) => {
      if (String(record.type || "").trim() !== "image") return false;
      return !!record.source && typeof record.source === "object";
    });
  }

  private hasGeminiImagePayload(body: unknown): boolean {
    return this.hasNestedRecordMatch(body, (record) => {
      const inlineData = record.inlineData;
      if (inlineData && typeof inlineData === "object") {
        const mimeType = String((inlineData as any).mimeType || (inlineData as any).mime_type || "")
          .trim()
          .toLowerCase();
        const data = typeof (inlineData as any).data === "string" ? (inlineData as any).data.trim() : "";

        if (!data) return false;
        return mimeType ? mimeType.startsWith("image/") : true;
      }

      const fileData = record.fileData;
      if (!fileData || typeof fileData !== "object") return false;

      const mimeType = String((fileData as any).mimeType || (fileData as any).mime_type || "")
        .trim()
        .toLowerCase();
      const fileUri =
        typeof (fileData as any).fileUri === "string"
          ? (fileData as any).fileUri.trim()
          : typeof (fileData as any).file_uri === "string"
            ? (fileData as any).file_uri.trim()
            : "";

      if (!fileUri) return false;
      return mimeType ? mimeType.startsWith("image/") : true;
    });
  }

  private isImageRequest(req: any, requestFormat: "openai" | "anthropic" | "gemini"): boolean {
    const rawPath = String(req.path || req.originalUrl || req.url || "");
    if (requestFormat === "openai") {
      if (/\/images\/(generations|edits|variations)(?:$|[/?])/.test(rawPath)) return true;

      if (/\/responses(?:$|[/?])/.test(rawPath)) {
        const tools = Array.isArray(req.body?.tools) ? req.body.tools : [];
        if (
          tools.some(
            (tool: any) => tool && typeof tool === "object" && String(tool.type || "").trim() === "image_generation",
          )
        )
          return true;
      }

      return this.hasOpenAIImagePayload(req.body);
    }

    if (requestFormat === "anthropic") return this.hasAnthropicImagePayload(req.body);

    return this.hasGeminiImagePayload(req.body);
  }

  private getConcurrencyScope(isImageRequest: boolean): RelayConcurrencyScope {
    return isImageRequest ? "image" : "default";
  }

  private getConcurrencySlotTtlSeconds(isStreamRequest: boolean, streamTimeoutMs: number, nonStreamTimeoutMs: number) {
    const timeoutMs = isStreamRequest ? streamTimeoutMs : nonStreamTimeoutMs;
    return Math.max(1, Math.ceil(timeoutMs / 1000) + 5);
  }

  private getCapacityPolicy<TPolicyName extends RelayCapacityPolicyName>(
    policyName: TPolicyName,
    context: RelayCapacityPolicyContextMap[TPolicyName],
  ): RelayCapacityPolicy {
    switch (policyName) {
      case "relayUpstreamConcurrency": {
        const { userId, isImageRequest, isStreamRequest, relayConfig } =
          context as RelayCapacityPolicyContextMap["relayUpstreamConcurrency"];
        const resourceGuard = EnvSpace.relayResourceGuardConfig;
        return {
          userId,
          scope: this.getConcurrencyScope(isImageRequest),
          maxConcurrency: isImageRequest
            ? Math.min(relayConfig.maxConcurrency, resourceGuard.imageMaxConcurrency)
            : relayConfig.maxConcurrency,
          queueTimeout: isImageRequest
            ? Math.min(relayConfig.queueTimeout, resourceGuard.imageQueueTimeoutMs)
            : relayConfig.queueTimeout,
          enableQueue: relayConfig.enableQueue,
          slotTtlSeconds: this.getConcurrencySlotTtlSeconds(
            isStreamRequest,
            relayConfig.upstreamStreamTimeout,
            resourceGuard.nonStreamUpstreamTimeoutMs,
          ),
        };
      }
    }
  }

  private async acquireNamedCapacityLease<TPolicyName extends RelayCapacityPolicyName>(
    policyName: TPolicyName,
    context: RelayCapacityPolicyContextMap[TPolicyName],
  ): Promise<RelayConcurrencyLease> {
    const policy = this.getCapacityPolicy(policyName, context);
    return this.acquireConcurrencySlot(policy);
  }

  private getRelayConcurrencyStatusLimits(relayConfig: Awaited<ReturnType<RelayConfigService["getRelayConfig"]>>) {
    const resourceGuard = EnvSpace.relayResourceGuardConfig;

    return {
      maxConcurrency: relayConfig.maxConcurrency,
      effectiveImageMaxConcurrency: Math.min(relayConfig.maxConcurrency, resourceGuard.imageMaxConcurrency),
      imageMaxConcurrencyCap: resourceGuard.imageMaxConcurrency,
      enableQueue: relayConfig.enableQueue,
      queueTimeoutMs: relayConfig.queueTimeout,
      effectiveImageQueueTimeoutMs: Math.min(relayConfig.queueTimeout, resourceGuard.imageQueueTimeoutMs),
      imageQueueTimeoutMs: resourceGuard.imageQueueTimeoutMs,
      upstreamStreamTimeoutMs: relayConfig.upstreamStreamTimeout,
      nonStreamUpstreamTimeoutMs: resourceGuard.nonStreamUpstreamTimeoutMs,
    };
  }

  private async acquireConcurrencySlot(params: {
    userId: string;
    scope: RelayConcurrencyScope;
    maxConcurrency: number;
    queueTimeout: number;
    enableQueue: boolean;
    slotTtlSeconds: number;
  }): Promise<RelayConcurrencyLease> {
    const { userId, scope, maxConcurrency, queueTimeout, enableQueue, slotTtlSeconds } = params;
    const baseKey = RelayProxyService.getConcurrencyKey(userId, scope);
    const ownerToken = `${userId}:${randomUUID()}`;
    const ttlMs = slotTtlSeconds * 1000;

    if (!this.redis.isRedisAvailable())
      throw new LockBackendUnavailableError("Relay concurrency coordination backend unavailable");

    if (!enableQueue) {
      const slotKey = await this.redis.acquireSemaphoreSlot(baseKey, maxConcurrency, ownerToken, ttlMs);
      if (slotKey === null) throw new LockBackendUnavailableError("Relay concurrency coordination backend unavailable");
      if (slotKey === false) throw new TooManyRequestsError("Too many concurrent requests to upstream");

      return {
        key: baseKey,
        baseKey,
        slotKey,
        scope,
        source: "redis",
        ownerToken,
        ttlMs,
        ttlSeconds: slotTtlSeconds,
      };
    }

    const waiterTtlMs = Math.max(queueTimeout + 1000, ttlMs);
    const ticket = await this.redis.reserveSemaphoreQueueTicket(baseKey, ownerToken, waiterTtlMs);
    if (ticket === null) throw new LockBackendUnavailableError("Relay concurrency coordination backend unavailable");

    const deadline = Date.now() + queueTimeout;
    const startWaitTime = Date.now();
    let waitLogged = false;

    while (true) {
      const slotKey = await this.redis.tryAcquireQueuedSemaphoreSlot(
        baseKey,
        maxConcurrency,
        ownerToken,
        ttlMs,
        ticket,
      );
      if (slotKey === null) throw new LockBackendUnavailableError("Relay concurrency coordination backend unavailable");

      if (slotKey !== "wait" && slotKey !== "stale") {
        const waitTime = Date.now() - startWaitTime;
        if (waitTime > 1000)
          logger.info("Concurrency slot acquired after waiting", {
            userId,
            scope,
            waitTimeMs: waitTime,
            waitTimeSec: `${(waitTime / 1000).toFixed(1)}s`,
            maxConcurrency,
          });

        return {
          key: baseKey,
          baseKey,
          slotKey,
          scope,
          source: "redis",
          ownerToken,
          ttlMs,
          ttlSeconds: slotTtlSeconds,
        };
      }

      if (slotKey === "stale") throw new TooManyRequestsError("Request queue timeout waiting for upstream slot");

      // Log when request starts waiting (only once)
      if (!waitLogged) {
        logger.info("Request queued - waiting for concurrency slot", {
          userId,
          scope,
          maxConcurrency,
          queueTimeoutMs: queueTimeout,
          baseKey,
          ticket,
        });
        waitLogged = true;
      }

      if (Date.now() >= deadline) {
        const waitTime = Date.now() - startWaitTime;
        await this.redis.cancelSemaphoreQueueTicket(baseKey, ticket, ownerToken).catch(() => null);
        logger.warn("Request queue timeout", {
          userId,
          scope,
          waitTimeMs: waitTime,
          waitTimeSec: `${(waitTime / 1000).toFixed(1)}s`,
          maxConcurrency,
          baseKey,
          ticket,
        });
        throw new TooManyRequestsError("Request queue timeout waiting for upstream slot");
      }

      await new Promise((r) => setTimeout(r, CONCURRENCY_QUEUE_POLL_INTERVAL_MS));
    }
  }

  private async releaseConcurrencySlot(lease: RelayConcurrencyLease): Promise<void> {
    await this.redis.deleteIfValueMatches(lease.slotKey, lease.ownerToken);
  }

  private startConcurrencyLeaseHeartbeat(lease: RelayConcurrencyLease): () => void {
    if (lease.ttlSeconds <= 1) return () => {};

    const intervalMs = Math.max(1000, Math.floor((lease.ttlSeconds * 1000) / 3));
    let stopped = false;
    let refreshInFlight = false;

    const timer = setInterval(() => {
      if (stopped || refreshInFlight) return;
      refreshInFlight = true;

      void this.redis
        .extendIfValueMatches(lease.slotKey, lease.ownerToken, lease.ttlMs)
        .catch((error) => {
          logger.warn("Failed to refresh relay concurrency lease", {
            key: lease.slotKey,
            baseKey: lease.baseKey,
            scope: lease.scope,
            error,
          });
        })
        .finally(() => {
          refreshInFlight = false;
        });
    }, intervalMs);

    if (typeof timer.unref === "function") timer.unref();

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  private parseConcurrencyKey(
    key: string,
  ): { baseKey: string; userId: string; scope: RelayConcurrencyScope; kind: "slot" | "waiter" | "meta" } | null {
    const match = key.match(
      /^(relay:concurrency:(default|image):(.+?))(?::(slot:\d+|queue:waiter:\d+|queue:tail|queue:serving))?$/,
    );
    if (!match) return null;

    const [, baseKey, scopeRaw, resourceId, suffix] = match;
    const scope = scopeRaw as RelayConcurrencyScope;
    const userId =
      scope === "image" && resourceId === GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID
        ? GLOBAL_CONCURRENCY_STATUS_USER_ID
        : resourceId;
    const kind = suffix?.startsWith("slot:") ? "slot" : suffix?.startsWith("queue:waiter:") ? "waiter" : "meta";

    return {
      baseKey,
      userId,
      scope,
      kind,
    };
  }

  public async getConcurrencyStatus(userId?: string) {
    const relayConfig = await this.relayConfigService.getRelayConfig();
    const redisItems: Array<{
      key: string;
      userId: string;
      scope: RelayConcurrencyScope;
      source: "redis";
      activeCount: number;
      ttlSeconds: number | null;
      queueLength: number;
    }> = [];
    if (this.redis.isRedisAvailable()) {
      const slotPatterns = userId
        ? [
            `relay:concurrency:default:${userId}:slot:*`,
            `relay:concurrency:image:${GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID}:slot:*`,
          ]
        : [
            "relay:concurrency:default:*:slot:*",
            `relay:concurrency:image:${GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID}:slot:*`,
          ];
      const waiterPatterns = userId
        ? [
            `relay:concurrency:default:${userId}:queue:waiter:*`,
            `relay:concurrency:image:${GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID}:queue:waiter:*`,
          ]
        : [
            "relay:concurrency:default:*:queue:waiter:*",
            `relay:concurrency:image:${GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID}:queue:waiter:*`,
          ];
      const aggregates = new Map<
        string,
        {
          key: string;
          userId: string;
          scope: RelayConcurrencyScope;
          source: "redis";
          activeCount: number;
          ttlSeconds: number | null;
          queueLength: number;
        }
      >();

      for (const pattern of slotPatterns) {
        const keys = await this.redis.getKeysByPattern(pattern, 500);
        for (const key of keys) {
          const parsed = this.parseConcurrencyKey(key);
          if (!parsed || parsed.kind !== "slot") continue;

          const ttlSeconds = await this.redis.ttl(key);
          const entry = aggregates.get(parsed.baseKey) || {
            key: parsed.baseKey,
            userId: parsed.userId,
            scope: parsed.scope,
            source: "redis" as const,
            activeCount: 0,
            ttlSeconds: null,
            queueLength: 0,
          };

          entry.activeCount += 1;
          if (typeof ttlSeconds === "number" && ttlSeconds >= 0)
            entry.ttlSeconds = entry.ttlSeconds == null ? ttlSeconds : Math.min(entry.ttlSeconds, ttlSeconds);

          aggregates.set(parsed.baseKey, entry);
        }
      }

      for (const pattern of waiterPatterns) {
        const keys = await this.redis.getKeysByPattern(pattern, 500);
        for (const key of keys) {
          const parsed = this.parseConcurrencyKey(key);
          if (!parsed || parsed.kind !== "waiter") continue;

          const entry = aggregates.get(parsed.baseKey) || {
            key: parsed.baseKey,
            userId: parsed.userId,
            scope: parsed.scope,
            source: "redis" as const,
            activeCount: 0,
            ttlSeconds: null,
            queueLength: 0,
          };

          entry.queueLength += 1;
          aggregates.set(parsed.baseKey, entry);
        }
      }

      redisItems.push(...aggregates.values());
    }

    const items = [...redisItems].sort((a, b) => {
      if (a.userId !== b.userId) return a.userId.localeCompare(b.userId);
      if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
      return a.source.localeCompare(b.source);
    });

    const totals = items.reduce(
      (acc, item) => {
        acc.activeCount += item.activeCount;
        acc.queuedCount += item.queueLength;
        if (item.scope === "image") acc.imageScopeActiveCount += item.activeCount;
        else acc.defaultScopeActiveCount += item.activeCount;
        if (item.userId !== GLOBAL_CONCURRENCY_STATUS_USER_ID) acc.userIds.add(item.userId);
        return acc;
      },
      {
        activeCount: 0,
        defaultScopeActiveCount: 0,
        imageScopeActiveCount: 0,
        queuedCount: 0,
        userIds: new Set<string>(),
      },
    );

    return {
      redisAvailable: this.redis.isRedisAvailable(),
      userId,
      limits: this.getRelayConcurrencyStatusLimits(relayConfig),
      totals: {
        activeCount: totals.activeCount,
        defaultScopeActiveCount: totals.defaultScopeActiveCount,
        imageScopeActiveCount: totals.imageScopeActiveCount,
        queuedCount: totals.queuedCount,
        userCount: totals.userIds.size,
      },
      items,
    };
  }

  private getChannelRoutingConfig(channel: RelayChannel): RelayChannelRoutingConfigDto | null {
    const routingConfig = channel.routingConfig as RelayChannelRoutingConfigDto | null | undefined;
    return routingConfig ?? null;
  }

  private getFailoverRuntimeConfig(relayToken: RelayTokenAvailabilityInput): RelayFailoverRuntimeConfig {
    const retryStatusCodes = normalizeRetryStatusRules(
      Array.isArray(relayToken.failoverConfig?.retryStatusCodes) ? relayToken.failoverConfig.retryStatusCodes : [],
    );
    return {
      enabled: Boolean(relayToken.failoverConfig?.enabled),
      maxRetries: Math.max(0, Number(relayToken.failoverConfig?.maxRetries ?? 0)),
      retryStatusCodes,
      failoverThreshold: Math.max(0, Number(relayToken.failoverConfig?.failoverThreshold ?? 0)) + 1,
      failbackCooldownMinutes: Math.max(0, Number(relayToken.failoverConfig?.failbackCooldownMinutes ?? 0)),
    };
  }

  private getPoolRoundRobinKey(channel: RelayChannel): string {
    return `relay:pool:round-robin:${channel.id}`;
  }

  private rotateItems<T>(items: T[], offset: number): T[] {
    if (items.length <= 1) return items;
    const normalizedOffset = ((offset % items.length) + items.length) % items.length;
    if (normalizedOffset === 0) return items;
    return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
  }

  private shuffleItems<T>(items: T[]): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  private weightedShuffleMembers<T extends { weight?: unknown | null }>(items: T[]): T[] {
    const remaining = [...items];
    const ordered: T[] = [];

    while (remaining.length > 0) {
      const totalWeight = remaining.reduce((sum, item) => {
        const weight = Number(item.weight ?? 1);
        return sum + (Number.isFinite(weight) && weight > 0 ? weight : 1);
      }, 0);

      let cursor = Math.random() * (totalWeight > 0 ? totalWeight : remaining.length);
      let selectedIndex = 0;

      for (let index = 0; index < remaining.length; index += 1) {
        const weight = Number(remaining[index]?.weight ?? 1);
        cursor -= Number.isFinite(weight) && weight > 0 ? weight : 1;
        if (cursor <= 0) {
          selectedIndex = index;
          break;
        }
      }

      ordered.push(remaining.splice(selectedIndex, 1)[0]);
    }

    return ordered;
  }

  private getTopLevelAttemptChannels(relayToken: RelayTokenAvailabilityInput): RelayChannelWithPool[] {
    if (relayToken.routingMode === "automatic-pool") {
      const channel = relayToken.automaticProxyPoolChannel;
      return channel?.status === RELAY_CHANNEL_STATUS.ENABLED ? [channel as RelayChannelWithPool] : [];
    }
    const candidates = relayToken.channelConfigs?.length
      ? relayToken.channelConfigs.map((config) => config.channel).filter(Boolean)
      : relayToken.channel
        ? [relayToken.channel]
        : [];

    const seen = new Set<string>();
    return candidates.filter((channel): channel is RelayChannelWithPool => {
      if (!channel?.id || seen.has(channel.id)) return false;
      seen.add(channel.id);
      return channel.status === RELAY_CHANNEL_STATUS.ENABLED && channel.channelType !== "automatic-proxy-pool";
    });
  }

  private async orderPooledMemberChannels(
    channel: RelayChannel,
    poolMembers: RelayPoolMemberGraph[],
  ): Promise<RelayPoolMemberGraph[]> {
    const strategy = (channel.routingStrategy || "priority") as RelayChannelRoutingStrategy;
    const routingConfig = this.getChannelRoutingConfig(channel);
    const orderedPoolMembers = [...poolMembers].sort((left, right) => left.priority - right.priority);

    if (orderedPoolMembers.length === 0) return [];

    let orderedMembers = orderedPoolMembers;
    if (channel.channelType === "automatic-proxy-pool") {
      const rankingMode = routingConfig?.rankingMode === "stability-first" ? "stability-first" : "price-first";
      const ranked = await this.relayChannelHealthService.rankMembers(
        orderedPoolMembers.map((member) => ({
          id: member.memberChannelId,
          name: member.memberChannel?.name ?? member.memberChannelId,
          enabled: member.enabled && member.memberChannel?.status === RELAY_CHANNEL_STATUS.ENABLED,
          priority: member.priority,
          weight: Number(member.weight),
          effectivePrice:
            Number(member.memberChannel?.multiplier ?? 1) *
            computeMultiplierForTime(
              ((member.memberChannel as RelayChannel & { timePeriodMultipliers?: TimePeriodRule[] })
                ?.timePeriodMultipliers ?? []) as TimePeriodRule[],
              new Date(),
            ),
          healthTrackingMode:
            ((member.memberChannel?.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
              ?.healthTrackingMode as "automatic" | "manual" | "disabled" | undefined) ?? "automatic",
          manualAvailability: (member.memberChannel?.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
            ?.manualAvailability,
          manualLatencyMs: (member.memberChannel?.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
            ?.manualLatencyMs,
        })),
        rankingMode,
      );
      const byId = new Map(ranked.map((member, index) => [member.id, { index, member }]));
      orderedMembers = [...orderedPoolMembers].sort((left, right) => {
        const leftRank = byId.get(left.memberChannelId)?.index ?? Number.MAX_SAFE_INTEGER;
        const rightRank = byId.get(right.memberChannelId)?.index ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank;
      });
    } else if (strategy === "random") orderedMembers = this.shuffleItems(orderedPoolMembers);
    else if (strategy === "weighted-random") orderedMembers = this.weightedShuffleMembers(orderedPoolMembers);
    else if (strategy === "round-robin") {
      const counter = (await this.redis.increment(this.getPoolRoundRobinKey(channel), 0, 1)) ?? 1;
      orderedMembers = this.rotateItems(orderedPoolMembers, Math.max(0, Math.floor(counter - 1)));
    }

    const rawMaxRetries = Number(routingConfig?.maxRetries);
    const maxAttempts = Number.isFinite(rawMaxRetries)
      ? Math.max(1, Math.min(orderedMembers.length, Math.floor(rawMaxRetries) + 1))
      : orderedMembers.length;

    return orderedMembers.slice(0, maxAttempts);
  }

  private getPoolFailoverRuntimeConfig(channel: RelayChannel, poolSize: number): RelayFailoverRuntimeConfig {
    const routingConfig = this.getChannelRoutingConfig(channel);
    const retryStatusCodes = normalizeRetryStatusRules(
      Array.isArray(routingConfig?.retryStatusCodes) ? routingConfig.retryStatusCodes : ["4xx", "5xx"],
    );
    const rawMaxRetries = Number(routingConfig?.maxRetries);
    const maxRetries = Number.isFinite(rawMaxRetries)
      ? Math.max(0, Math.floor(rawMaxRetries))
      : Math.max(0, poolSize - 1);

    return {
      enabled: poolSize > 1,
      maxRetries,
      retryStatusCodes,
      failoverThreshold: 1,
      failbackCooldownMinutes: Math.max(0, Number(routingConfig?.failbackCooldownMinutes ?? 0)),
    };
  }

  private async buildAttemptPlan(relayToken: RelayTokenAvailabilityInput): Promise<RelayAttemptPlan> {
    const topLevelChannels = this.getTopLevelAttemptChannels(relayToken);
    const channels = await this.relayPoolResolver.resolveActiveLeafCandidates(topLevelChannels, (pool, members) =>
      this.orderPooledMemberChannels(pool, members),
    );

    const tokenFailoverConfig = this.getFailoverRuntimeConfig(relayToken);
    const singleTopLevelChannel = topLevelChannels.length === 1 ? topLevelChannels[0] : null;

    if (
      tokenFailoverConfig.enabled ||
      !singleTopLevelChannel ||
      !["pooled", "automatic-proxy-pool"].includes(singleTopLevelChannel.channelType)
    )
      return { channels, failoverConfig: tokenFailoverConfig };

    return { channels, failoverConfig: this.getPoolFailoverRuntimeConfig(singleTopLevelChannel, channels.length) };
  }

  private buildFailoverStickyChannelKey(
    relayTokenId: string,
    requestFormat: "openai" | "anthropic" | "gemini",
    requestedModel: string,
  ): string {
    const normalizedModel = encodeURIComponent(requestedModel.trim() || "_");
    return `relay:token:failover:sticky:${relayTokenId}:${requestFormat}:${normalizedModel}`;
  }

  private async clearStickyPreferredChannel(params: {
    relayTokenId: string;
    requestFormat: "openai" | "anthropic" | "gemini";
    requestedModel: string;
  }): Promise<void> {
    const stickyKey = this.buildFailoverStickyChannelKey(
      params.relayTokenId,
      params.requestFormat,
      params.requestedModel,
    );

    try {
      await this.redis.delete(stickyKey);
    } catch (error) {
      logger.warn("Failed to clear sticky relay failover channel", {
        ...params,
        stickyKey,
        error,
      });
    }
  }

  private async getStickyPreferredChannelId(params: {
    relayTokenId: string;
    requestFormat: "openai" | "anthropic" | "gemini";
    requestedModel: string;
    failbackCooldownMinutes: number;
  }): Promise<string | null> {
    if (params.failbackCooldownMinutes <= 0) return null;

    const stickyKey = this.buildFailoverStickyChannelKey(
      params.relayTokenId,
      params.requestFormat,
      params.requestedModel,
    );

    try {
      const stickyChannelId = await this.redis.get(stickyKey);
      const normalizedChannelId = String(stickyChannelId || "").trim();
      return normalizedChannelId || null;
    } catch (error) {
      logger.warn("Failed to read sticky relay failover channel", {
        ...params,
        stickyKey,
        error,
      });
      return null;
    }
  }

  private async setStickyPreferredChannel(params: {
    relayTokenId: string;
    channelId: string;
    requestFormat: "openai" | "anthropic" | "gemini";
    requestedModel: string;
    failbackCooldownMinutes: number;
  }): Promise<void> {
    const stickyKey = this.buildFailoverStickyChannelKey(
      params.relayTokenId,
      params.requestFormat,
      params.requestedModel,
    );

    try {
      if (params.failbackCooldownMinutes <= 0) {
        await this.redis.delete(stickyKey);
        return;
      }

      const ttlInSeconds = Math.max(1, Math.floor(params.failbackCooldownMinutes * 60));
      await this.redis.set(stickyKey, params.channelId, ttlInSeconds);
    } catch (error) {
      logger.warn("Failed to update sticky relay failover channel", {
        ...params,
        stickyKey,
        error,
      });
    }
  }

  private isStickyPreferredChannelEligible(params: {
    channel: RelayChannel;
    requestFormat: "openai" | "anthropic" | "gemini";
    requestedModel: string;
    candidateModelConfigs: ModelPricingDto[];
  }): boolean {
    try {
      const channelModelConfig = this.resolveChannelModelConfig(
        params.channel,
        params.requestedModel,
        params.candidateModelConfigs,
      );
      this.validateChannelModelConfig(params.channel, channelModelConfig, params.requestedModel);
      this.resolveChannelUpstreamConfig(params.channel, params.requestFormat);
      return true;
    } catch {
      return false;
    }
  }

  private async prioritizeStickyPreferredChannel(params: {
    relayToken: RelayTokenWithChannel;
    channels: RelayResolvedChannelCandidate[];
    requestFormat: "openai" | "anthropic" | "gemini";
    requestedModel: string;
    candidateModelConfigs: ModelPricingDto[];
    failbackCooldownMinutes: number;
  }): Promise<RelayResolvedChannelCandidate[]> {
    if (params.channels.length < 2 || params.failbackCooldownMinutes <= 0) return params.channels;

    const stickyChannelId = await this.getStickyPreferredChannelId({
      relayTokenId: params.relayToken.id,
      requestFormat: params.requestFormat,
      requestedModel: params.requestedModel,
      failbackCooldownMinutes: params.failbackCooldownMinutes,
    });

    if (!stickyChannelId) return params.channels;

    const stickyChannelIndex = params.channels.findIndex(
      (candidate) => candidate.resolvedChannel.id === stickyChannelId,
    );
    if (stickyChannelIndex < 0) {
      await this.clearStickyPreferredChannel({
        relayTokenId: params.relayToken.id,
        requestFormat: params.requestFormat,
        requestedModel: params.requestedModel,
      });
      return params.channels;
    }

    if (stickyChannelIndex === 0) return params.channels;

    const stickyChannel = params.channels[stickyChannelIndex];
    if (
      !this.isStickyPreferredChannelEligible({
        channel: stickyChannel.resolvedChannel,
        requestFormat: params.requestFormat,
        requestedModel: params.requestedModel,
        candidateModelConfigs: params.candidateModelConfigs,
      })
    ) {
      await this.clearStickyPreferredChannel({
        relayTokenId: params.relayToken.id,
        requestFormat: params.requestFormat,
        requestedModel: params.requestedModel,
      });
      return params.channels;
    }

    return [
      stickyChannel,
      ...params.channels.slice(0, stickyChannelIndex),
      ...params.channels.slice(stickyChannelIndex + 1),
    ];
  }

  private shouldRetryWithNextChannel(
    statusCode: number | undefined,
    failoverConfig: RelayFailoverRuntimeConfig,
    hasNextChannel: boolean,
  ): boolean {
    if (!hasNextChannel || !failoverConfig.enabled) return false;
    if (statusCode == null) return true;
    return failoverConfig.retryStatusCodes.some((rule) => matchesRetryStatusRule(statusCode, rule));
  }

  private extractUpstreamErrorMessage(responseData: any, fallbackStatus?: number): string {
    return (
      responseData?.error?.message ||
      responseData?.message ||
      (typeof responseData === "string" ? responseData : null) ||
      (fallbackStatus ? `HTTP ${fallbackStatus}` : "Upstream request failed")
    );
  }

  private async recordChannelSwitch(params: {
    relayTokenId: string;
    fromChannelId: string;
    fromDisplayChannelId?: string | null;
    fromDisplayChannelName?: string | null;
    toChannelId: string;
    toDisplayChannelId?: string | null;
    toDisplayChannelName?: string | null;
    triggerStatusCode?: number;
    triggerError?: string;
    attemptNumber: number;
    requestPath: string;
    method: string;
    modelName?: string;
    requestFormat?: "openai" | "anthropic" | "gemini";
    requestedModel?: string;
    failbackCooldownMinutes?: number;
  }): Promise<void> {
    try {
      await this.relayTokenRepo.createSwitchLog(params);
    } catch (error) {
      logger.warn("Failed to create relay channel switch log", { ...params, error });
    }

    if (!params.requestFormat || !params.requestedModel) return;

    await this.setStickyPreferredChannel({
      relayTokenId: params.relayTokenId,
      channelId: params.toChannelId,
      requestFormat: params.requestFormat,
      requestedModel: params.requestedModel,
      failbackCooldownMinutes: Math.max(0, Number(params.failbackCooldownMinutes ?? 0)),
    });
  }

  private async recordChannelAttempt(
    relayTokenId: string,
    channelId: string,
    success: boolean,
    health?: {
      request?: any;
      latencyMs?: number;
      statusCode?: number;
      attemptedUpstream?: boolean;
      channel?: RelayChannel;
    },
  ): Promise<void> {
    try {
      await this.relayTokenRepo.updateChannelConfigUsage({ relayTokenId, channelId, success });
    } catch (error) {
      logger.warn("Failed to update relay channel usage stats", { relayTokenId, channelId, success, error });
    }

    const trackingMode =
      (health?.channel?.routingConfig as RelayChannelRoutingConfigDto | null | undefined)?.healthTrackingMode ??
      "automatic";
    if (trackingMode === "automatic" && health?.attemptedUpstream !== false && health?.request) {
      void this.relayChannelHealthService
        .recordAttempt({
          channelId,
          requestId: this.getLogicalRequestId(health.request),
          success,
          latencyMs: health.latencyMs,
          statusCode: health.statusCode,
        })
        .catch((error) => logger.debug("Failed to enqueue relay channel health sample", { channelId, error }));
    }
  }

  /**
   * 判断错误是否应该触发 Failover
   * 简化逻辑：只要不是余额不足错误，所有错误都应该尝试下一个渠道
   */
  private shouldFailoverOnError(error: unknown): boolean {
    // 余额不足错误不应该 failover，因为切换渠道也会遇到同样的问题
    if (error instanceof RelayChannelSkipError && error.reason === "insufficient-balance") return false;

    // 其他所有错误都应该尝试 failover
    return true;
  }

  private sendStreamTransportError(res: any, error: unknown): void {
    if (res.headersSent || res.writableEnded) return;

    const statusCode = error instanceof GatewayTimeoutError ? 504 : 502;
    const message = error instanceof Error ? error.message : "Upstream request failed";

    res.status(statusCode).json({
      error: {
        message,
        type: "upstream_error",
        code: statusCode,
        upstream_status: statusCode,
      },
    });
  }

  private buildForwardBodyBuffer(convertedBody: any): Buffer {
    return Buffer.isBuffer(convertedBody) ? convertedBody : Buffer.from(JSON.stringify(convertedBody ?? {}));
  }

  private getHeaderValue(headers: Record<string, unknown> | undefined, headerName: string): string | undefined {
    if (!headers) return undefined;

    const directValue = headers[headerName];
    if (Array.isArray(directValue)) return directValue[0];
    if (typeof directValue === "string" && directValue) return directValue;

    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== headerName.toLowerCase()) continue;
      if (Array.isArray(value)) return value[0];
      if (typeof value === "string" && value) return value;
    }

    return undefined;
  }

  private getLogicalRequestId(req: any): string {
    if (!req || (typeof req !== "object" && typeof req !== "function")) return randomUUID();

    const requestObject = req as object;
    const existing = this.logicalRequestIds.get(requestObject);
    if (existing) return existing;

    const logicalRequestId = randomUUID();
    this.logicalRequestIds.set(requestObject, logicalRequestId);
    return logicalRequestId;
  }

  private withRequestIdHeader(req: any, headers: Record<string, unknown> = {}): Record<string, unknown> {
    const mergedHeaders = { ...headers };
    const siteRequestId = this.getHeaderValue(req?.headers, "x-request-id");
    const upstreamRequestId = this.getHeaderValue(mergedHeaders, "x-request-id");

    for (const key of Object.keys(mergedHeaders)) if (key.toLowerCase() === "x-request-id") delete mergedHeaders[key];

    if (siteRequestId) mergedHeaders["x-request-id"] = siteRequestId;
    if (upstreamRequestId && upstreamRequestId !== siteRequestId)
      mergedHeaders["x-upstream-request-id"] = upstreamRequestId;

    return mergedHeaders;
  }

  private sanitizeResponseHeaders(headers: Record<string, unknown>, options: { keepContentLength?: boolean } = {}) {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(headers || {})) {
      const normalizedKey = key.toLowerCase();
      if (HOP_BY_HOP_RESPONSE_HEADERS.has(normalizedKey)) continue;
      if (!options.keepContentLength && normalizedKey === "content-length") continue;
      sanitized[key] = value;
    }

    return sanitized;
  }

  private isJsonContentType(contentType: unknown): boolean {
    const raw = Array.isArray(contentType) ? contentType.join(";") : String(contentType || "");
    return JSON_CONTENT_TYPE_RE.test(raw);
  }

  private async readStreamBodyLimited(
    stream: Readable,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; truncated: boolean; bytesRead: number }> {
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let bufferedBytes = 0;
    let truncated = false;

    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesRead += bufferChunk.length;

      if (bufferedBytes >= maxBytes) {
        truncated = true;
        continue;
      }

      const remaining = maxBytes - bufferedBytes;
      if (bufferChunk.length > remaining) {
        chunks.push(bufferChunk.subarray(0, remaining));
        bufferedBytes += remaining;
        truncated = true;
        continue;
      }

      chunks.push(bufferChunk);
      bufferedBytes += bufferChunk.length;
    }

    return { buffer: Buffer.concat(chunks, bufferedBytes), truncated, bytesRead };
  }

  private parseBufferedUpstreamBody(body: Buffer, headers: Record<string, unknown>): any {
    if (body.length === 0) return null;

    const bodyText = body.toString("utf8");
    if (this.isJsonContentType(headers["content-type"]))
      try {
        return JSON.parse(bodyText);
      } catch {
        return bodyText;
      }

    try {
      return JSON.parse(bodyText);
    } catch {
      return bodyText;
    }
  }

  private async chargeForwardedImageUsage(params: {
    relayToken: RelayToken;
    req: any;
    convertedBody: any;
    responseBytes: number;
    statusCode: number;
    startTime: number;
    firstByteTime: number | null;
    selectedModelName: string;
    selectedModelId: string;
    selectedRateConfig: SelectedRateConfig;
    globalMultiplier: number;
    relayGlobalMultiplier: number;
    channelMultiplier: number;
    executionChannelId: string;
    displayChannelId: string;
    displayChannelName: string | null;
    channelId: string;
    monthlyPassCoverageAt: Date;
    inputTokensIncludeCacheRead: boolean;
    timeMultiplier?: number;
    originalModel?: string;
  }): Promise<void> {
    const {
      relayToken,
      req,
      convertedBody,
      responseBytes,
      statusCode,
      startTime,
      firstByteTime,
      selectedModelName,
      selectedModelId,
      selectedRateConfig,
      globalMultiplier,
      relayGlobalMultiplier,
      channelMultiplier,
      executionChannelId,
      displayChannelId,
      displayChannelName,
      channelId,
      monthlyPassCoverageAt,
      inputTokensIncludeCacheRead,
      timeMultiplier,
      originalModel,
    } = params;

    const modelMult =
      selectedRateConfig && typeof selectedRateConfig === "object" && selectedRateConfig.multiplier != null
        ? Number(selectedRateConfig.multiplier)
        : 1;
    const cacheCreationMult =
      selectedRateConfig?.cacheCreationMultiplier != null
        ? Number(selectedRateConfig.cacheCreationMultiplier)
        : DEFAULT_CACHE_CREATION_MULTIPLIER;
    const cacheReadMult =
      selectedRateConfig?.cacheReadMultiplier != null
        ? Number(selectedRateConfig.cacheReadMultiplier)
        : DEFAULT_CACHE_READ_MULTIPLIER;

    const tokenBreakdown = this.calculateTokens(
      convertedBody,
      { __relayForwardedResponseByteLength: responseBytes },
      inputTokensIncludeCacheRead,
    );

    const costResult = this.calculateCost(
      tokenBreakdown.requestTokens,
      tokenBreakdown.responseTokens,
      tokenBreakdown.totalTokens,
      selectedRateConfig,
      globalMultiplier,
      tokenBreakdown.cacheCreationTokens,
      tokenBreakdown.cacheReadTokens,
      cacheCreationMult,
      cacheReadMult,
    );

    const finalizeResult = await this.usageChargeService.chargeUsage({
      userId: relayToken.userId,
      relayTokenId: relayToken.id,
      requestId: this.getLogicalRequestId(req),
      requestTokens: tokenBreakdown.requestTokens,
      responseTokens: tokenBreakdown.responseTokens,
      totalTokens: tokenBreakdown.totalTokens,
      cacheCreationTokens: tokenBreakdown.cacheCreationTokens,
      cacheReadTokens: tokenBreakdown.cacheReadTokens,
      path: req.path.replace(/^\/relay\/proxy/, ""),
      method: req.method,
      statusCode,
      ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
      totalOutputTime: Date.now() - startTime,
      timeToFirstByte: firstByteTime ? firstByteTime - startTime : null,
      isStreaming: false,
      cost: costResult.cost,
      modelName: selectedModelName,
      modelId: selectedModelId,
      channelId,
      executionChannelId,
      displayChannelId,
      displayChannelName,
      monthlyPassCoverageAt,
      inputRate: costResult.inputRate,
      outputRate: costResult.outputRate,
      multiplier: modelMult,
      cacheCreationMultiplier: cacheCreationMult,
      cacheReadMultiplier: cacheReadMult,
      channelMultiplier,
      globalMultiplier: relayGlobalMultiplier,
      timeMultiplier,
      balanceChargeMode: "allow-negative",
      pricingType: selectedRateConfig?.pricingType as "token-based" | "per-request" | undefined,
      fixedPrice: selectedRateConfig?.fixedPrice,
      originalModel,
    });

    if (!finalizeResult.applied) throw new BadRequestError("Insufficient balance for this request");
  }

  private async forwardImageRequest(
    relayToken: RelayToken,
    req: any,
    res: any,
    upstreamUrl: string,
    headers: any,
    selectedRateConfig: SelectedRateConfig,
    selectedModelName: string,
    selectedModelId: string,
    globalMultiplier: number,
    timeMultiplier: number,
    convertedBody: any,
    relayGlobalMultiplier: number,
    channelMultiplier: number,
    executionChannelId: string,
    displayChannelId: string,
    displayChannelName: string | null,
    channelId: string,
    monthlyPassCoverageAt: Date,
    timeoutMs: number,
    maxBodyBytes: number,
    allowRetryBeforeResponse: boolean,
    retryStatusCodes: string[],
    inputTokensIncludeCacheRead: boolean,
    originalRequestedModel?: string,
  ): Promise<ImageForwardResult> {
    const bodyData = this.buildForwardBodyBuffer(convertedBody);
    const cleanHeaders = { ...headers };
    delete cleanHeaders.host;
    delete cleanHeaders.Host;
    delete cleanHeaders["content-length"];
    delete cleanHeaders["Content-Length"];
    delete cleanHeaders.connection;
    delete cleanHeaders.Connection;
    delete cleanHeaders["transfer-encoding"];
    cleanHeaders["Content-Length"] = bodyData.length;

    const startTime = Date.now();
    let firstByteTime: number | null = null;
    let responseBytes = 0;
    let clientDisconnected = false;

    const response = await axios({
      method: req.method,
      url: upstreamUrl,
      headers: cleanHeaders,
      data: bodyData,
      params: req.query,
      timeout: timeoutMs,
      maxBodyLength: bodyData.length,
      maxContentLength: Infinity,
      responseType: "stream",
      validateStatus: () => true,
      httpAgent,
      httpsAgent,
    });

    const statusCode = response.status || 200;
    const upstreamHeaders = response.headers || {};
    const isErrorResponse = statusCode >= 400;
    const responseStream = response.data as Readable;

    if (isErrorResponse) {
      const { buffer, truncated } = await this.readStreamBodyLimited(responseStream, 100 * 1024);
      firstByteTime = Date.now();
      const upstreamData = this.parseBufferedUpstreamBody(buffer, upstreamHeaders);
      const upstreamMessage = this.extractUpstreamErrorMessage(upstreamData, statusCode);

      try {
        await trackErrorForIp(req, statusCode);
      } catch {
        // tracking failure must not block the response
      }

      if (allowRetryBeforeResponse && retryStatusCodes.some((rule) => matchesRetryStatusRule(statusCode, rule)))
        return {
          handled: false,
          success: false,
          retryable: true,
          statusCode,
          triggerError: truncated ? `${upstreamMessage} (error body truncated)` : upstreamMessage,
        };

      const isPerRequestPricing = this.isPerRequestPricingConfig(selectedRateConfig);
      const modelMult =
        selectedRateConfig && typeof selectedRateConfig === "object" && selectedRateConfig.multiplier != null
          ? Number(selectedRateConfig.multiplier)
          : 1;
      const cacheCreationMult =
        selectedRateConfig?.cacheCreationMultiplier != null
          ? Number(selectedRateConfig.cacheCreationMultiplier)
          : DEFAULT_CACHE_CREATION_MULTIPLIER;
      const cacheReadMult =
        selectedRateConfig?.cacheReadMultiplier != null
          ? Number(selectedRateConfig.cacheReadMultiplier)
          : DEFAULT_CACHE_READ_MULTIPLIER;

      await this.relayProxyRepository.recordUsageWithZeroChargeTransaction({
        userId: relayToken.userId,
        relayTokenId: relayToken.id,
        requestId: this.getLogicalRequestId(req),
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        path: req.path.replace(/^\/relay\/proxy/, ""),
        method: req.method,
        statusCode,
        ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
        totalOutputTime: Date.now() - startTime,
        timeToFirstByte: firstByteTime - startTime,
        isStreaming: false,
        modelName: selectedModelName,
        inputRate: isPerRequestPricing ? 0 : Number(selectedRateConfig?.input || 0),
        outputRate: isPerRequestPricing ? 0 : Number(selectedRateConfig?.output || 0),
        multiplier: modelMult,
        cacheCreationMultiplier: cacheCreationMult,
        cacheReadMultiplier: cacheReadMult,
        executionChannelId,
        displayChannelId,
        displayChannelName,
        channelMultiplier,
        globalMultiplier: relayGlobalMultiplier,
        timeMultiplier,
        pricingType: selectedRateConfig?.pricingType as "token-based" | "per-request" | undefined,
        fixedPrice: selectedRateConfig?.fixedPrice,
        originalModel: originalRequestedModel,
      });

      const data = {
        error: {
          message: `Upstream API error for model "${selectedModelName}": ${upstreamMessage}. The model may be unavailable or not supported by the upstream provider.`,
          type: "upstream_error",
          code: statusCode,
          upstream_status: statusCode,
        },
      };

      return {
        handled: true,
        success: false,
        retryable: false,
        statusCode,
        headers: this.withRequestIdHeader(req, upstreamHeaders),
        data,
      };
    }

    const responseLimit = Math.max(1, maxBodyBytes);
    const byteCounter = new Transform({
      transform(chunk, _encoding, callback) {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseBytes += bufferChunk.length;
        if (firstByteTime === null) firstByteTime = Date.now();

        if (responseBytes > responseLimit) {
          callback(new PayloadTooLargeError("Upstream image response body too large"));
          return;
        }

        callback(null, chunk);
      },
    });

    const clientCloseHandler = () => {
      clientDisconnected = true;
      if (typeof (responseStream as any).destroy === "function") (responseStream as any).destroy();
    };

    req.once("close", clientCloseHandler);
    res.writeHead(statusCode, this.withRequestIdHeader(req, this.sanitizeResponseHeaders(upstreamHeaders)));

    try {
      await pipeline(responseStream, byteCounter, res);
    } finally {
      req.off("close", clientCloseHandler);
    }

    if (!clientDisconnected)
      await this.chargeForwardedImageUsage({
        relayToken,
        req,
        convertedBody,
        responseBytes,
        statusCode,
        startTime,
        firstByteTime,
        selectedModelName,
        selectedModelId,
        selectedRateConfig,
        globalMultiplier,
        relayGlobalMultiplier,
        channelMultiplier,
        executionChannelId,
        displayChannelId,
        displayChannelName,
        channelId,
        monthlyPassCoverageAt,
        inputTokensIncludeCacheRead,
        timeMultiplier,
        originalModel: originalRequestedModel,
      });

    return { handled: true, success: true, retryable: false, statusCode, headers: {}, data: {} };
  }

  async forwardRequest(
    relayToken: RelayTokenWithChannel,
    req: any,
    res?: any,
  ): Promise<{ status: number; headers: any; data: any }> {
    const requestStartTime = Date.now();
    const requestFormat = this.getRequestFormat(req);
    const relayConfig = await this.relayConfigService.getRelayConfig();
    const resourceGuard = EnvSpace.relayResourceGuardConfig;
    const requestedModel = this.extractRequestedModel(req, requestFormat);
    if (!requestedModel) throw new BadRequestError("Model is required in request body or URL path");

    const normalizedRequestedModel = String(requestedModel).trim();
    if (!normalizedRequestedModel) throw new BadRequestError("Model is required in request body or URL path");

    // Calculate request size for logging
    const getRequestSize = () => {
      const contentLength = req.headers["content-length"];
      if (contentLength) return Number(contentLength);
      if (Buffer.isBuffer(req.body)) return req.body.length;
      if (typeof req.body === "string") return Buffer.byteLength(req.body);
      if (req.body && typeof req.body === "object")
        try {
          return Buffer.byteLength(JSON.stringify(req.body));
        } catch {
          return 0;
        }

      return 0;
    };

    const requestSizeBytes = getRequestSize();
    const requestSizeMB = (requestSizeBytes / 1024 / 1024).toFixed(2);
    const isImageRequest = this.isImageRequest(req, requestFormat);
    const attemptPlan = await this.buildAttemptPlan(relayToken);

    // Log request details (especially important for image requests)
    logger.info("Relay request received", {
      userId: relayToken.userId,
      model: normalizedRequestedModel,
      format: requestFormat,
      isImageRequest,
      requestSizeBytes,
      requestSizeMB: `${requestSizeMB}MB`,
      contentType: req.headers["content-type"],
      path: req.path,
      method: req.method,
      ip: req.ip || req.connection?.remoteAddress,
    });

    const modelPricing = await this.modelPricingService.getModelPricing();
    const failoverConfig = attemptPlan.failoverConfig;
    const isStreamRequested = this.isStreamRequest(req.body, req);
    const eligibleChannels = attemptPlan.channels.filter((candidate) =>
      supportsRelayRequestFormat(candidate.resolvedChannel.allowedFormats, requestFormat),
    );

    if (eligibleChannels.length === 0)
      throw new ForbiddenError(`No enabled relay channel supports ${requestFormat} format requests`);

    // Apply token-level model mapping for pricing resolution.
    // The requested model (e.g. "gpt-5-codex") may not exist in model_pricing,
    // but the token's mapping (e.g. "*" → "deepseek-v4-flash") tells us which
    // pricing config to use. Per-channel mapping is applied later during routing.
    const pricingModelName = resolveMappedModel(
      normalizedRequestedModel,
      null,
      relayToken.modelMapping as Record<string, string> | null | undefined,
    );

    // Find all model configs matching the resolved model ID for pricing purposes
    const candidateModelConfigs = this.resolveRequestedModelConfigs(modelPricing, pricingModelName);
    if (candidateModelConfigs.length === 0)
      throw new BadRequestError(`Model ${normalizedRequestedModel} is not configured`);

    // Use the first candidate for format check (pricing model)
    const firstModelConfig = candidateModelConfigs[0];

    // Token allowedModels check: match against BOTH original and mapped model.
    // A token might allow "gpt-5-codex" directly, or it might allow "deepseek-v4-flash"
    // (the mapped billing model). Either should pass.
    const tokenAllowedModelIds = parseRelayTokenAllowedModelIds(relayToken.allowedModels);
    if (tokenAllowedModelIds.length > 0) {
      const originalCandidateConfigs = this.resolveRequestedModelConfigs(modelPricing, normalizedRequestedModel);
      const tokenAllowsOriginal = originalCandidateConfigs.some((config) =>
        isModelIdAllowed(tokenAllowedModelIds, config),
      );
      const tokenAllowsMapped = candidateModelConfigs.some((config) => isModelIdAllowed(tokenAllowedModelIds, config));
      if (!tokenAllowsOriginal && !tokenAllowsMapped)
        throw new BadRequestError(
          `Relay token does not allow model ${normalizedRequestedModel}. Allowed models: ${tokenAllowedModelIds.join(", ")}`,
        );
    }

    if (!supportsRelayRequestFormat(firstModelConfig.supportedFormats, requestFormat))
      throw new BadRequestError(
        `Model ${normalizedRequestedModel} does not support ${requestFormat} format. Supported formats: ${
          firstModelConfig.supportedFormats || "all"
        }`,
      );

    const orderedEligibleChannels = await this.prioritizeStickyPreferredChannel({
      relayToken,
      channels: eligibleChannels,
      requestFormat,
      requestedModel: normalizedRequestedModel,
      candidateModelConfigs,
      failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes,
    });

    const maxAttempts = failoverConfig.enabled
      ? Math.max(1, Math.min(orderedEligibleChannels.length, failoverConfig.maxRetries + 1))
      : 1;
    const attemptChannels = orderedEligibleChannels.slice(0, maxAttempts);

    await this.assertRelayTokenQuotaAvailable(relayToken);

    // Remove global model config variables - they will be determined per-channel

    const concurrencyPolicy = this.getCapacityPolicy("relayUpstreamConcurrency", {
      userId: relayToken.userId,
      isImageRequest,
      isStreamRequest: isStreamRequested,
      relayConfig,
    });

    if (isImageRequest)
      logger.info("Image request concurrency guard", {
        userId: relayToken.userId,
        model: normalizedRequestedModel,
        requestSizeMB: `${requestSizeMB}MB`,
        maxConcurrency: concurrencyPolicy.maxConcurrency,
        queueTimeout: concurrencyPolicy.queueTimeout,
      });

    const concurrencyLease = await this.acquireNamedCapacityLease("relayUpstreamConcurrency", {
      userId: relayToken.userId,
      isImageRequest,
      isStreamRequest: isStreamRequested,
      relayConfig,
    });
    const stopConcurrencyLeaseHeartbeat = isStreamRequested
      ? this.startConcurrencyLeaseHeartbeat(concurrencyLease)
      : () => {};

    try {
      let lastError: unknown = new BadRequestError("No available relay channel");
      const attemptIssues: RelayAttemptIssue[] = [];
      for (let attemptIndex = 0; attemptIndex < attemptChannels.length; attemptIndex++) {
        const candidate = attemptChannels[attemptIndex];
        const nextCandidate = attemptChannels[attemptIndex + 1];
        const channel = candidate.resolvedChannel;
        // Mixed pools retain their configured logical channel in history, while
        // automatic proxy pools must attribute usage to the executing member.
        const displayChannel = relayToken.routingMode === "automatic-pool" ? channel : candidate.displayChannel;
        const nextChannel = nextCandidate?.resolvedChannel;
        const nextDisplayChannel = nextCandidate
          ? relayToken.routingMode === "automatic-pool"
            ? nextChannel
            : nextCandidate.displayChannel
          : undefined;
        const hasNextChannel = Boolean(nextCandidate);

        // Define variables that need to be accessible in catch block
        let channelMultiplier = 1;
        let relayGlobalMultiplier = relayConfig.globalMultiplier;
        let path = "";
        let selectedModelName = "";
        let selectedRateConfig: SelectedRateConfig | null = null;
        let selectedModelId = "";

        const threshold = failoverConfig.enabled ? failoverConfig.failoverThreshold : 1;
        let channelSwitched = false;

        for (let channelAttempt = 1; channelAttempt <= threshold; channelAttempt++) {
          const isLastAttemptForThisChannel = channelAttempt === threshold;
          let relayOriginalRequestedModel: string | undefined;
          let timeMultiplier = 1;
          let upstreamResponseSucceeded = false;
          let upstreamRequestStarted = false;
          let upstreamRequestStartedAt: number | null = null;

          try {
            // Resolve the model config for this specific channel
            const channelModelConfig = this.resolveChannelModelConfig(
              channel,
              normalizedRequestedModel,
              candidateModelConfigs,
            );
            this.validateChannelModelConfig(channel, channelModelConfig, normalizedRequestedModel);

            // TypeScript doesn't know that validateChannelModelConfig throws if null
            if (!channelModelConfig) {
              const allowedModelNames = parseRelayChannelAllowedModelNames(channel);
              const allowedModelsStr =
                allowedModelNames && allowedModelNames.length > 0 ? allowedModelNames.join(", ") : "none";
              throw new RelayChannelSkipError(
                `Channel does not support model ${normalizedRequestedModel}. Allowed models: ${allowedModelsStr}`,
                "channel-model-not-allowed",
              );
            }

            // Validate pricing type
            if (
              !channelModelConfig.pricingType ||
              (channelModelConfig.pricingType !== "token-based" && channelModelConfig.pricingType !== "per-request")
            )
              throw new BadRequestError(
                `Invalid pricingType '${channelModelConfig.pricingType}' for model ${channelModelConfig.model}`,
              );

            selectedRateConfig = {
              pricingType: channelModelConfig.pricingType,
              fixedPrice: channelModelConfig.fixedPrice != null ? Number(channelModelConfig.fixedPrice) : undefined,
              input: channelModelConfig.inputPrice / TOKEN_PRICE_DIVISOR,
              output: channelModelConfig.outputPrice / TOKEN_PRICE_DIVISOR,
              multiplier: 1,
              cacheCreationMultiplier: Number(channelModelConfig.cacheCreationMultiplier),
              cacheReadMultiplier: Number(channelModelConfig.cacheReadMultiplier),
            };

            selectedModelId = resolveModelId(channelModelConfig);
            if (!selectedModelId)
              throw new BadRequestError(
                `Model configuration is invalid: no upstream modelId found for '${channelModelConfig.model || "unknown"}'`,
              );

            selectedModelName = channelModelConfig.model.trim() || normalizedRequestedModel;

            // Apply model mapping: resolve effective billing model
            const effectiveModelName = resolveMappedModel(
              normalizedRequestedModel,
              channel.modelMapping as Record<string, string> | null | undefined,
              relayToken.modelMapping as Record<string, string> | null | undefined,
            );

            // If mapping resolved to a different model, re-resolve pricing config for billing
            if (effectiveModelName !== normalizedRequestedModel) {
              const mappedConfig = this.resolveRequestedModelConfig(modelPricing, effectiveModelName);
              if (mappedConfig) {
                selectedRateConfig = {
                  pricingType: mappedConfig.pricingType || "token-based",
                  fixedPrice: mappedConfig.fixedPrice != null ? Number(mappedConfig.fixedPrice) : undefined,
                  input: mappedConfig.inputPrice / TOKEN_PRICE_DIVISOR,
                  output: mappedConfig.outputPrice / TOKEN_PRICE_DIVISOR,
                  multiplier: 1,
                  cacheCreationMultiplier: Number(mappedConfig.cacheCreationMultiplier),
                  cacheReadMultiplier: Number(mappedConfig.cacheReadMultiplier),
                };
                selectedModelName = mappedConfig.model.trim() || effectiveModelName;

                // Also update upstream model ID to the mapped model's provider/model
                const mappedModelId = resolveModelId(mappedConfig);
                if (mappedModelId) selectedModelId = mappedModelId;
              }
            }

            // Track original model for billing description when model mapping is active
            relayOriginalRequestedModel =
              effectiveModelName !== normalizedRequestedModel ? normalizedRequestedModel : undefined;

            const upstreamConfig = this.resolveChannelUpstreamConfig(channel, requestFormat);
            const upstreamUrl = upstreamConfig.upstreamUrl;
            let upstreamApiKey = upstreamConfig.upstreamApiKey;
            channelMultiplier = upstreamConfig.channelMultiplier;

            if (Buffer.isBuffer(req.body) && selectedModelId !== normalizedRequestedModel)
              logger.warn("Multipart relay request keeps original model field because body rewrite is not supported", {
                requestedModel: normalizedRequestedModel,
                upstreamModelId: selectedModelId,
                path: req.path,
              });

            const monthlyPassCoverageAt = new Date();

            const hasChargeCoverage = await this.usageChargeService.hasCoverageOrPositiveBalance({
              userId: relayToken.userId,
              modelName: selectedModelName,
              channelId: channel.id,
              at: monthlyPassCoverageAt,
            });

            if (!hasChargeCoverage) throw new RelayChannelSkipError("Insufficient balance", "insufficient-balance");

            relayGlobalMultiplier = relayConfig.globalMultiplier;
            timeMultiplier = computeMultiplierForTime(
              ((channel as any).timePeriodMultipliers as TimePeriodRule[]) || [],
              new Date(),
            );
            const globalMultiplier = relayGlobalMultiplier * channelMultiplier * timeMultiplier;

            path = this.buildUpstreamPath(req.path, requestFormat, selectedModelId);
            let fullUpstreamUrl = upstreamUrl.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");

            if (requestFormat === "gemini") {
              const separator = fullUpstreamUrl.includes("?") ? "&" : "?";
              fullUpstreamUrl += `${separator}key=${upstreamApiKey}`;
            }

            const ALLOWED_HEADERS = [
              "content-type",
              "accept",
              "accept-encoding",
              "user-agent",
              "anthropic-version",
              "anthropic-beta",
              "openai-organization",
              "x-request-id",
            ];
            const headers: any = {};
            for (const key of ALLOWED_HEADERS) if (req.headers[key]) headers[key] = req.headers[key];

            if (requestFormat === "gemini") headers["x-goog-api-key"] = upstreamApiKey;
            else if (requestFormat === "openai") headers["Authorization"] = `Bearer ${upstreamApiKey}`;
            else {
              headers["x-api-key"] = upstreamApiKey;
              headers["anthropic-version"] = "2023-06-01";
            }

            const forwardedBody = this.buildForwardBody(req.body, requestFormat, selectedModelId);
            let { body: convertedBody, autoInjected: autoInjectedStreamUsageOption } = this.addOpenAIStreamUsageOption(
              forwardedBody,
              requestFormat,
              req.path,
            );

            const toolsWithCache = convertedBody?.tools?.filter((t: any) => t.cache_control).length || 0;
            const messagesWithCache = convertedBody?.messages?.filter((m: any) => m.cache_control).length || 0;
            const systemHasCache =
              convertedBody?.system && Array.isArray(convertedBody.system)
                ? convertedBody.system.some((s: any) => s.cache_control)
                : false;

            logger.debug("Request cache_control fields", {
              hasCacheControl: !!(toolsWithCache || messagesWithCache || systemHasCache),
              toolsWithCache,
              messagesWithCache,
              systemHasCache,
            });

            if (EnvSpace.isDevelopment)
              logger.debug("Final request body to upstream API", {
                body: JSON.stringify(convertedBody, null, 2),
              });

            if (isStreamRequested && res) {
              upstreamRequestStarted = true;
              upstreamRequestStartedAt = Date.now();
              const streamResult = await this.relayChannelProbeLockService.withRead(channel.id, () =>
                this.forwardStreamRequest(
                  relayToken,
                  req,
                  res,
                  fullUpstreamUrl,
                  headers,
                  selectedRateConfig,
                  selectedModelName,
                  selectedModelId,
                  globalMultiplier,
                  timeMultiplier,
                  convertedBody,
                  requestFormat,
                  relayGlobalMultiplier,
                  channelMultiplier,
                  channel.id,
                  displayChannel.id,
                  displayChannel.name || null,
                  channel.id,
                  monthlyPassCoverageAt,
                  relayConfig.upstreamStreamTimeout,
                  hasNextChannel && failoverConfig.enabled,
                  failoverConfig.retryStatusCodes,
                  channel.inputTokensIncludeCacheRead !== false,
                  relayOriginalRequestedModel,
                  autoInjectedStreamUsageOption,
                ),
              );

              if (!streamResult.handled && hasNextChannel) {
                if (!isLastAttemptForThisChannel) {
                  // Threshold not yet exhausted — retry the same channel
                  // Note: Intermediate streaming failures are not recorded in channel stats
                  // to avoid inflating failure counts. Only the final failure is recorded.
                  lastError = new Error(streamResult.triggerError || `HTTP ${streamResult.statusCode || 502}`);
                  continue;
                }
                // Threshold exhausted — record failure and switch to next channel
                await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                  channel,
                  request: req,
                  latencyMs: Date.now() - requestStartTime,
                  statusCode: streamResult.statusCode ?? (streamResult.success ? 200 : undefined),
                });
                this.appendAttemptIssue(
                  attemptIssues,
                  displayChannel,
                  attemptIndex + 1,
                  streamResult.triggerError || `HTTP ${streamResult.statusCode || 502}`,
                  streamResult.statusCode,
                );
                await this.recordChannelSwitch({
                  relayTokenId: relayToken.id,
                  fromChannelId: channel.id,
                  fromDisplayChannelId: displayChannel.id,
                  fromDisplayChannelName: displayChannel.name || null,
                  toChannelId: nextChannel!.id,
                  toDisplayChannelId: nextDisplayChannel?.id || null,
                  toDisplayChannelName: nextDisplayChannel?.name || null,
                  triggerStatusCode: streamResult.statusCode,
                  triggerError: streamResult.triggerError,
                  attemptNumber: attemptIndex + 1,
                  requestPath: req.path,
                  method: req.method,
                  modelName: selectedModelName,
                  requestFormat,
                  requestedModel: normalizedRequestedModel,
                  failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes,
                });
                channelSwitched = true;
                break;
              }

              await this.recordChannelAttempt(relayToken.id, channel.id, streamResult.success, {
                channel,
                request: req,
                latencyMs: Date.now() - requestStartTime,
                statusCode: streamResult.statusCode ?? (streamResult.success ? 200 : undefined),
              });

              return { status: streamResult.statusCode || 200, headers: {}, data: {} };
            }

            const startTime = Date.now();

            // 对图片请求使用流式响应，避免将大图片完整读入内存
            const isImageRequest = this.isImageRequest(req, requestFormat);
            if (isImageRequest && res) {
              upstreamRequestStarted = true;
              upstreamRequestStartedAt = Date.now();
              const imageResult = await this.relayChannelProbeLockService.withRead(channel.id, () =>
                this.forwardImageRequest(
                  relayToken,
                  req,
                  res,
                  fullUpstreamUrl,
                  headers,
                  selectedRateConfig!,
                  selectedModelName,
                  selectedModelId,
                  globalMultiplier,
                  timeMultiplier,
                  convertedBody,
                  relayGlobalMultiplier,
                  channelMultiplier,
                  channel.id,
                  displayChannel.id,
                  displayChannel.name || null,
                  channel.id,
                  monthlyPassCoverageAt,
                  resourceGuard.nonStreamUpstreamTimeoutMs,
                  resourceGuard.imageResponseBodyLimitMb * 1024 * 1024,
                  hasNextChannel && failoverConfig.enabled,
                  failoverConfig.retryStatusCodes,
                  channel.inputTokensIncludeCacheRead !== false,
                  relayOriginalRequestedModel,
                ),
              );

              if (!imageResult.handled && hasNextChannel) {
                if (!isLastAttemptForThisChannel) {
                  lastError = new Error(imageResult.triggerError || `HTTP ${imageResult.statusCode || 502}`);
                  continue;
                }

                this.appendAttemptIssue(
                  attemptIssues,
                  displayChannel,
                  attemptIndex + 1,
                  imageResult.triggerError || `HTTP ${imageResult.statusCode || 502}`,
                  imageResult.statusCode,
                );
                await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                  channel,
                  request: req,
                  latencyMs: Date.now() - requestStartTime,
                  statusCode: imageResult.statusCode ?? (imageResult.success ? 200 : undefined),
                });
                await this.recordChannelSwitch({
                  relayTokenId: relayToken.id,
                  fromChannelId: channel.id,
                  fromDisplayChannelId: displayChannel.id,
                  fromDisplayChannelName: displayChannel.name || null,
                  toChannelId: nextChannel!.id,
                  toDisplayChannelId: nextDisplayChannel?.id || null,
                  toDisplayChannelName: nextDisplayChannel?.name || null,
                  triggerStatusCode: imageResult.statusCode,
                  triggerError: imageResult.triggerError,
                  attemptNumber: attemptIndex + 1,
                  requestPath: req.path,
                  method: req.method,
                  modelName: selectedModelName,
                  requestFormat,
                  requestedModel: normalizedRequestedModel,
                  failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes,
                });
                channelSwitched = true;
                break;
              }

              await this.recordChannelAttempt(relayToken.id, channel.id, imageResult.success, {
                channel,
                request: req,
                latencyMs: Date.now() - requestStartTime,
                statusCode: imageResult.statusCode ?? (imageResult.success ? 200 : undefined),
              });

              return {
                status: imageResult.statusCode || 200,
                headers: imageResult.headers || {},
                data: imageResult.data || {},
              };
            }
            // maxBodyLength: multipart 用 multipartBodyLimitMb，JSON 用 5MB（与 express.json limit 一致）
            const maxBodyLimitBytes = Buffer.isBuffer(convertedBody)
              ? resourceGuard.multipartBodyLimitMb * 1024 * 1024
              : 5 * 1024 * 1024;
            upstreamRequestStarted = true;
            upstreamRequestStartedAt = Date.now();
            const response = await this.relayChannelProbeLockService.withRead(channel.id, () =>
              axios({
                method: req.method,
                url: fullUpstreamUrl,
                headers,
                data: convertedBody,
                params: req.query,
                timeout: resourceGuard.nonStreamUpstreamTimeoutMs,
                maxBodyLength: maxBodyLimitBytes,
                maxContentLength: isImageRequest
                  ? resourceGuard.imageResponseBodyLimitMb * 1024 * 1024
                  : resourceGuard.maxUpstreamResponseBodyMb * 1024 * 1024,
                validateStatus: () => true,
                httpAgent,
                httpsAgent,
              }),
            );
            const firstByteTime = Date.now();
            const isErrorResponse = response.status >= 400;

            if (isErrorResponse && this.shouldRetryWithNextChannel(response.status, failoverConfig, hasNextChannel)) {
              // Record failed attempt with correct channel info
              await this.recordFailedAttempt({
                relayToken,
                selectedModelName,
                selectedRateConfig,
                req,
                path,
                statusCode: response.status,
                startTime,
                firstByteTime,
                isStreaming: false,
                executionChannelId: channel.id,
                displayChannelId: displayChannel.id,
                displayChannelName: displayChannel.name || null,
                channelMultiplier,
                relayGlobalMultiplier,
                timeMultiplier,
                originalModel: relayOriginalRequestedModel,
              });

              if (!isLastAttemptForThisChannel) {
                // Threshold not yet exhausted — retry the same channel
                lastError = new Error(this.extractUpstreamErrorMessage(response.data, response.status));
                continue;
              }

              // Threshold exhausted — record failure and switch to next channel

              await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                channel,
                request: req,
                latencyMs: Date.now() - startTime,
                statusCode: response.status,
              });

              this.appendAttemptIssue(
                attemptIssues,
                displayChannel,
                attemptIndex + 1,
                this.extractUpstreamErrorMessage(response.data, response.status),
                response.status,
              );
              await this.recordChannelSwitch({
                relayTokenId: relayToken.id,
                fromChannelId: channel.id,
                fromDisplayChannelId: displayChannel.id,
                fromDisplayChannelName: displayChannel.name || null,
                toChannelId: nextChannel!.id,
                toDisplayChannelId: nextDisplayChannel?.id || null,
                toDisplayChannelName: nextDisplayChannel?.name || null,
                triggerStatusCode: response.status,
                triggerError: this.extractUpstreamErrorMessage(response.data, response.status),
                attemptNumber: attemptIndex + 1,
                requestPath: req.path,
                method: req.method,
                modelName: selectedModelName,
                requestFormat,
                requestedModel: normalizedRequestedModel,
                failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes,
              });
              channelSwitched = true;
              break;
            }

            const modelName = selectedModelName;
            const rateConfig = selectedRateConfig;
            const isPerRequestPricing = this.isPerRequestPricingConfig(rateConfig);
            const modelMult =
              rateConfig && typeof rateConfig === "object" && rateConfig.multiplier != null
                ? Number(rateConfig.multiplier)
                : 1;
            const cacheCreationMult =
              rateConfig?.cacheCreationMultiplier != null
                ? Number(rateConfig.cacheCreationMultiplier)
                : DEFAULT_CACHE_CREATION_MULTIPLIER;
            const cacheReadMult =
              rateConfig?.cacheReadMultiplier != null
                ? Number(rateConfig.cacheReadMultiplier)
                : DEFAULT_CACHE_READ_MULTIPLIER;
            const buildNormalizedError = () => ({
              error: {
                message: `Upstream API error for model "${normalizedRequestedModel}": ${this.extractUpstreamErrorMessage(response.data, response.status)}. The model may be unavailable or not supported by the upstream provider.`,
                type: "upstream_error",
                code: response.status,
                upstream_status: response.status,
              },
            });

            if (isErrorResponse) {
              await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                channel,
                request: req,
                latencyMs: Date.now() - startTime,
                statusCode: response.status,
              });
              await this.relayProxyRepository.recordUsageWithZeroChargeTransaction({
                userId: relayToken.userId,
                relayTokenId: relayToken.id,
                requestId: this.getLogicalRequestId(req),
                requestTokens: 0,
                responseTokens: 0,
                totalTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                path,
                method: req.method,
                statusCode: response.status,
                ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
                totalOutputTime: Date.now() - startTime,
                timeToFirstByte: firstByteTime - startTime,
                isStreaming: false,
                modelName,
                inputRate: isPerRequestPricing ? 0 : Number(rateConfig?.input || 0),
                outputRate: isPerRequestPricing ? 0 : Number(rateConfig?.output || 0),
                multiplier: modelMult,
                cacheCreationMultiplier: cacheCreationMult,
                cacheReadMultiplier: cacheReadMult,
                executionChannelId: channel.id,
                displayChannelId: displayChannel.id,
                displayChannelName: displayChannel.name || null,
                channelMultiplier,
                globalMultiplier: relayGlobalMultiplier,
                timeMultiplier,
                pricingType: rateConfig?.pricingType as "token-based" | "per-request" | undefined,
                fixedPrice: rateConfig?.fixedPrice,
              });

              const logLevel = response.status >= 500 ? "warn" : "info";
              logger[logLevel]("Upstream returned error response (not charged)", {
                model: normalizedRequestedModel,
                upstreamModel: selectedModelId,
                pricingType: isPerRequestPricing ? "per-request" : "token-based",
                statusCode: response.status,
                upstreamError: response.data,
              });

              await this.logRelayBusinessOperation({
                relayToken,
                req,
                requestFormat,
                selectedModelName: modelName,
                selectedModelId,
                channelId: channel.id,
                channelName: displayChannel.name || null,
                success: false,
                statusCode: response.status,
                errorMessage: this.extractUpstreamErrorMessage(response.data, response.status),
                originalModelName: relayOriginalRequestedModel,
              });

              return {
                status: response.status,
                headers: this.withRequestIdHeader(req, response.headers),
                data: buildNormalizedError(),
              };
            }

            upstreamResponseSucceeded = true;

            const { requestTokens, responseTokens, totalTokens, cacheCreationTokens, cacheReadTokens } =
              this.calculateTokens(convertedBody, response.data, channel.inputTokensIncludeCacheRead !== false);

            logger.info("Cache metrics", {
              cacheCreationTokens,
              cacheReadTokens,
              cacheHit: cacheReadTokens > 0,
              cacheCreated: cacheCreationTokens > 0,
              requestTokens,
              responseTokens,
              rawUsage: response.data?.usage,
            });

            const { cost, inputRate, outputRate } = this.calculateCost(
              requestTokens,
              responseTokens,
              totalTokens,
              rateConfig,
              globalMultiplier,
              cacheCreationTokens,
              cacheReadTokens,
              cacheCreationMult,
              cacheReadMult,
            );

            const totalOutputTime = Date.now() - startTime;
            const timeToFirstByte = firstByteTime - startTime;

            const finalizeResult = await this.usageChargeService.chargeUsage({
              userId: relayToken.userId,
              relayTokenId: relayToken.id,
              requestId: this.getLogicalRequestId(req),
              requestTokens,
              responseTokens,
              totalTokens,
              cacheCreationTokens,
              cacheReadTokens,
              path,
              method: req.method,
              statusCode: response.status,
              ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
              totalOutputTime,
              timeToFirstByte,
              isStreaming: false,
              cost,
              modelName,
              modelId: selectedModelId,
              channelId: channel.id,
              executionChannelId: channel.id,
              displayChannelId: displayChannel.id,
              displayChannelName: displayChannel.name || null,
              monthlyPassCoverageAt,
              inputRate,
              outputRate,
              multiplier: modelMult,
              cacheCreationMultiplier: cacheCreationMult,
              cacheReadMultiplier: cacheReadMult,
              channelMultiplier,
              globalMultiplier: relayGlobalMultiplier,
              timeMultiplier,
              balanceChargeMode: "allow-negative",
              pricingType: rateConfig?.pricingType as "token-based" | "per-request" | undefined,
              fixedPrice: rateConfig?.fixedPrice,
              originalModel: relayOriginalRequestedModel,
            });

            if (!finalizeResult.applied) throw new BadRequestError("Insufficient balance for this request");

            await this.recordChannelAttempt(relayToken.id, channel.id, true, {
              channel,
              request: req,
              latencyMs: totalOutputTime,
              statusCode: response.status,
            });

            await this.logRelayBusinessOperation({
              relayToken,
              req,
              requestFormat,
              selectedModelName: modelName,
              selectedModelId,
              channelId: channel.id,
              channelName: displayChannel.name || null,
              success: true,
              statusCode: response.status,
              originalModelName: relayOriginalRequestedModel,
            });

            return {
              status: response.status,
              headers: this.withRequestIdHeader(req, response.headers),
              data: response.data,
            };
          } catch (error) {
            lastError = error;

            const canRetryCurrentAttempt =
              !isStreamRequested || !res || (!res.headersSent && !res.writableEnded && !res.finished);

            if (hasNextChannel && canRetryCurrentAttempt && this.isFallbackEligibleLocalError(error)) {
              // Record failed attempt for local errors (e.g., model not supported by channel)
              await this.recordFailedAttempt({
                relayToken,
                selectedModelName,
                selectedRateConfig,
                req,
                path,
                statusCode: 0, // Local error, no HTTP status
                startTime: 0,
                firstByteTime: null,
                isStreaming: false,
                executionChannelId: channel.id,
                displayChannelId: displayChannel.id,
                displayChannelName: displayChannel.name || null,
                channelMultiplier,
                relayGlobalMultiplier,
                timeMultiplier,
                originalModel: relayOriginalRequestedModel,
              });

              this.appendAttemptIssue(attemptIssues, displayChannel, attemptIndex + 1, error.message);
              if (!upstreamResponseSucceeded)
                await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                  channel,
                  request: req,
                  attemptedUpstream: upstreamRequestStarted,
                  latencyMs: upstreamRequestStartedAt ? Date.now() - upstreamRequestStartedAt : undefined,
                });
              await this.recordChannelSwitch({
                relayTokenId: relayToken.id,
                fromChannelId: channel.id,
                fromDisplayChannelId: displayChannel.id,
                fromDisplayChannelName: displayChannel.name || null,
                toChannelId: nextChannel!.id,
                toDisplayChannelId: nextDisplayChannel?.id || null,
                toDisplayChannelName: nextDisplayChannel?.name || null,
                triggerError: error instanceof Error ? error.message : "Relay channel is not eligible for this request",
                attemptNumber: attemptIndex + 1,
                requestPath: req.path,
                method: req.method,
                modelName: selectedModelName,
                requestFormat,
                requestedModel: normalizedRequestedModel,
                failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes,
              });
              channelSwitched = true;
              break;
            }

            if (canRetryCurrentAttempt && this.isFallbackEligibleLocalError(error)) {
              this.appendAttemptIssue(attemptIssues, displayChannel, attemptIndex + 1, error.message);
              throw this.buildAttemptExhaustedError(
                normalizedRequestedModel,
                failoverConfig.maxRetries,
                attemptIssues,
                error,
              );
            }

            if (hasNextChannel && canRetryCurrentAttempt && this.shouldFailoverOnError(error)) {
              if (!isLastAttemptForThisChannel) {
                // Threshold not yet exhausted — retry the same channel
                lastError = error;
                continue;
              }
              // Threshold exhausted — switch to next channel
              this.appendAttemptIssue(
                attemptIssues,
                displayChannel,
                attemptIndex + 1,
                error instanceof Error ? error.message : "Upstream request failed",
              );
              if (!upstreamResponseSucceeded)
                await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                  channel,
                  request: req,
                  attemptedUpstream: upstreamRequestStarted,
                  latencyMs: upstreamRequestStartedAt ? Date.now() - upstreamRequestStartedAt : undefined,
                });
              await this.recordChannelSwitch({
                relayTokenId: relayToken.id,
                fromChannelId: channel.id,
                fromDisplayChannelId: displayChannel.id,
                fromDisplayChannelName: displayChannel.name || null,
                toChannelId: nextChannel!.id,
                toDisplayChannelId: nextDisplayChannel?.id || null,
                toDisplayChannelName: nextDisplayChannel?.name || null,
                triggerError: error instanceof Error ? error.message : "Upstream request failed",
                attemptNumber: attemptIndex + 1,
                requestPath: req.path,
                method: req.method,
                modelName: normalizedRequestedModel,
                requestFormat,
                requestedModel: normalizedRequestedModel,
                failbackCooldownMinutes: failoverConfig.failbackCooldownMinutes,
              });
              channelSwitched = true;
              break;
            }

            if (!isStreamRequested && canRetryCurrentAttempt && this.shouldFailoverOnError(error)) {
              this.appendAttemptIssue(
                attemptIssues,
                displayChannel,
                attemptIndex + 1,
                error instanceof Error ? error.message : "Upstream request failed",
              );
              if (!upstreamResponseSucceeded)
                await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                  channel,
                  request: req,
                  attemptedUpstream: upstreamRequestStarted,
                  latencyMs: upstreamRequestStartedAt ? Date.now() - upstreamRequestStartedAt : undefined,
                });
              throw this.buildAttemptExhaustedError(
                normalizedRequestedModel,
                failoverConfig.maxRetries,
                attemptIssues,
                error,
              );
            }

            if (isStreamRequested && res && this.shouldFailoverOnError(error)) {
              if (!upstreamResponseSucceeded)
                await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                  channel,
                  request: req,
                  attemptedUpstream: upstreamRequestStarted,
                  latencyMs: upstreamRequestStartedAt ? Date.now() - upstreamRequestStartedAt : undefined,
                });
              this.sendStreamTransportError(res, error);
              return { status: error instanceof GatewayTimeoutError ? 504 : 502, headers: {}, data: {} };
            }

            throw error;
          }
        } // end inner channel retry loop

        if (channelSwitched) continue;
      }

      if (attemptIssues.length > 0)
        throw this.buildAttemptExhaustedError(
          normalizedRequestedModel,
          failoverConfig.maxRetries,
          attemptIssues,
          lastError,
        );

      throw lastError;
    } finally {
      stopConcurrencyLeaseHeartbeat();
      await this.releaseConcurrencySlot(concurrencyLease);

      // Log request completion (especially important for image requests to track what caused issues)
      if (isImageRequest) {
        const duration = Date.now() - requestStartTime;
        logger.info("Image request completed", {
          userId: relayToken.userId,
          model: normalizedRequestedModel,
          requestSizeMB: `${requestSizeMB}MB`,
          durationMs: duration,
          durationSec: `${(duration / 1000).toFixed(1)}s`,
        });
      }
    }
  }

  private calculateCost(
    requestTokens: number,
    responseTokens: number,
    totalTokens: number,
    rateConfig: any,
    globalMultiplier: number,
    cacheCreationTokens: number = 0,
    cacheReadTokens: number = 0,
    cacheCreationMultiplier: number = DEFAULT_CACHE_CREATION_MULTIPLIER,
    cacheReadMultiplier: number = DEFAULT_CACHE_READ_MULTIPLIER,
  ): {
    cost: number;
    inputCost: number;
    outputCost: number;
    inputRate: number;
    outputRate: number;
    multiplier: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  } {
    // Check if this is per-request pricing
    if (this.isPerRequestPricingConfig(rateConfig)) {
      if (!rateConfig.fixedPrice) throw new Error("fixedPrice is required for per-request pricing model");

      const fixedPrice = Number(rateConfig.fixedPrice);
      const cost = Math.max(0, Math.ceil(fixedPrice * globalMultiplier * 10000) / 10000);
      return {
        cost,
        inputCost: cost,
        outputCost: 0,
        inputRate: 0,
        outputRate: 0,
        multiplier: globalMultiplier,
        cacheCreationTokens,
        cacheReadTokens,
      };
    }

    // Token-based pricing (original logic)
    if (rateConfig && typeof rateConfig === "object" && ("input" in rateConfig || "output" in rateConfig)) {
      if (rateConfig.input == null || rateConfig.output == null)
        throw new Error("input and output rates are required for token-based pricing model");

      const inputRate = Number(rateConfig.input);
      const outputRate = Number(rateConfig.output);

      // requestTokens is already processed to represent billing-ready value
      // (cache read tokens have been subtracted if inputTokensIncludeCacheRead was true)
      const inputCost =
        requestTokens * inputRate +
        cacheCreationTokens * inputRate * cacheCreationMultiplier +
        cacheReadTokens * inputRate * cacheReadMultiplier;
      const outputCost = responseTokens * outputRate;
      const rawCost = (inputCost + outputCost) * globalMultiplier;
      if (!isFinite(rawCost))
        return {
          cost: 0,
          inputCost: 0,
          outputCost: 0,
          inputRate,
          outputRate,
          multiplier: globalMultiplier,
          cacheCreationTokens,
          cacheReadTokens,
        };
      const cost = Math.max(0, Math.ceil(rawCost * 10000) / 10000);
      return {
        cost,
        inputCost,
        outputCost,
        inputRate,
        outputRate,
        multiplier: globalMultiplier,
        cacheCreationTokens,
        cacheReadTokens,
      };
    }

    const rate = Number(rateConfig) || 0.000001;
    const cost = Math.ceil((totalTokens || 0) * rate * globalMultiplier * 10000) / 10000;
    return {
      cost,
      inputCost: cost,
      outputCost: 0,
      inputRate: rate,
      outputRate: 0,
      multiplier: globalMultiplier,
      cacheCreationTokens,
      cacheReadTokens,
    };
  }

  calculateTokens(reqBody: any, resBody: any, inputTokensIncludeCacheRead: boolean = true) {
    let requestTokens = 0;
    let responseTokens = 0;

    if (reqBody)
      if (Buffer.isBuffer(reqBody)) requestTokens = Math.ceil(reqBody.length / 4);
      else {
        const reqText = JSON.stringify(reqBody);
        requestTokens = Math.ceil(reqText.length / 4);
      }

    if (resBody?.usage && typeof resBody.usage === "object") {
      const usage = extractTokenUsageMetrics(resBody.usage);
      const hasUsageTokens = usage.totalTokens > 0 || usage.inputTokens > 0 || usage.outputTokens > 0;

      if (hasUsageTokens) {
        const hasExplicitInputTokens =
          hasTokenValue(resBody.usage.prompt_tokens) || hasTokenValue(resBody.usage.input_tokens);
        // Process requestTokens to always represent billing-ready value
        const processedInputTokens = inputTokensIncludeCacheRead
          ? Math.max(0, usage.inputTokens - usage.cacheReadTokens)
          : usage.inputTokens;

        const resolvedTokens = normalizeTokenBreakdown(
          processedInputTokens,
          usage.outputTokens,
          usage.totalTokens,
          hasExplicitInputTokens ? 0 : requestTokens,
        );

        return {
          requestTokens: resolvedTokens.requestTokens,
          responseTokens: resolvedTokens.responseTokens,
          totalTokens: resolvedTokens.totalTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          cacheReadTokens: usage.cacheReadTokens,
        };
      }
    }

    // Gemini format: has usageMetadata
    if (resBody?.usageMetadata) {
      const normalizedGeminiTokens = normalizeTokenBreakdown(
        resBody.usageMetadata.promptTokenCount || 0,
        resBody.usageMetadata.candidatesTokenCount || 0,
        resBody.usageMetadata.totalTokenCount || 0,
        requestTokens,
      );

      return {
        requestTokens: normalizedGeminiTokens.requestTokens,
        responseTokens: normalizedGeminiTokens.responseTokens,
        totalTokens: normalizedGeminiTokens.totalTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
    }

    if (resBody?.__relayForwardedResponseByteLength != null)
      responseTokens = Math.ceil(Number(resBody.__relayForwardedResponseByteLength || 0) / 4);
    else if (resBody) {
      const resText = JSON.stringify(resBody);
      responseTokens = Math.ceil(resText.length / 4);
    }

    return {
      requestTokens,
      responseTokens,
      totalTokens: requestTokens + responseTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
  }

  async logUsage(relayTokenId: string, usage: any) {
    return await this.relayUsageRepo.create({ relayTokenId, ...usage });
  }

  private async forwardStreamRequest(
    relayToken: RelayToken,
    req: any,
    res: any,
    upstreamUrl: string,
    headers: any,
    selectedModelRate: any,
    selectedModelName: string,
    selectedModelId: string,
    globalMultiplier: number,
    timeMultiplier: number,
    convertedBody: any,
    requestFormat: "openai" | "anthropic" | "gemini",
    relayGlobalMultiplier: number = globalMultiplier,
    channelMultiplier: number = 1,
    executionChannelId: string,
    displayChannelId: string,
    displayChannelName: string | null,
    channelId: string,
    monthlyPassCoverageAt: Date,
    upstreamStreamTimeout: number,
    allowRetryBeforeResponse: boolean = false,
    retryStatusCodes: string[] = [],
    inputTokensIncludeCacheRead: boolean = true,
    originalRequestedModel?: string,
    autoInjectedStreamUsageOption: boolean = false,
  ): Promise<StreamForwardResult> {
    const url = new URL(upstreamUrl);
    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? https : http;

    // 序列化一次，复用同一个 Buffer（避免两次 JSON.stringify）
    const bodyData = this.buildForwardBodyBuffer(convertedBody);

    let requestTokens = Math.ceil(bodyData.length / 4);
    const estimatedRequestTokens = requestTokens;
    let responseTokens = 0;
    let totalTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let hasExplicitStreamInputTokens = false;

    const applyUsage = (usagePayload: unknown) => {
      if (!usagePayload || typeof usagePayload !== "object") return;

      const usageData = usagePayload as Record<string, unknown>;
      const usage = extractTokenUsageMetrics(usageData);
      const hasInputTokens = hasTokenValue(usageData.prompt_tokens) || hasTokenValue(usageData.input_tokens);
      const hasOutputTokens = hasTokenValue(usageData.completion_tokens) || hasTokenValue(usageData.output_tokens);

      if (usage.totalTokens > 0) totalTokens = usage.totalTokens;
      if (hasOutputTokens) responseTokens = usage.outputTokens;
      if (usage.cacheCreationTokens > 0) cacheCreationTokens = usage.cacheCreationTokens;
      if (usage.cacheReadTokens > 0) cacheReadTokens = usage.cacheReadTokens;
      if (hasInputTokens) {
        hasExplicitStreamInputTokens = true;
        requestTokens = inputTokensIncludeCacheRead
          ? Math.max(0, usage.inputTokens - usage.cacheReadTokens)
          : usage.inputTokens;
      }
    };

    const cleanHeaders = { ...headers };
    delete cleanHeaders["host"];
    delete cleanHeaders["content-length"];
    delete cleanHeaders["connection"];
    delete cleanHeaders["transfer-encoding"];
    cleanHeaders["Content-Length"] = bodyData.length;

    const startTime = Date.now();
    let firstByteTime: number | null = null;
    let streamCompleted = false; // 标记流是否正常完成
    let clientDisconnected = false; // 标记客户端是否已断开

    return new Promise((resolve, reject) => {
      let timedOut = false;
      let proxyReq: http.ClientRequest;

      proxyReq = httpModule.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: req.method,
          headers: cleanHeaders,
          timeout: upstreamStreamTimeout,
        },
        (proxyRes) => {
          const streamStatusCode = proxyRes.statusCode || 200;
          const isStreamErrorResponse = streamStatusCode >= 400;

          const responseHeaders = { ...proxyRes.headers };
          delete responseHeaders["content-length"];
          delete responseHeaders["transfer-encoding"];

          // For error responses we buffer the whole body so we can build a
          // normalized error message; we do NOT pipe chunks straight through.
          if (isStreamErrorResponse) {
            const rawChunks: Buffer[] = [];
            const MAX_ERROR_BODY_SIZE = 100 * 1024; // Limit error body to 100KB to prevent memory issues
            let totalSize = 0;
            let truncated = false;

            proxyRes.on("data", (chunk: Buffer) => {
              if (firstByteTime === null) firstByteTime = Date.now();

              // Prevent unbounded memory growth from large error responses
              if (totalSize + chunk.length > MAX_ERROR_BODY_SIZE) {
                truncated = true;
                return;
              }

              rawChunks.push(chunk);
              totalSize += chunk.length;
            });

            proxyRes.on("end", async () => {
              streamCompleted = true;

              if (autoInjectedStreamUsageOption && !res.headersSent && [400, 422].includes(streamStatusCode)) {
                const retryBody = this.removeAutoInjectedOpenAIStreamUsageOption(convertedBody);
                resolve(
                  await this.forwardStreamRequest(
                    relayToken,
                    req,
                    res,
                    upstreamUrl,
                    headers,
                    selectedModelRate,
                    selectedModelName,
                    selectedModelId,
                    globalMultiplier,
                    timeMultiplier,
                    retryBody,
                    requestFormat,
                    relayGlobalMultiplier,
                    channelMultiplier,
                    executionChannelId,
                    displayChannelId,
                    displayChannelName,
                    channelId,
                    monthlyPassCoverageAt,
                    upstreamStreamTimeout,
                    allowRetryBeforeResponse,
                    retryStatusCodes,
                    inputTokensIncludeCacheRead,
                    originalRequestedModel,
                    false,
                  ),
                );
                return;
              }

              // Error tracking
              try {
                await trackErrorForIp(req, streamStatusCode);
              } catch {
                // tracking failure must not block the response
              }

              // Parse upstream body for error message extraction
              let upstreamData: any = null;
              try {
                const bodyText = Buffer.concat(rawChunks).toString();
                upstreamData = JSON.parse(bodyText);
              } catch {
                // not JSON – leave null
              }

              const upstreamMessage =
                upstreamData?.error?.message ||
                upstreamData?.message ||
                (typeof upstreamData === "string" ? upstreamData : null) ||
                (truncated ? `HTTP ${streamStatusCode} (error body truncated)` : null);

              if (
                allowRetryBeforeResponse &&
                retryStatusCodes.some((rule) => matchesRetryStatusRule(streamStatusCode, rule))
              ) {
                resolve({
                  handled: false,
                  success: false,
                  retryable: true,
                  statusCode: streamStatusCode,
                  triggerError: upstreamMessage ?? `HTTP ${streamStatusCode}`,
                });
                return;
              }

              // Detect model name from the outer closure.
              // selectedModelName === selectedModelConfig.model.trim() || normalizedRequestedModel,
              // i.e. the same value used in the non-streaming path's buildNormalizedError().
              const normalizedError = {
                error: {
                  message: `Upstream API error for model "${selectedModelName}": ${upstreamMessage ?? `HTTP ${streamStatusCode}`}. The model may be unavailable or not supported by the upstream provider.`,
                  type: "upstream_error",
                  code: streamStatusCode,
                  upstream_status: streamStatusCode,
                },
              };

              const normalizedBody = JSON.stringify(normalizedError);
              res.writeHead(
                streamStatusCode,
                this.withRequestIdHeader(req, {
                  ...responseHeaders,
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(normalizedBody),
                }),
              );
              res.end(normalizedBody);

              // Billing
              const modelName = selectedModelName;
              const rateConfig = selectedModelRate;
              if (!rateConfig) {
                resolve({ handled: true, success: false, retryable: false, statusCode: streamStatusCode });
                return;
              }

              const logLevel = streamStatusCode >= 500 ? "warn" : "info";
              const modelMult =
                rateConfig && typeof rateConfig === "object" && rateConfig.multiplier != null
                  ? Number(rateConfig.multiplier)
                  : 1;
              const cacheCreationMult =
                rateConfig?.cacheCreationMultiplier != null
                  ? Number(rateConfig.cacheCreationMultiplier)
                  : DEFAULT_CACHE_CREATION_MULTIPLIER;
              const cacheReadMult =
                rateConfig?.cacheReadMultiplier != null
                  ? Number(rateConfig.cacheReadMultiplier)
                  : DEFAULT_CACHE_READ_MULTIPLIER;
              logger[logLevel]("Upstream returned error response (streaming, not charged)", {
                model: modelName,
                pricingType: this.isPerRequestPricingConfig(rateConfig) ? "per-request" : "token-based",
                statusCode: streamStatusCode,
              });

              await this.relayProxyRepository.recordUsageWithZeroChargeTransaction({
                userId: relayToken.userId,
                relayTokenId: relayToken.id,
                requestId: this.getLogicalRequestId(req),
                requestTokens: 0,
                responseTokens: 0,
                totalTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                path: req.path.replace(/^\/relay\/proxy/, ""),
                method: req.method,
                statusCode: streamStatusCode,
                ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
                totalOutputTime: Date.now() - startTime,
                timeToFirstByte: firstByteTime ? firstByteTime - startTime : null,
                isStreaming: true,
                modelName,
                inputRate: this.isPerRequestPricingConfig(rateConfig) ? 0 : Number(rateConfig?.input || 0),
                outputRate: this.isPerRequestPricingConfig(rateConfig) ? 0 : Number(rateConfig?.output || 0),
                multiplier: modelMult,
                cacheCreationMultiplier: cacheCreationMult,
                cacheReadMultiplier: cacheReadMult,
                executionChannelId,
                displayChannelId,
                displayChannelName,
                channelMultiplier,
                globalMultiplier: relayGlobalMultiplier,
                timeMultiplier,
                pricingType: rateConfig?.pricingType as "token-based" | "per-request" | undefined,
                fixedPrice: rateConfig?.fixedPrice,
              });

              resolve({
                handled: true,
                success: false,
                retryable: false,
                statusCode: streamStatusCode,
                triggerError: upstreamMessage ?? `HTTP ${streamStatusCode}`,
              });
            });

            proxyRes.on("error", (err) => {
              if (allowRetryBeforeResponse && !res.headersSent && this.shouldFailoverOnError(err)) {
                resolve({
                  handled: false,
                  success: false,
                  retryable: true,
                  triggerError: err instanceof Error ? err.message : "Upstream request failed",
                });
                return;
              }

              if (!res.finished) res.end();
              reject(err);
            });

            return; // <── exit the proxyRes callback; the rest handles success responses
          }

          // ── Success path (2xx/3xx): pipe chunks directly to the client ──
          res.writeHead(streamStatusCode, this.withRequestIdHeader(req, responseHeaders));

          let buffer = "";
          const MAX_BUFFER_SIZE = 256 * 1024; // Reduced to 256KB to prevent memory issues on low-memory servers

          proxyRes.on("data", (chunk) => {
            if (firstByteTime === null) firstByteTime = Date.now();

            // Direct forwarding - no format conversion
            res.write(chunk);

            // Log first chunk for debugging Gemini responses
            if (requestFormat === "gemini" && !buffer)
              logger.debug("Gemini first chunk", {
                chunk: chunk.toString().substring(0, 500),
                statusCode: proxyRes.statusCode,
                headers: proxyRes.headers,
              });

            buffer += chunk.toString();

            // Prevent buffer from growing too large
            if (buffer.length > MAX_BUFFER_SIZE) {
              logger.warn("Stream buffer exceeded limit, truncating", {
                bufferSize: buffer.length,
                limit: MAX_BUFFER_SIZE,
              });
              // Keep only the last portion of the buffer
              buffer = buffer.slice(-MAX_BUFFER_SIZE / 2);
            }

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue;

              // SSE permits optional whitespace after the field separator.
              if (trimmedLine.startsWith("data:")) {
                const data = trimmedLine.slice("data:".length).trimStart();
                if (data === "[DONE]") continue;

                try {
                  const json = JSON.parse(data);
                  // Anthropic may expose usage on message_start, message_stop, or other message events.
                  applyUsage(json.message?.usage);
                  applyUsage(json.usage);
                  applyUsage(json.response?.usage);
                } catch {
                  // Ignore JSON parse errors
                }
              }
              // Handle Gemini format: direct JSON objects separated by newlines
              else if (requestFormat === "gemini" && (trimmedLine.startsWith("{") || trimmedLine.startsWith("[")))
                try {
                  const json = JSON.parse(trimmedLine);
                  // Gemini usageMetadata format
                  if (json.usageMetadata) {
                    const u = json.usageMetadata;
                    if (u.promptTokenCount > 0) requestTokens = u.promptTokenCount;
                    if (u.candidatesTokenCount > 0) responseTokens = u.candidatesTokenCount;
                    if (u.totalTokenCount > 0) totalTokens = u.totalTokenCount;
                    // Gemini thinking tokens are already included in totalTokenCount
                  }
                } catch {
                  // Ignore JSON parse errors
                }
            }
          });

          proxyRes.on("end", async () => {
            streamCompleted = true;

            // Only end response if client is still connected
            if (!res.writableEnded && !clientDisconnected) res.end();

            const normalizedStreamTokens = normalizeTokenBreakdown(
              requestTokens,
              responseTokens,
              totalTokens,
              hasExplicitStreamInputTokens ? 0 : estimatedRequestTokens,
            );
            requestTokens = normalizedStreamTokens.requestTokens;
            responseTokens = normalizedStreamTokens.responseTokens;
            totalTokens = normalizedStreamTokens.totalTokens;

            const modelName = selectedModelName;
            const rateConfig = selectedModelRate;
            if (!rateConfig) throw new BadRequestError(`Model '${modelName}' not found in pricing configuration`);

            const modelMult =
              rateConfig && typeof rateConfig === "object" && rateConfig.multiplier != null
                ? Number(rateConfig.multiplier)
                : 1;
            const cacheCreationMult =
              rateConfig?.cacheCreationMultiplier != null
                ? Number(rateConfig.cacheCreationMultiplier)
                : DEFAULT_CACHE_CREATION_MULTIPLIER;
            const cacheReadMult =
              rateConfig?.cacheReadMultiplier != null
                ? Number(rateConfig.cacheReadMultiplier)
                : DEFAULT_CACHE_READ_MULTIPLIER;

            const costResult = this.calculateCost(
              requestTokens,
              responseTokens,
              totalTokens,
              rateConfig,
              globalMultiplier,
              cacheCreationTokens,
              cacheReadTokens,
              cacheCreationMult,
              cacheReadMult,
            );

            const totalOutputTime = Date.now() - startTime;
            const timeToFirstByte = firstByteTime ? firstByteTime - startTime : null;

            try {
              await this.finalizeStreamUsage(relayToken, {
                requestId: this.getLogicalRequestId(req),
                requestTokens,
                responseTokens,
                totalTokens,
                cacheCreationTokens,
                cacheReadTokens,
                cost: costResult.cost,
                inputRate: costResult.inputRate,
                outputRate: costResult.outputRate,
                multiplier: modelMult,
                cacheCreationMult,
                cacheReadMult,
                executionChannelId,
                displayChannelId,
                displayChannelName,
                channelId,
                channelMultiplier,
                relayGlobalMultiplier,
                monthlyPassCoverageAt,
                path: req.path.replace(/^\/relay\/proxy/, ""),
                method: req.method,
                statusCode: proxyRes.statusCode || 200,
                ipAddress: req.ip || "unknown",
                modelName,
                modelId: selectedModelId,
                totalOutputTime,
                timeToFirstByte,
                pricingType: rateConfig?.pricingType as "token-based" | "per-request" | undefined,
                fixedPrice: rateConfig?.fixedPrice,
                originalModel: originalRequestedModel,
              });
            } catch (error) {
              logger.error("Failed to finalize relay stream usage", {
                relayTokenId: relayToken.id,
                userId: relayToken.userId,
                modelName,
                error: error instanceof Error ? error.message : String(error),
              });
              reject(error);
              return;
            }

            resolve({ handled: true, success: true, retryable: false, statusCode: proxyRes.statusCode || 200 });
          });

          proxyRes.on("error", (err) => {
            streamCompleted = true;
            if (!res.writableEnded && !clientDisconnected) res.end();

            reject(err);
          });
        },
      );

      proxyReq.on("timeout", () => {
        timedOut = true;
        const timeoutError = new GatewayTimeoutError("Upstream request timeout");
        proxyReq.destroy(timeoutError);
        if (allowRetryBeforeResponse && !res.headersSent) {
          resolve({
            handled: false,
            success: false,
            retryable: true,
            statusCode: 504,
            triggerError: timeoutError.message,
          });
          return;
        }
        reject(timeoutError);
      });

      proxyReq.on("error", (err) => {
        if (timedOut) return;

        // If client already disconnected, don't send error response
        if (clientDisconnected) {
          logger.debug("[Relay] Upstream error after client disconnect, ignoring", { error: err.message });
          return;
        }

        if (allowRetryBeforeResponse && !res.headersSent && this.shouldFailoverOnError(err)) {
          resolve({
            handled: false,
            success: false,
            retryable: true,
            triggerError: err instanceof Error ? err.message : "Upstream request failed",
          });
          return;
        }

        if (!res.headersSent) this.sendStreamTransportError(res, err);

        reject(err);
      });

      proxyReq.write(bodyData);
      proxyReq.end();

      // Monitor client disconnect and abort upstream request
      const clientCloseHandler = () => {
        if (!streamCompleted && !timedOut) {
          clientDisconnected = true;
          logger.warn("[Relay] Client disconnected, aborting upstream request");
          proxyReq.destroy();
        }
      };

      req.once("close", clientCloseHandler);

      // Clean up listener when stream completes
      const cleanup = () => {
        req.off("close", clientCloseHandler);
      };

      proxyReq.once("error", cleanup);
      proxyReq.once("close", cleanup);
    });
  }

  private async finalizeStreamUsage(relayToken: RelayToken, data: any) {
    if (!Number.isFinite(data.cost) || data.cost < 0)
      throw new Error("cost must be a non-negative finite number for finalizeStreamUsage");

    if (data.inputRate == null || data.outputRate == null)
      throw new Error("inputRate and outputRate are required for finalizeStreamUsage");

    if (data.multiplier == null) throw new Error("multiplier is required for finalizeStreamUsage");

    if (data.cacheCreationMult == null || data.cacheReadMult == null)
      throw new Error("cacheCreationMult and cacheReadMult are required for finalizeStreamUsage");

    const cost = data.cost;
    const inputRate = data.inputRate;
    const outputRate = data.outputRate;
    const multiplier = data.multiplier;
    const cacheCreationMult = data.cacheCreationMult;
    const cacheReadMult = data.cacheReadMult;
    const executionChannelId = data.executionChannelId || data.channelId;
    const displayChannelId = data.displayChannelId || null;
    const displayChannelName = data.displayChannelName || null;
    const channelMultiplier = data.channelMultiplier ?? 1;
    const relayGlobalMultiplier = data.relayGlobalMultiplier ?? 1;
    const timeMultiplier = data.timeMultiplier;

    const finalizeResult = await this.usageChargeService.chargeUsage({
      userId: relayToken.userId,
      relayTokenId: relayToken.id,
      requestId: data.requestId,
      requestTokens: data.requestTokens,
      responseTokens: data.responseTokens,
      totalTokens: data.totalTokens,
      cacheCreationTokens: data.cacheCreationTokens || 0,
      cacheReadTokens: data.cacheReadTokens || 0,
      path: data.path,
      method: data.method,
      statusCode: data.statusCode,
      ipAddress: data.ipAddress,
      totalOutputTime: data.totalOutputTime,
      timeToFirstByte: data.timeToFirstByte,
      isStreaming: true,
      cost,
      modelName: data.modelName,
      modelId: data.modelId,
      monthlyPassCoverageAt: data.monthlyPassCoverageAt,
      executionChannelId,
      displayChannelId,
      displayChannelName,
      inputRate,
      outputRate,
      multiplier,
      cacheCreationMultiplier: cacheCreationMult,
      cacheReadMultiplier: cacheReadMult,
      channelId: data.channelId,
      channelMultiplier,
      globalMultiplier: relayGlobalMultiplier,
      timeMultiplier,
      balanceChargeMode: "allow-negative",
      pricingType: data.pricingType,
      fixedPrice: data.fixedPrice,
      originalModel: data.originalModel,
    });

    if (!finalizeResult.applied) throw new BadRequestError("Unable to finalize relay usage");
  }
}
