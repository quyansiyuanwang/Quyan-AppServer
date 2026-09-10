import axios from "axios";
import { randomUUID } from "crypto";
import https from "https";
import http from "http";
import { ProxyAgent } from "proxy-agent";
import { Readable } from "stream";
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

type UpstreamAgents = { httpAgent: http.Agent; httpsAgent: https.Agent };
const directUpstreamAgents: UpstreamAgents = { httpAgent, httpsAgent };

const createUpstreamAgents = (useProxy: boolean, proxyConfig: { enabled: boolean; url: string }): UpstreamAgents => {
  if (!useProxy || !proxyConfig.enabled || !proxyConfig.url) return directUpstreamAgents;
  try {
    const proxyAgent = new ProxyAgent({ getProxyForUrl: () => proxyConfig.url });
    return { httpAgent: proxyAgent as unknown as http.Agent, httpsAgent: proxyAgent as unknown as https.Agent };
  } catch {
    return directUpstreamAgents;
  }
};
import { RelayUsageRepository } from "@/store/relay/relay-usage.repository";
import { RelayProxyRepository } from "@/store/relay/relay-proxy.repository";
import type { ModelPricingDto } from "@/api/dto/relay/model-pricing.dto";
import type {
  ContextLengthMultiplierRule,
  RelayChannelRoutingConfigDto,
  RelayChannelRoutingStrategy,
} from "@/api/dto/relay/relay-channel.dto";
import type { RelayTokenStore } from "@/store/relay/relay-token.store";
import type { RelayUsageStore } from "@/store/relay/relay-usage.store";
import type { RelayProxyStore } from "@/store/relay/relay-proxy.store";
import { Prisma, RelayToken, RelayChannel } from "@prisma/client";
import {
  BadRequestError,
  ForbiddenError,
  GatewayTimeoutError,
  ContentSafetyBlockedError,
  LockBackendUnavailableError,
  PayloadTooLargeError,
  TooManyRequestsError,
} from "@/util/errors";
import { RelayConfigService } from "./relay-config.service";
import { ModelPricingService } from "./model-pricing.service";
import {
  RelayPoolResolverService,
  type RelayPoolMemberGraph,
  type RelayPoolMemberOrderContext,
  type RelayResolvedChannelCandidate,
} from "./relay-pool-resolver.service";
import { computeMultiplierForTime, type TimePeriodRule } from "./time-period-multiplier.service";
import { resolveContextLengthMultiplier } from "./context-length-multiplier.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { UsageChargeService } from "@/services/billing/usage-charge.service";
import {
  extractTokenUsageMetrics,
  hasTokenValue,
  normalizeTokenBreakdown,
  resolveFreshInputTokens,
} from "@/util/token-usage.util";
import { isModelIdAllowed, isModelNameAllowed, resolveModelId } from "@/util/model-resolution.util";
import { resolveMappedModel } from "@/util/model-mapping.util";
import {
  parseRelayRequestFormats,
  parseRelayChannelAllowedModelNames,
  parseRelayTokenAllowedModelIds,
  supportsRelayRequestFormat,
  type RelayRequestFormat,
} from "@/util/relay";
import {
  DEFAULT_CACHE_CREATION_MULTIPLIER,
  DEFAULT_CACHE_READ_MULTIPLIER,
  TOKEN_PRICE_DIVISOR,
} from "@/constant/pricing";
import { MONTHLY_PASS_QUOTA_WINDOW_MS } from "@/constant/monthly-pass";
import { RELAY_PROXY_DESCRIPTION_MAX_LENGTH, RELAY_PROXY_PROMPT_PREVIEW_MAX_LENGTH } from "@/constant/relay-proxy";
import { OperationCategory, OperationType } from "@/constant/operation-type";
import {
  hasVisibleRelayResponseOutput,
  normalizeRetryStatusRules,
  shouldRetryRelayUpstreamFailure,
} from "@/util/relay";
import { RELAY_CHANNEL_STATUS } from "@/constant/relay-channel";
import { env } from "@/config/env";
import logger from "@/util/logger";
import BusinessLogService from "@/services/system/businesslog.service";
import { buildBusinessLogRequestContext } from "@/util/business-log-context";
import { maskSensitiveData } from "@/util/mask-sensitive-data";
import { RelayChannelHealthService } from "./relay-channel-health.service";
import { RelayChannelProbeLockService } from "./relay-channel-probe-lock.service";
import { RelayChannelService } from "./relay-channel.service";
import { ConfigService } from "@/services/system/config.service";
import {
  convertRelayError,
  convertRelayRequest,
  convertRelayResponse,
  resolveRelayRequestFormatTransform,
} from "./relay-request-format-transform.service";
import type { RelayConvertibleRequestFormat } from "@quyan/shared";
import {
  normalizeAnthropicRequestBeforeSend,
  normalizeRelayTokenNormalizerConfig,
  rectifyAnthropicRequestForError,
} from "@/util/anthropic-token-normalizer.util";
import { applyRelayTokenV1PathMode } from "@/util/relay";
import { ContentSafetyService } from "@/services/system/content-safety.service";
import type { RelayStreamForwarderHost } from "./relay-stream-forwarder.service";
import type { RelayImageForwarderHost } from "./relay-image-forwarder.service";
import { RelayConcurrencyService } from "./relay-concurrency.service";
import { RelayAttemptPlannerService } from "./relay-attempt-planner.service";
import { getRelayCacheHitRateSince } from "./utils/relay-cache-hit-rate.util";
import type {
  ImageForwardResult,
  RelayAttemptPlan,
  RelayCapacityPolicy,
  RelayConcurrencyLease,
  RelayFailoverRuntimeConfig,
  RelayTokenAvailabilityInput,
  SelectedRateConfig,
  StreamForwardResult,
} from "./types/relay-proxy.types";
import { RelayChannelAttemptService } from "./relay-channel-attempt.service";
import { RelayUsageBillingService } from "./relay-usage-billing.service";
import type { RelayImageForwardParams, RelayStreamForwardParams } from "./types/relay-proxy.types";
import {
  buildRelayForwardBody,
  buildRelayUpstreamPath,
  extractRelayRequestedModel,
  isRelayAnthropicPath,
  isRelayGeminiPath,
  isRelayOpenAIPath,
  isRelayOpenAIRequestFormat,
  resolveRelayRequestFormat,
} from "./utils/relay-request-format.util";
import {
  getUpstreamHeaderValue,
  isRelayJsonContentType,
  parseRelayBufferedBody,
  sanitizeRelayResponseHeaders,
  withRelayRequestIdHeader,
} from "./utils/relay-upstream-response.util";

const GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID = "global";
const GLOBAL_CONCURRENCY_STATUS_USER_ID = "*";
const CONCURRENCY_QUEUE_POLL_INTERVAL_MS = 100;
const RELAY_TOKEN_QUOTA_COMPARE_EPSILON = 1e-8;

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

export type {
  ImageForwardResult,
  RelayAttemptPlan,
  RelayCapacityPolicy,
  RelayConcurrencyLease,
  RelayFailoverRuntimeConfig,
  RelayTokenAvailabilityInput,
  SelectedRateConfig,
  StreamForwardResult,
} from "./types/relay-proxy.types";

type RelayChannelWithPool = NonNullable<RelayTokenWithRelations["channel"]>;

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
  private readonly relayConcurrencyService: RelayConcurrencyService;
  private readonly relayAttemptPlanner: RelayAttemptPlannerService;
  private readonly relayChannelAttemptService = new RelayChannelAttemptService();
  private readonly relayUsageBillingService = new RelayUsageBillingService();

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
    private readonly relayChannelService: Pick<
      RelayChannelService,
      "resolveUniqueAccessibleDirectPooledParent" | "resolveAutomaticPoolUsageDisplayChannel"
    > = RelayChannelService.getInstance(),
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly contentSafetyService: ContentSafetyService = ContentSafetyService.getInstance(),
    relayConcurrencyService: RelayConcurrencyService = new RelayConcurrencyService(redis),
  ) {
    this.relayConcurrencyService = relayConcurrencyService;
    this.relayAttemptPlanner = new RelayAttemptPlannerService({
      getTopLevelAttemptChannels: (token) => this.getTopLevelAttemptChannels(token),
      resolveActiveLeafCandidates: (channels, orderMembers) =>
        this.relayPoolResolver.resolveActiveLeafCandidates(channels, orderMembers),
      orderPooledMemberChannels: (pool, members, context) => this.orderPooledMemberChannels(pool, members, context),
      getFailoverRuntimeConfig: (token) => this.getFailoverRuntimeConfig(token),
      getPoolFailoverRuntimeConfig: (channel, poolSize) => this.getPoolFailoverRuntimeConfig(channel, poolSize),
      isPriceFirstAutomaticPool: (channel) =>
        Boolean(
          channel?.channelType === "automatic-proxy-pool" &&
            this.getChannelRoutingConfig(channel)?.rankingMode !== "stability-first",
        ),
      filterChannelsByCacheHitRate: (token, channels, threshold, minSamples, windowHours) =>
        this.filterChannelsByCacheHitRate(token, channels, threshold, minSamples, windowHours),
    });
  }

  static getInstance(): RelayProxyService {
    if (!RelayProxyService.instance) RelayProxyService.instance = new RelayProxyService();

    return RelayProxyService.instance;
  }

  private createStreamForwarderHost(): Omit<RelayStreamForwarderHost, "forwardStreamRequest"> {
    return {
      contentSafetyService: this.contentSafetyService,
      relayProxyRepository: this.relayProxyRepository,
      finalizeStreamUsage: this.finalizeStreamUsage.bind(this),
      calculateCost: this.calculateCost.bind(this),
      resolveContextMultiplier: this.resolveContextMultiplier.bind(this),
      getLogicalRequestId: this.getLogicalRequestId.bind(this),
      isPerRequestPricingConfig: this.isPerRequestPricingConfig.bind(this),
      removeAutoInjectedOpenAIStreamUsageOption: this.removeAutoInjectedOpenAIStreamUsageOption.bind(this),
      sendStreamTransportError: this.sendStreamTransportError.bind(this),
      shouldFailoverOnError: this.shouldFailoverOnError.bind(this),
      withRequestIdHeader: this.withRequestIdHeader.bind(this),
    };
  }

  private createImageForwarderHost(): RelayImageForwarderHost {
    return {
      buildForwardBodyBuffer: this.buildForwardBodyBuffer.bind(this),
      chargeForwardedImageUsage: this.chargeForwardedImageUsage.bind(this),
      extractUpstreamErrorMessage: this.extractUpstreamErrorMessage.bind(this),
      getLogicalRequestId: this.getLogicalRequestId.bind(this),
      isPerRequestPricingConfig: this.isPerRequestPricingConfig.bind(this),
      parseBufferedUpstreamBody: this.parseBufferedUpstreamBody.bind(this),
      readStreamBodyLimited: this.readStreamBodyLimited.bind(this),
      relayProxyRepository: this.relayProxyRepository,
      sanitizeResponseHeaders: this.sanitizeResponseHeaders.bind(this),
      withRequestIdHeader: this.withRequestIdHeader.bind(this),
    };
  }

  private async resolveBillingDisplayChannel(
    relayToken: Pick<RelayToken, "userId" | "routingMode">,
    executionChannel: RelayChannel,
    logicalDisplayChannel: RelayChannel,
    resolvedParents: Map<string, RelayChannel | null>,
  ): Promise<RelayChannel> {
    if (relayToken.routingMode !== "automatic-pool") return logicalDisplayChannel;

    if (!resolvedParents.has(executionChannel.id)) {
      resolvedParents.set(
        executionChannel.id,
        await this.relayChannelService.resolveUniqueAccessibleDirectPooledParent(
          executionChannel.id,
          relayToken.userId,
        ),
      );
    }

    return resolvedParents.get(executionChannel.id) ?? logicalDisplayChannel;
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

  private extractPromptPreview(req: any, requestFormat: RelayRequestFormat): string | null {
    const body = req?.body;
    if (!body || Buffer.isBuffer(body)) return null;

    const chunks: string[] = [];

    if (this.isOpenAIRequestFormat(requestFormat)) {
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
    requestFormat: RelayRequestFormat;
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

  private resolveContextMultiplier(
    rules: ContextLengthMultiplierRule[] | null | undefined,
    requestTokens: number,
    cacheCreationTokens: number,
    cacheReadTokens: number,
  ) {
    return resolveContextLengthMultiplier(
      rules,
      Math.max(0, requestTokens) + Math.max(0, cacheCreationTokens) + Math.max(0, cacheReadTokens),
    );
  }

  private isMultipartRequest(req: any): boolean {
    const contentType = String(req.headers?.["content-type"] || req.headers?.["Content-Type"] || "");
    return contentType.toLowerCase().startsWith("multipart/form-data");
  }

  private extractRequestedModelFromMultipartBody(req: any): string | null {
    if (!Buffer.isBuffer(req.body)) return null;
    return extractRelayRequestedModel(req, "openai-chat-completions");
  }

  private extractRequestedModel(req: any, requestFormat: RelayRequestFormat): string | null {
    return extractRelayRequestedModel(req, requestFormat);
  }

  private isOpenAIFormat(req: any): boolean {
    return isRelayOpenAIPath(String(req.path || ""));
  }

  private isOpenAIRequestFormat(requestFormat: RelayRequestFormat): boolean {
    return isRelayOpenAIRequestFormat(requestFormat);
  }

  private isGeminiFormat(req: any): boolean {
    return isRelayGeminiPath(String(req.path || ""));
  }

  private isAnthropicFormat(req: any): boolean {
    return isRelayAnthropicPath(String(req.path || ""));
  }

  private getRequestFormat(req: any): RelayRequestFormat {
    return resolveRelayRequestFormat(req);
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

    // Channel restrictions historically stored display names. Accept the
    // canonical model ID as well so request validation remains ID-based.
    for (const config of candidateConfigs)
      if (
        isModelNameAllowed(allowedModelNames, config.model || "") ||
        isModelNameAllowed(allowedModelNames, resolveModelId(config))
      )
        return config;

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
    requestFormat: RelayRequestFormat,
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

    if (this.isOpenAIRequestFormat(requestFormat)) {
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
    requestFormat: RelayRequestFormat,
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
      const formatLabel =
        requestFormat === "openai-chat-completions"
          ? "openai format requests (openai-chat-completions format requests)"
          : `${requestFormat} format requests`;
      throw new BadRequestError(
        `Channel does not support ${formatLabel}. Allowed formats: ${allowedFormats || "none"}`,
      );
    }

    const tokenAllowedModelIds = parseRelayTokenAllowedModelIds(relayToken.allowedModels);
    const formatScopedModels = modelPricing.filter((model) =>
      supportsRelayRequestFormat(model.supportedFormats, requestFormat),
    );
    const modelIds = new Set<string>();

    for (const channel of eligibleChannels) {
      const channelAllowedModelNames = parseRelayChannelAllowedModelNames(channel);
      // `/v1/models` describes the models explicitly configured on the token's
      // channels. An unrestricted channel is still routable, but it must not
      // turn the endpoint into a dump of the entire global pricing catalog.
      const channelScopedModels =
        channelAllowedModelNames == null
          ? []
          : formatScopedModels.filter(
              (model) =>
                isModelNameAllowed(channelAllowedModelNames, model.model || "") ||
                isModelNameAllowed(channelAllowedModelNames, resolveModelId(model)),
            );

      for (const model of channelScopedModels) {
        const modelId = resolveModelId(model);
        if (!modelId) continue;
        if (tokenAllowedModelIds.length > 0 && !isModelIdAllowed(tokenAllowedModelIds, model)) continue;
        modelIds.add(modelId);
      }
    }

    return [...modelIds].sort((left, right) => left.localeCompare(right));
  }

  async getAvailableModelMapForToken(relayToken: RelayTokenAvailabilityInput): Promise<{
    openai: string[];
    anthropic: string[];
    gemini: string[];
  }> {
    const getModels = async (requestFormat: RelayRequestFormat) => {
      try {
        return await this.getAvailableModelsForToken(relayToken, requestFormat);
      } catch (error) {
        if (error instanceof BadRequestError) return [];
        throw error;
      }
    };

    const [openai, anthropic, gemini] = await Promise.all([
      getModels("openai-chat-completions"),
      getModels("anthropic"),
      getModels("gemini"),
    ]);
    return { openai, anthropic, gemini };
  }

  private rewriteGeminiModelPath(path: string, upstreamModelId: string): string {
    return buildRelayUpstreamPath(path, "gemini", upstreamModelId);
  }

  private buildUpstreamPath(requestPath: string, requestFormat: RelayRequestFormat, upstreamModelId: string): string {
    return buildRelayUpstreamPath(requestPath, requestFormat, upstreamModelId);
  }

  private buildForwardBody(requestBody: any, requestFormat: RelayRequestFormat, upstreamModelId: string): any {
    return buildRelayForwardBody(requestBody, requestFormat, upstreamModelId);
  }

  private isOpenAIImageEditsPath(requestPath: string): boolean {
    const normalizedPath = requestPath.replace(/^\/relay\/proxy/, "");
    return /^\/(?:v\d+(?:beta)?\/)?images\/edits(?:\/|$)/.test(normalizedPath);
  }

  private getMultipartBoundary(contentType: unknown): string | null {
    const rawContentType = Array.isArray(contentType) ? contentType.join(";") : String(contentType || "");
    const match = rawContentType.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
    const boundary = match?.[1] || match?.[2];

    return boundary && !/[\r\n]/.test(boundary) ? boundary : null;
  }

  private findMultipartBoundary(body: Buffer, marker: Buffer, offset: number): number {
    let index = body.indexOf(marker, offset);

    while (index !== -1) {
      const followsPart = body[index + marker.length] === 13 && body[index + marker.length + 1] === 10;
      const followsClosing = body[index + marker.length] === 45 && body[index + marker.length + 1] === 45;
      const startsOnBoundaryLine = index === 0 || (body[index - 2] === 13 && body[index - 1] === 10);

      if (startsOnBoundaryLine && (followsPart || followsClosing)) return index;
      index = body.indexOf(marker, index + marker.length);
    }

    return -1;
  }

  private normalizeOpenAIImageEditsMultipartBody(
    requestBody: any,
    requestFormat: RelayRequestFormat,
    requestPath: string,
    contentType: unknown,
    upstreamModelId?: string,
  ): any {
    const isMultipart = String(contentType || "")
      .toLowerCase()
      .startsWith("multipart/form-data");
    if (!Buffer.isBuffer(requestBody) || !isMultipart) return requestBody;

    let normalizedBody = requestBody;
    const boundary = this.getMultipartBoundary(contentType);
    if (upstreamModelId) {
      if (!boundary || /[\r\n]/.test(upstreamModelId))
        throw new BadRequestError("Unable to safely rewrite multipart model field");
      const marker = Buffer.from(`--${boundary}`, "ascii");
      const headerSeparator = Buffer.from("\r\n\r\n", "ascii");
      const replacements: Array<{ start: number; end: number; value: Buffer }> = [];
      let modelFieldCount = 0;
      let sawClosingBoundary = false;
      let boundaryOffset = this.findMultipartBoundary(normalizedBody, marker, 0);

      while (boundaryOffset !== -1) {
        const boundaryEnd = boundaryOffset + marker.length;
        if (normalizedBody[boundaryEnd] === 45 && normalizedBody[boundaryEnd + 1] === 45) {
          sawClosingBoundary = true;
          break;
        }
        if (normalizedBody[boundaryEnd] !== 13 || normalizedBody[boundaryEnd + 1] !== 10)
          throw new BadRequestError("Unable to safely rewrite multipart model field");

        const headerStart = boundaryEnd + 2;
        const headerEnd = normalizedBody.indexOf(headerSeparator, headerStart);
        if (headerEnd === -1) throw new BadRequestError("Unable to safely rewrite multipart model field");
        const headerText = normalizedBody.subarray(headerStart, headerEnd).toString("latin1");
        const dispositionMatch = /(?:^|\r\n)content-disposition\s*:\s*form-data[^\r\n]*/i.exec(headerText);
        const nameMatch = dispositionMatch?.[0].match(/\bname\s*=\s*(?:"([^"]*)"|([^;\s]*))/i);
        const fieldName = nameMatch?.[1] ?? nameMatch?.[2];
        const nextBoundary = this.findMultipartBoundary(normalizedBody, marker, headerEnd + headerSeparator.length);
        if (nextBoundary === -1) throw new BadRequestError("Unable to safely rewrite multipart model field");

        if (fieldName === "model") {
          modelFieldCount += 1;
          if (modelFieldCount > 1 || !dispositionMatch || /\bfilename\s*=/i.test(dispositionMatch[0]))
            throw new BadRequestError("Unable to safely rewrite multipart model field");
          const valueStart = headerEnd + headerSeparator.length;
          const valueEnd =
            nextBoundary >= 2 && normalizedBody[nextBoundary - 2] === 13 && normalizedBody[nextBoundary - 1] === 10
              ? nextBoundary - 2
              : nextBoundary;
          if (valueEnd < valueStart) throw new BadRequestError("Unable to safely rewrite multipart model field");
          replacements.push({ start: valueStart, end: valueEnd, value: Buffer.from(upstreamModelId, "utf8") });
        }
        boundaryOffset = nextBoundary;
      }

      if (modelFieldCount !== 1 || !sawClosingBoundary)
        throw new BadRequestError("Unable to safely rewrite multipart model field");
      const chunks: Buffer[] = [];
      let offset = 0;
      for (const replacement of replacements) {
        chunks.push(normalizedBody.subarray(offset, replacement.start), replacement.value);
        offset = replacement.end;
      }
      chunks.push(normalizedBody.subarray(offset));
      normalizedBody = Buffer.concat(chunks);
    }

    if (!["openai", "openai-chat-completions"].includes(requestFormat) || !this.isOpenAIImageEditsPath(requestPath))
      return normalizedBody;
    const normalizedBoundary = this.getMultipartBoundary(contentType);
    if (!normalizedBoundary) return normalizedBody;

    const marker = Buffer.from(`--${normalizedBoundary}`, "ascii");
    const headerSeparator = Buffer.from("\r\n\r\n", "ascii");
    const replacements: Array<{ start: number; end: number; value: Buffer }> = [];
    let sourceImageCount = 0;
    let boundaryOffset = this.findMultipartBoundary(normalizedBody, marker, 0);

    while (boundaryOffset !== -1) {
      const boundaryEnd = boundaryOffset + marker.length;
      if (normalizedBody[boundaryEnd] === 45 && normalizedBody[boundaryEnd + 1] === 45) break;
      if (normalizedBody[boundaryEnd] !== 13 || normalizedBody[boundaryEnd + 1] !== 10) return normalizedBody;

      const headerStart = boundaryEnd + 2;
      const headerEnd = normalizedBody.indexOf(headerSeparator, headerStart);
      if (headerEnd === -1) return normalizedBody;

      const headerText = normalizedBody.subarray(headerStart, headerEnd).toString("latin1");
      const dispositionMatch = /(?:^|\r\n)content-disposition\s*:\s*form-data[^\r\n]*/i.exec(headerText);
      const nameMatch = dispositionMatch?.[0].match(/\bname\s*=\s*(?:"([^"]*)"|([^;\s]*))/i);
      const fieldName = nameMatch?.[1] ?? nameMatch?.[2];

      if (fieldName === "image" || fieldName === "image[]") {
        sourceImageCount += 1;

        if (fieldName === "image" && dispositionMatch && nameMatch?.index !== undefined) {
          const dispositionOffset = dispositionMatch.index ?? 0;
          const valueOffsetInMatch = nameMatch[0].lastIndexOf(fieldName);
          const valueStart = headerStart + dispositionOffset + nameMatch.index + valueOffsetInMatch;
          replacements.push({ start: valueStart, end: valueStart + fieldName.length, value: Buffer.from("image[]") });
        }
      }

      boundaryOffset = this.findMultipartBoundary(normalizedBody, marker, headerEnd + headerSeparator.length);
    }

    if (sourceImageCount < 2 || replacements.length === 0) return normalizedBody;

    const chunks: Buffer[] = [];
    let offset = 0;
    for (const replacement of replacements) {
      chunks.push(normalizedBody.subarray(offset, replacement.start), replacement.value);
      offset = replacement.end;
    }
    chunks.push(normalizedBody.subarray(offset));

    return Buffer.concat(chunks);
  }

  private isOpenAIChatCompletionsPath(requestPath: string): boolean {
    const normalizedPath = requestPath.replace(/^\/relay\/proxy/, "");
    return /^\/(?:v\d+(?:beta)?\/)?chat\/completions(?:\/|$)/.test(normalizedPath);
  }

  private addOpenAIStreamUsageOption(
    requestBody: any,
    requestFormat: RelayRequestFormat,
    requestPath: string,
  ): { body: any; autoInjected: boolean } {
    if (
      !["openai", "openai-chat-completions"].includes(requestFormat) ||
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

  private isImageRequest(req: any, requestFormat: RelayRequestFormat): boolean {
    const rawPath = String(req.path || req.originalUrl || req.url || "");
    if (this.isOpenAIRequestFormat(requestFormat)) {
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
        const resourceGuard = env.relay.resourceGuard;
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
    const resourceGuard = env.relay.resourceGuard;

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

  private acquireConcurrencySlot(params: {
    userId: string;
    scope: RelayConcurrencyScope;
    maxConcurrency: number;
    queueTimeout: number;
    enableQueue: boolean;
    slotTtlSeconds: number;
  }): Promise<RelayConcurrencyLease> {
    return this.relayConcurrencyService.acquire(params);
  }

  private async acquireConcurrencySlotLegacy(params: {
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
    await this.relayConcurrencyService.release(lease);
  }

  private async releaseConcurrencySlotLegacy(lease: RelayConcurrencyLease): Promise<void> {
    await this.redis.deleteIfValueMatches(lease.slotKey, lease.ownerToken);
  }

  private startConcurrencyLeaseHeartbeat(lease: RelayConcurrencyLease): () => void {
    return this.relayConcurrencyService.startHeartbeat(lease);
  }

  private startConcurrencyLeaseHeartbeatLegacy(lease: RelayConcurrencyLease): () => void {
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
    return this.relayConcurrencyService.getStatus({
      userId,
      limits: this.getRelayConcurrencyStatusLimits(relayConfig),
    });
  }

  private async getConcurrencyStatusLegacy(userId?: string) {
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
    const maxAcceptedChannelMultiplier = relayToken.failoverConfig?.maxAcceptedChannelMultiplier;
    return {
      enabled: Boolean(relayToken.failoverConfig?.enabled),
      maxRetries: Math.max(0, Number(relayToken.failoverConfig?.maxRetries ?? 2)),
      retryStatusCodes,
      failoverThreshold: Math.max(0, Number(relayToken.failoverConfig?.failoverThreshold ?? 0)) + 1,
      failbackCooldownMinutes: Math.max(0, Number(relayToken.failoverConfig?.failbackCooldownMinutes ?? 0)),
      ...(maxAcceptedChannelMultiplier == null
        ? {}
        : { maxAcceptedChannelMultiplier: Number(maxAcceptedChannelMultiplier) }),
      minCacheHitRate:
        relayToken.failoverConfig?.minCacheHitRate == null
          ? null
          : Math.min(1, Math.max(0, Number(relayToken.failoverConfig.minCacheHitRate))),
      cacheHitRateMinSamples: Math.max(1, Math.floor(Number(relayToken.failoverConfig?.cacheHitRateMinSamples ?? 10))),
      cacheHitRateWindowHours: Math.max(
        1,
        Math.min(8760, Math.floor(Number(relayToken.failoverConfig?.cacheHitRateWindowHours ?? 168))),
      ),
    };
  }

  private async filterChannelsByCacheHitRate(
    relayToken: RelayTokenAvailabilityInput,
    channels: RelayResolvedChannelCandidate[],
    minCacheHitRate: number | null | undefined,
    minSamples: number,
    windowHours: number,
  ): Promise<RelayResolvedChannelCandidate[]> {
    const threshold = minCacheHitRate == null ? null : Number(minCacheHitRate);
    if (threshold == null || !Number.isFinite(threshold) || threshold <= 0 || channels.length <= 1 || !relayToken.id)
      return channels;
    const channelIds = [...new Set(channels.map((candidate) => candidate.resolvedChannel.id))];
    const since = getRelayCacheHitRateSince(windowHours);
    let rates;
    try {
      rates = await this.relayUsageRepo.aggregateChannelCacheHitRates(relayToken.id, channelIds, since);
    } catch (error) {
      logger.warn("Failed to read relay token cache hit rates; keeping all channels", {
        relayTokenId: relayToken.id,
        error,
      });
      return channels;
    }
    const rateMap = new Map(rates.map((rate) => [rate.channelId, rate]));
    const eligible = channels.filter((candidate) => {
      const rate = rateMap.get(candidate.resolvedChannel.id);
      return !rate || rate.sampleCount < Math.max(1, minSamples) || rate.hitRate >= threshold;
    });
    if (eligible.length === 0) {
      logger.warn("All relay channels are below the token cache hit-rate threshold; preserving fallback order", {
        relayTokenId: relayToken.id,
        threshold,
        minSamples,
      });
      return channels;
    }
    if (eligible.length !== channels.length)
      logger.info("Filtered relay channels by token cache hit rate", {
        relayTokenId: relayToken.id,
        threshold,
        minSamples,
        skippedChannelIds: channels
          .filter((candidate) => !eligible.includes(candidate))
          .map((candidate) => candidate.resolvedChannel.id),
      });
    return eligible;
  }

  /** Reject an automatic-pool execution channel before any upstream request is made. */
  assertRelayChannelMultiplierAccepted(
    channel: Pick<RelayChannel, "id" | "name"> & { multiplier: Prisma.Decimal | number },
    failoverConfig: RelayFailoverRuntimeConfig,
  ): void {
    const maximum = failoverConfig.maxAcceptedChannelMultiplier;
    if (maximum == null) return;

    const multiplier = Number(channel.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= maximum) return;

    throw new BadRequestError(
      `Automatic proxy pool channel '${channel.name || channel.id}' has multiplier ${multiplier}, exceeding the token limit ${maximum}`,
    );
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
      return channel?.status === RELAY_CHANNEL_STATUS.ENABLED && channel.providerServiceEnabled !== false
        ? [channel as RelayChannelWithPool]
        : [];
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
      return (
        channel.status === RELAY_CHANNEL_STATUS.ENABLED &&
        channel.providerServiceEnabled !== false &&
        channel.channelType !== "automatic-proxy-pool"
      );
    });
  }

  private async orderPooledMemberChannels(
    channel: RelayChannel,
    poolMembers: RelayPoolMemberGraph[],
    context?: RelayPoolMemberOrderContext,
  ): Promise<RelayPoolMemberGraph[]> {
    const strategy = (channel.routingStrategy || "priority") as RelayChannelRoutingStrategy;
    const routingConfig = this.getChannelRoutingConfig(channel);
    const orderedPoolMembers = [...poolMembers].sort((left, right) => left.priority - right.priority);

    if (orderedPoolMembers.length === 0) return [];

    let orderedMembers = orderedPoolMembers;
    if (channel.channelType === "automatic-proxy-pool") {
      const rankingMode = routingConfig?.rankingMode === "stability-first" ? "stability-first" : "price-first";
      const ranked = await this.relayChannelHealthService.rankMembers(
        orderedPoolMembers.map((member) => {
          // The graph resolver normally hydrates this relation. Keep the top-level channel relation
          // as a fallback for callers that have already loaded it (and for light-weight test doubles).
          const configuredMember = (channel as RelayChannelWithPool).poolMembers?.find(
            (candidate) => candidate.memberChannelId === member.memberChannelId,
          );
          const memberChannel = member.memberChannel ?? configuredMember?.memberChannel;
          return {
            id: member.memberChannelId,
            name: memberChannel?.name ?? member.memberChannelId,
            enabled:
              member.enabled &&
              memberChannel?.status === RELAY_CHANNEL_STATUS.ENABLED &&
              memberChannel.providerServiceEnabled !== false,
            priority: member.priority,
            weight: Number(member.weight),
            effectivePrice:
              Number(memberChannel?.multiplier ?? 1) *
              computeMultiplierForTime(
                ((memberChannel as RelayChannel & { timePeriodMultipliers?: TimePeriodRule[] })
                  ?.timePeriodMultipliers ?? []) as TimePeriodRule[],
                new Date(),
              ),
            healthTrackingMode:
              ((memberChannel?.routingConfig as RelayChannelRoutingConfigDto | null | undefined)?.healthTrackingMode as
                | "automatic"
                | "manual"
                | "disabled"
                | undefined) ?? "automatic",
            manualAvailability: (memberChannel?.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
              ?.manualAvailability,
            manualLatencyMs: (memberChannel?.routingConfig as RelayChannelRoutingConfigDto | null | undefined)
              ?.manualLatencyMs,
          };
        }),
        rankingMode,
        new Date(),
        {
          healthScoreThreshold: routingConfig?.healthScoreThreshold,
          latencyThresholdMs: routingConfig?.latencyThresholdMs,
          circuitBreakerThreshold: routingConfig?.circuitBreakerThreshold,
        },
      );
      const byId = new Map(ranked.map((member, index) => [member.id, { index, member }]));
      orderedMembers = [...orderedPoolMembers].sort((left, right) => {
        if (routingConfig?.dynamicMemberRankingEnabled === false)
          return (
            left.priority - right.priority ||
            (left.memberChannel?.name ?? left.memberChannelId).localeCompare(
              right.memberChannel?.name ?? right.memberChannelId,
            ) ||
            left.memberChannelId.localeCompare(right.memberChannelId)
          );
        const leftRank = byId.get(left.memberChannelId)?.index ?? Number.MAX_SAFE_INTEGER;
        const rightRank = byId.get(right.memberChannelId)?.index ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank;
      });
      const eligibleIds = new Set(ranked.filter((member) => member.eligible).map((member) => member.id));
      orderedMembers = orderedMembers.filter((member) => eligibleIds.has(member.memberChannelId));
    } else if (strategy === "random") orderedMembers = this.shuffleItems(orderedPoolMembers);
    else if (strategy === "weighted-random") orderedMembers = this.weightedShuffleMembers(orderedPoolMembers);
    else if (strategy === "round-robin") {
      const counter = (await this.redis.increment(this.getPoolRoundRobinKey(channel), 0, 1)) ?? 1;
      orderedMembers = this.rotateItems(orderedPoolMembers, Math.max(0, Math.floor(counter - 1)));
    }

    // Automatic pools always expose every currently eligible member to the request-level
    // failover loop. `maxRetries` remains meaningful for ordinary pooled channels only.
    if (context?.expandAllEligibleMembers) return orderedMembers;

    const rawMaxRetries = Number(routingConfig?.maxRetries);
    const maxAttempts = Number.isFinite(rawMaxRetries)
      ? Math.max(1, Math.min(orderedMembers.length, Math.floor(rawMaxRetries) + 1))
      : orderedMembers.length;

    return orderedMembers.slice(0, maxAttempts);
  }

  private getPoolFailoverRuntimeConfig(channel: RelayChannel, poolSize: number): RelayFailoverRuntimeConfig {
    const routingConfig = this.getChannelRoutingConfig(channel);
    const configuredRetryStatusCodes = Array.isArray(routingConfig?.retryStatusCodes)
      ? routingConfig.retryStatusCodes
      : ["4xx", "5xx"];
    // A 429 from one member is a transient capacity/rate-limit condition for an
    // automatic pool. Keep it failover-eligible even when operators configured
    // a narrower list such as only 503.
    const retryStatusCodes = normalizeRetryStatusRules(
      channel.channelType === "automatic-proxy-pool"
        ? [...configuredRetryStatusCodes, "429"]
        : configuredRetryStatusCodes,
    );
    const rawMaxRetries = Number(routingConfig?.maxRetries);
    const maxRetries =
      channel.channelType === "automatic-proxy-pool"
        ? Math.max(0, poolSize - 1)
        : Number.isFinite(rawMaxRetries)
          ? Math.max(0, Math.floor(rawMaxRetries))
          : Math.max(0, poolSize - 1);

    return {
      enabled: poolSize > 1,
      maxRetries,
      retryStatusCodes,
      failoverThreshold: 1,
      failbackCooldownMinutes: Math.max(0, Number(routingConfig?.failbackCooldownMinutes ?? 0)),
      minCacheHitRate: null,
      cacheHitRateMinSamples: 10,
      cacheHitRateWindowHours: 168,
    };
  }

  private async buildAttemptPlan(relayToken: RelayTokenAvailabilityInput): Promise<RelayAttemptPlan> {
    return this.relayAttemptPlanner.build({ relayToken });
  }

  private async buildAttemptPlanLegacy(relayToken: RelayTokenAvailabilityInput): Promise<RelayAttemptPlan> {
    const topLevelChannels = this.getTopLevelAttemptChannels(relayToken);
    const resolvedChannels = await this.relayPoolResolver.resolveActiveLeafCandidates(
      topLevelChannels,
      (pool, members, context) => this.orderPooledMemberChannels(pool, members, context),
    );
    const blockedChannelIds = new Set(
      Array.isArray(relayToken.blockedAutomaticProxyPoolChannelIds)
        ? relayToken.blockedAutomaticProxyPoolChannelIds.reduce<string[]>((ids, channelId) => {
            if (typeof channelId !== "string") return ids;
            const normalizedChannelId = channelId.trim();
            if (normalizedChannelId) ids.push(normalizedChannelId);
            return ids;
          }, [])
        : [],
    );
    const channels = blockedChannelIds.size
      ? resolvedChannels.filter(
          (candidate) => !blockedChannelIds.has((candidate.billingChannel ?? candidate.resolvedChannel).id),
        )
      : resolvedChannels;

    const tokenFailoverConfig = this.getFailoverRuntimeConfig(relayToken);
    const singleTopLevelChannel = topLevelChannels.length === 1 ? topLevelChannels[0] : null;

    const isPriceFirstAutomaticPool =
      singleTopLevelChannel?.channelType === "automatic-proxy-pool" &&
      this.getChannelRoutingConfig(singleTopLevelChannel)?.rankingMode !== "stability-first";

    if (singleTopLevelChannel?.channelType === "automatic-proxy-pool")
      return {
        channels,
        failoverConfig: {
          ...this.getPoolFailoverRuntimeConfig(singleTopLevelChannel, channels.length),
          ...(tokenFailoverConfig.maxAcceptedChannelMultiplier == null
            ? {}
            : { maxAcceptedChannelMultiplier: tokenFailoverConfig.maxAcceptedChannelMultiplier }),
        },
        allowStickyFailover: !isPriceFirstAutomaticPool,
      };

    if (tokenFailoverConfig.enabled || !singleTopLevelChannel || singleTopLevelChannel.channelType !== "pooled")
      return { channels, failoverConfig: tokenFailoverConfig, allowStickyFailover: !isPriceFirstAutomaticPool };

    return {
      channels,
      failoverConfig: this.getPoolFailoverRuntimeConfig(singleTopLevelChannel, channels.length),
      allowStickyFailover: !isPriceFirstAutomaticPool,
    };
  }

  /**
   * Returns the same ordered, filtered route candidates used by proxy requests.
   * Chat owns its response persistence, but must never maintain a divergent view
   * of ordered channels, automatic pools, or token-level channel exclusions.
   */
  async getChatAttemptPlan(relayToken: RelayTokenWithChannel): Promise<RelayAttemptPlan> {
    return this.buildAttemptPlan(relayToken);
  }

  private buildFailoverStickyChannelKey(
    relayTokenId: string,
    requestFormat: RelayRequestFormat,
    requestedModel: string,
  ): string {
    const normalizedModel = encodeURIComponent(requestedModel.trim() || "_");
    return `relay:token:failover:sticky:${relayTokenId}:${requestFormat}:${normalizedModel}`;
  }

  private async clearStickyPreferredChannel(params: {
    relayTokenId: string;
    requestFormat: RelayRequestFormat;
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
    requestFormat: RelayRequestFormat;
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
    requestFormat: RelayRequestFormat;
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
    requestFormat: RelayRequestFormat;
    requestedModel: string;
    modelPricing: ModelPricingDto[];
    tokenModelMapping?: Record<string, string> | null;
  }): boolean {
    try {
      // The requested model may be an alias that the channel-level (or token-level)
      // model mapping rewrites to a priced upstream model, so eligibility must be
      // checked against the effective (mapped) model name.
      const effectiveModelName = resolveMappedModel(
        params.requestedModel,
        params.channel.modelMapping as Record<string, string> | null | undefined,
        params.tokenModelMapping,
      );
      const effectiveModelConfigs = this.resolveRequestedModelConfigs(params.modelPricing, effectiveModelName);
      let channelModelConfig = this.resolveChannelModelConfig(
        params.channel,
        effectiveModelName,
        effectiveModelConfigs,
      );
      if (!channelModelConfig && effectiveModelName !== params.requestedModel) {
        // Fallback for channels that list the original request model directly.
        const originalModelConfigs = this.resolveRequestedModelConfigs(params.modelPricing, params.requestedModel);
        channelModelConfig = this.resolveChannelModelConfig(
          params.channel,
          params.requestedModel,
          originalModelConfigs,
        );
      }
      this.validateChannelModelConfig(params.channel, channelModelConfig, effectiveModelName);
      this.resolveChannelUpstreamConfig(params.channel, params.requestFormat);
      return true;
    } catch {
      return false;
    }
  }

  private async prioritizeStickyPreferredChannel(params: {
    relayToken: RelayTokenWithChannel;
    channels: RelayResolvedChannelCandidate[];
    requestFormat: RelayRequestFormat;
    requestedModel: string;
    candidateModelConfigs: ModelPricingDto[];
    modelPricing: ModelPricingDto[];
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
        modelPricing: params.modelPricing,
        tokenModelMapping: params.relayToken.modelMapping as Record<string, string> | null | undefined,
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
    responseData?: unknown,
  ): boolean {
    if (!hasNextChannel || !failoverConfig.enabled) return false;
    if (statusCode == null) return true;
    return shouldRetryRelayUpstreamFailure(statusCode, responseData, failoverConfig.retryStatusCodes);
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
    requestFormat?: RelayRequestFormat;
    requestedModel?: string;
    failbackCooldownMinutes?: number;
    allowStickyFailover?: boolean;
  }): Promise<void> {
    try {
      await this.relayTokenRepo.createSwitchLog(params);
    } catch (error) {
      logger.warn("Failed to create relay channel switch log", { ...params, error });
    }

    if (!params.allowStickyFailover || !params.requestFormat || !params.requestedModel) return;

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
    if (error instanceof ContentSafetyBlockedError) return false;
    const cancellation = error as { code?: string; name?: string } | undefined;
    if (cancellation?.code === "ERR_CANCELED" || cancellation?.name === "AbortError") return false;

    // 其他所有错误都应该尝试 failover
    return true;
  }

  private sendStreamTransportError(res: any, error: unknown): void {
    if (res.headersSent || res.writableEnded) return;

    const statusCode =
      error instanceof ContentSafetyBlockedError ? 403 : error instanceof GatewayTimeoutError ? 504 : 502;
    const message = error instanceof Error ? error.message : "Upstream request failed";

    res.status(statusCode).json({
      error: {
        message,
        type: error instanceof ContentSafetyBlockedError ? "content_safety_blocked" : "upstream_error",
        code: statusCode,
        upstream_status: statusCode,
      },
    });
  }

  private buildForwardBodyBuffer(convertedBody: any): Buffer {
    return Buffer.isBuffer(convertedBody) ? convertedBody : Buffer.from(JSON.stringify(convertedBody ?? {}));
  }

  private getHeaderValue(headers: Record<string, unknown> | undefined, headerName: string): string | undefined {
    return getUpstreamHeaderValue(headers, headerName);
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
    return withRelayRequestIdHeader(req, headers);
  }

  private sanitizeResponseHeaders(headers: Record<string, unknown>, options: { keepContentLength?: boolean } = {}) {
    return sanitizeRelayResponseHeaders(headers, options);
  }

  private isJsonContentType(contentType: unknown): boolean {
    return isRelayJsonContentType(Array.isArray(contentType) ? contentType.join(";") : contentType);
  }

  private isAsyncIterable(value: unknown): value is AsyncIterable<Buffer | string> {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;

    return typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
  }

  private async readStreamBodyLimited(
    stream: Readable | unknown,
    maxBytes: number,
    onFirstChunk?: () => void,
  ): Promise<{ buffer: Buffer; truncated: boolean; bytesRead: number }> {
    if (!this.isAsyncIterable(stream)) {
      const serializedBody =
        stream === null || stream === undefined
          ? Buffer.alloc(0)
          : Buffer.isBuffer(stream)
            ? stream
            : stream instanceof Uint8Array
              ? Buffer.from(stream)
              : typeof stream === "string"
                ? Buffer.from(stream)
                : Buffer.from(JSON.stringify(stream) ?? "");
      const truncated = serializedBody.length > maxBytes;
      const buffer = truncated ? serializedBody.subarray(0, maxBytes) : serializedBody;

      if (serializedBody.length > 0) onFirstChunk?.();

      return { buffer, truncated, bytesRead: serializedBody.length };
    }

    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let bufferedBytes = 0;
    let truncated = false;

    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytesRead === 0 && bufferChunk.length > 0) onFirstChunk?.();
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
    return parseRelayBufferedBody(body, headers);
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
    displayChannelId: string | null;
    displayChannelName: string | null;
    channelId: string;
    monthlyPassCoverageAt: Date;
    inputTokensIncludeCacheRead: boolean;
    contextLengthMultipliers?: ContextLengthMultiplierRule[];
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
    const contextMatch = this.resolveContextMultiplier(
      params.contextLengthMultipliers,
      tokenBreakdown.requestTokens,
      tokenBreakdown.cacheCreationTokens,
      tokenBreakdown.cacheReadTokens,
    );

    const costResult = this.calculateCost(
      tokenBreakdown.requestTokens,
      tokenBreakdown.responseTokens,
      tokenBreakdown.totalTokens,
      selectedRateConfig,
      globalMultiplier * contextMatch.multiplier,
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
      contextTokens: contextMatch.contextTokens,
      contextMultiplier: contextMatch.multiplier,
      contextRuleName: contextMatch.ruleName,
      balanceChargeMode: "allow-negative",
      pricingType: selectedRateConfig?.pricingType as "token-based" | "per-request" | undefined,
      fixedPrice: selectedRateConfig?.fixedPrice,
      originalModel,
    });

    if (!finalizeResult.applied) throw new BadRequestError("Insufficient balance for this request");
  }

  private async forwardImageRequest(
    paramsOrRelayToken: RelayImageForwardParams | RelayToken,
    ...legacyArgs: any[]
  ): Promise<ImageForwardResult> {
    const params: RelayImageForwardParams =
      "req" in (paramsOrRelayToken as object)
        ? (paramsOrRelayToken as RelayImageForwardParams)
        : {
            relayToken: paramsOrRelayToken as RelayToken,
            req: legacyArgs[0],
            res: legacyArgs[1],
            upstreamUrl: legacyArgs[2],
            headers: legacyArgs[3],
            selectedRateConfig: legacyArgs[4],
            selectedModelName: legacyArgs[5],
            selectedModelId: legacyArgs[6],
            globalMultiplier: legacyArgs[7],
            timeMultiplier: legacyArgs[8],
            contextLengthMultipliers: legacyArgs[9],
            convertedBody: legacyArgs[10],
            relayGlobalMultiplier: legacyArgs[11],
            channelMultiplier: legacyArgs[12],
            executionChannelId: legacyArgs[13],
            displayChannelId: legacyArgs[14],
            displayChannelName: legacyArgs[15],
            channelId: legacyArgs[16],
            monthlyPassCoverageAt: legacyArgs[17],
            timeoutMs: legacyArgs[18],
            maxBodyBytes: legacyArgs[19],
            allowRetryBeforeResponse: legacyArgs[20],
            retryStatusCodes: legacyArgs[21],
            inputTokensIncludeCacheRead: legacyArgs[22],
            originalRequestedModel: legacyArgs[23],
            requestFormat: this.getRequestFormat(legacyArgs[0]),
            requestAgents: legacyArgs[24] || directUpstreamAgents,
          };
    return this.relayChannelAttemptService.execute(
      {
        kind: "image",
        image: params,
      },
      { stream: this.createStreamForwarderHost(), image: this.createImageForwarderHost() },
    );
  }

  async forwardRequest(
    relayToken: RelayTokenWithChannel,
    req: any,
    res?: any,
  ): Promise<{ status: number; headers: any; data: any }> {
    const requestStartTime = Date.now();
    const rawJsonBody =
      Buffer.isBuffer(req.body) && String(req.headers?.["content-type"] || "").includes("json") ? req.body : undefined;
    if (rawJsonBody) {
      try {
        req.body = JSON.parse(rawJsonBody.toString("utf8"));
      } catch {
        throw new BadRequestError("Invalid JSON request body");
      }
    }
    const clientRequestFormat = this.getRequestFormat(req);
    const requestFormatTransform =
      clientRequestFormat === "openai-chat-completions" ||
      clientRequestFormat === "openai-responses" ||
      clientRequestFormat === "anthropic"
        ? resolveRelayRequestFormatTransform(relayToken.requestFormatTransforms, clientRequestFormat)
        : undefined;
    const requestFormat = requestFormatTransform?.targetFormat ?? clientRequestFormat;
    const relayConfig = await this.relayConfigService.getRelayConfig();
    const resourceGuard = env.relay.resourceGuard;
    const requestedModel = this.extractRequestedModel(req, clientRequestFormat);
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
    const isImageRequest = this.isImageRequest(req, clientRequestFormat);
    const attemptPlan = await this.buildAttemptPlan(relayToken);

    // Log request details (especially important for image requests)
    logger.info("Relay request received", {
      userId: relayToken.userId,
      model: normalizedRequestedModel,
      format: clientRequestFormat,
      upstreamFormat: requestFormat,
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
    const stickyFailbackCooldownMinutes = attemptPlan.allowStickyFailover ? failoverConfig.failbackCooldownMinutes : 0;
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

    // The requested model may also be an alias that only a channel-level model
    // mapping rewrites to a priced upstream model. Resolve the effective model
    // name for every eligible channel so the token-level checks and the
    // "not configured" guard below account for channel mappings.
    const perChannelMappedModelNames = eligibleChannels.map((candidate) =>
      resolveMappedModel(
        normalizedRequestedModel,
        candidate.resolvedChannel.modelMapping as Record<string, string> | null | undefined,
        relayToken.modelMapping as Record<string, string> | null | undefined,
      ),
    );

    // Find all model configs matching the resolved model ID for pricing purposes
    const candidateModelConfigs = this.resolveRequestedModelConfigs(modelPricing, pricingModelName);
    if (
      candidateModelConfigs.length === 0 &&
      !perChannelMappedModelNames.some(
        (name) => name !== pricingModelName && this.resolveRequestedModelConfigs(modelPricing, name).length > 0,
      )
    )
      throw new BadRequestError(`Model ${normalizedRequestedModel} is not configured`);

    // Use the first candidate for format check (pricing model)
    const firstModelConfig = candidateModelConfigs[0];

    // Token allowedModels check: match against BOTH original and mapped model.
    // A token might allow "gpt-5-codex" directly, or it might allow "deepseek-v4-flash"
    // (the mapped billing model). Either should pass.
    const tokenAllowedModelIds = parseRelayTokenAllowedModelIds(relayToken.allowedModels);
    if (tokenAllowedModelIds.length > 0) {
      // Match against every name the request may be routed as: the original
      // model, the token-level mapped model, and each channel-level mapped model.
      const effectiveModelNames = new Set<string>([
        normalizedRequestedModel,
        pricingModelName,
        ...perChannelMappedModelNames,
      ]);
      const tokenAllowsAny = [...effectiveModelNames].some((name) =>
        this.resolveRequestedModelConfigs(modelPricing, name).some((config) =>
          isModelIdAllowed(tokenAllowedModelIds, config),
        ),
      );
      if (!tokenAllowsAny)
        throw new BadRequestError(
          `Relay token does not allow model ${normalizedRequestedModel}. Allowed models: ${tokenAllowedModelIds.join(", ")}`,
        );
    }

    if (firstModelConfig && !supportsRelayRequestFormat(firstModelConfig.supportedFormats, requestFormat))
      throw new BadRequestError(
        `Model ${normalizedRequestedModel} does not support ${requestFormat} format. Supported formats: ${
          firstModelConfig.supportedFormats || "openai-chat-completions,anthropic,gemini"
        }`,
      );

    const orderedEligibleChannels = await this.prioritizeStickyPreferredChannel({
      relayToken,
      channels: eligibleChannels,
      requestFormat,
      requestedModel: normalizedRequestedModel,
      candidateModelConfigs,
      modelPricing,
      failbackCooldownMinutes: stickyFailbackCooldownMinutes,
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
      let auditInputTokens = 0;
      let auditOutputTokens = 0;
      let auditCost = 0;
      let auditDurationMs = 0;
      const contentSafetyConfig =
        typeof (this.contentSafetyService as any).getEffectivePolicy === "function"
          ? await this.contentSafetyService.getEffectivePolicy(relayToken.userId, relayToken.contentSafetyConfig as any)
          : await this.contentSafetyService.getPublicConfig();
      const auditStats = {
        get inputTokens() {
          return auditInputTokens;
        },
        set inputTokens(value: number) {
          auditInputTokens = value;
        },
        get outputTokens() {
          return auditOutputTokens;
        },
        set outputTokens(value: number) {
          auditOutputTokens = value;
        },
        get cost() {
          return auditCost;
        },
        set cost(value: number) {
          auditCost = value;
        },
        get durationMs() {
          return auditDurationMs;
        },
        set durationMs(value: number) {
          auditDurationMs = value;
        },
      };
      const tokenNormalizerConfig = normalizeRelayTokenNormalizerConfig(relayToken.normalizerConfig);
      let tokenNormalizerRetried = false;
      let tokenNormalizerBody: unknown;
      let relayProxyConfig: Awaited<ReturnType<ConfigService["getRelayProxyConfig"]>> = {
        enabled: false,
        url: "",
      };
      let relayProxyConfigLoaded = false;
      const resolvedBillingDisplayParents = new Map<string, RelayChannel | null>();
      for (let attemptIndex = 0; attemptIndex < attemptChannels.length; attemptIndex++) {
        const candidate = attemptChannels[attemptIndex];
        const nextCandidate = attemptChannels[attemptIndex + 1];
        const channel = candidate.resolvedChannel;
        // The logical pool remains in internal failover diagnostics. Billing snapshots
        // may use the member's sole user-visible pooled parent instead.
        const displayChannel = candidate.displayChannel;
        const billingDisplayChannel = await this.resolveBillingDisplayChannel(
          relayToken,
          channel,
          candidate.billingChannel ?? displayChannel,
          resolvedBillingDisplayParents,
        );
        const usageDisplayChannel =
          relayToken.routingMode === "automatic-pool"
            ? await this.relayChannelService.resolveAutomaticPoolUsageDisplayChannel(channel, relayToken.userId)
            : billingDisplayChannel;
        const usageDisplayChannelId = usageDisplayChannel?.id ?? null;
        const usageDisplayChannelName = usageDisplayChannel?.name || null;
        const nextChannel = nextCandidate?.resolvedChannel;
        const nextDisplayChannel = nextCandidate?.displayChannel;
        const hasNextChannel = Boolean(nextCandidate);

        if (relayToken.routingMode === "automatic-pool")
          this.assertRelayChannelMultiplierAccepted(channel, failoverConfig);

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

          try {
            // Resolve the model config for this specific channel. The requested
            // model may be an alias that the channel-level (or token-level) model
            // mapping rewrites to a priced upstream model, so eligibility is first
            // checked against the effective (mapped) model name.
            const effectiveModelName = resolveMappedModel(
              normalizedRequestedModel,
              channel.modelMapping as Record<string, string> | null | undefined,
              relayToken.modelMapping as Record<string, string> | null | undefined,
            );
            const effectiveModelConfigs =
              effectiveModelName === pricingModelName
                ? candidateModelConfigs
                : this.resolveRequestedModelConfigs(modelPricing, effectiveModelName);
            let channelModelConfig = this.resolveChannelModelConfig(channel, effectiveModelName, effectiveModelConfigs);
            if (!channelModelConfig && effectiveModelName !== normalizedRequestedModel) {
              // Fallback for channels that list the original request model directly.
              channelModelConfig = this.resolveChannelModelConfig(
                channel,
                normalizedRequestedModel,
                candidateModelConfigs,
              );
            }
            this.validateChannelModelConfig(channel, channelModelConfig, effectiveModelName);

            // TypeScript doesn't know that validateChannelModelConfig throws if null
            if (!channelModelConfig) {
              const allowedModelNames = parseRelayChannelAllowedModelNames(channel);
              const allowedModelsStr =
                allowedModelNames && allowedModelNames.length > 0 ? allowedModelNames.join(", ") : "none";
              throw new RelayChannelSkipError(
                `Channel does not support model ${effectiveModelName}. Allowed models: ${allowedModelsStr}`,
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

            // Apply model mapping: resolve effective billing model (computed above)

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
            if (channel.useProxy === true && !relayProxyConfigLoaded) {
              relayProxyConfig = await this.configService.getRelayProxyConfig();
              relayProxyConfigLoaded = true;
            }
            const requestAgents = createUpstreamAgents(channel.useProxy === true, relayProxyConfig);
            const upstreamUrl = upstreamConfig.upstreamUrl;
            let upstreamApiKey = upstreamConfig.upstreamApiKey;
            channelMultiplier =
              billingDisplayChannel.channelType === "pooled"
                ? Number(billingDisplayChannel.multiplier)
                : upstreamConfig.channelMultiplier;

            const monthlyPassCoverageAt = new Date();

            const hasChargeCoverage = await this.usageChargeService.hasCoverageOrPositiveBalance({
              userId: relayToken.userId,
              modelName: selectedModelName,
              channelId: billingDisplayChannel.id,
              at: monthlyPassCoverageAt,
            });

            if (!hasChargeCoverage) throw new RelayChannelSkipError("Insufficient balance", "insufficient-balance");

            relayGlobalMultiplier = relayConfig.globalMultiplier;
            timeMultiplier = computeMultiplierForTime(
              ((billingDisplayChannel as any).timePeriodMultipliers as TimePeriodRule[]) || [],
              new Date(),
            );
            const globalMultiplier = relayGlobalMultiplier * channelMultiplier * timeMultiplier;

            path = requestFormatTransform
              ? requestFormat === "anthropic"
                ? "/v1/messages"
                : requestFormat === "openai-responses"
                  ? "/v1/responses"
                  : "/v1/chat/completions"
              : this.buildUpstreamPath(req.path, requestFormat, selectedModelId);
            path = applyRelayTokenV1PathMode(path, tokenNormalizerConfig.v1PathMode);
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
            else if (this.isOpenAIRequestFormat(requestFormat)) headers["Authorization"] = `Bearer ${upstreamApiKey}`;
            else {
              headers["x-api-key"] = upstreamApiKey;
              headers["anthropic-version"] = "2023-06-01";
            }

            let sourceForwardedBody = this.buildForwardBody(req.body, clientRequestFormat, selectedModelId);
            if (
              Buffer.isBuffer(sourceForwardedBody) &&
              this.isMultipartRequest(req) &&
              selectedModelId !== normalizedRequestedModel
            ) {
              sourceForwardedBody = this.normalizeOpenAIImageEditsMultipartBody(
                sourceForwardedBody,
                clientRequestFormat,
                req.path,
                this.getHeaderValue(req.headers, "content-type"),
                selectedModelId,
              );
            }
            const forwardedBody = this.normalizeOpenAIImageEditsMultipartBody(
              requestFormatTransform
                ? convertRelayRequest(
                    sourceForwardedBody,
                    clientRequestFormat as RelayConvertibleRequestFormat,
                    requestFormat as RelayConvertibleRequestFormat,
                  )
                : sourceForwardedBody,
              requestFormat,
              requestFormatTransform ? path : req.path,
              this.getHeaderValue(req.headers, "content-type"),
            );
            let { body: convertedBody, autoInjected: autoInjectedStreamUsageOption } = this.addOpenAIStreamUsageOption(
              forwardedBody,
              requestFormat,
              req.path,
            );
            if (
              rawJsonBody &&
              !requestFormatTransform &&
              selectedModelId === normalizedRequestedModel &&
              !autoInjectedStreamUsageOption
            )
              convertedBody = rawJsonBody;
            if (tokenNormalizerBody !== undefined) convertedBody = tokenNormalizerBody;
            else if (requestFormat === "anthropic") {
              convertedBody = normalizeAnthropicRequestBeforeSend(
                convertedBody,
                selectedModelId,
                tokenNormalizerConfig,
              );
            }

            // Enforce request-side content safety after all format/model transforms.
            if (!Buffer.isBuffer(convertedBody)) {
              const requestSafetyText =
                typeof convertedBody === "string" ? convertedBody : JSON.stringify(convertedBody);
              const requestSafety = await this.contentSafetyService.evaluate("request", requestSafetyText, {
                userId: relayToken.userId,
                tokenConfig: relayToken.contentSafetyConfig as any,
              });
              auditInputTokens += requestSafety.auditInputTokens;
              auditOutputTokens += requestSafety.auditOutputTokens;
              auditCost += requestSafety.auditCost;
              auditDurationMs += requestSafety.auditDurationMs;
              if (requestSafety.matched) {
                await this.contentSafetyService.recordIncident({
                  userId: relayToken.userId,
                  relayTokenId: relayToken.id,
                  requestId: this.getLogicalRequestId(req),
                  direction: "request",
                  evaluation: requestSafety,
                  model: selectedModelName,
                  channelId: channel.id,
                  request: req,
                });
                if (requestSafety.action === "unreachable") throw new ContentSafetyBlockedError();
                if (requestSafety.action === "blackhole") {
                  try {
                    convertedBody =
                      typeof convertedBody === "string" ? requestSafety.text : JSON.parse(requestSafety.text);
                  } catch {
                    throw new ContentSafetyBlockedError();
                  }
                }
              }
            }

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

            if (env.runtime.isDevelopment)
              logger.debug("Final request body to upstream API", {
                body: JSON.stringify(convertedBody, null, 2),
              });

            if (isStreamRequested && res) {
              upstreamRequestStarted = true;
              const streamResult = await this.relayChannelProbeLockService.withRead(channel.id, () =>
                this.forwardStreamRequest({
                  relayToken,
                  req,
                  res,
                  upstreamUrl: fullUpstreamUrl,
                  headers,
                  selectedRateConfig: selectedRateConfig!,
                  selectedModelName,
                  selectedModelId,
                  globalMultiplier,
                  timeMultiplier,
                  contextLengthMultipliers: billingDisplayChannel.contextLengthMultipliers as unknown as
                    | ContextLengthMultiplierRule[]
                    | undefined,
                  convertedBody,
                  requestFormat,
                  relayGlobalMultiplier,
                  channelMultiplier,
                  executionChannelId: channel.id,
                  displayChannelId: usageDisplayChannelId,
                  displayChannelName: usageDisplayChannelName,
                  channelId: channel.id,
                  monthlyPassCoverageAt,
                  upstreamStreamTimeout: relayConfig.upstreamStreamTimeout,
                  allowRetryBeforeResponse: hasNextChannel && failoverConfig.enabled,
                  retryStatusCodes: failoverConfig.retryStatusCodes,
                  inputTokensIncludeCacheRead: billingDisplayChannel.inputTokensIncludeCacheRead !== false,
                  originalRequestedModel: relayOriginalRequestedModel,
                  autoInjectedStreamUsageOption,
                  responseTransform: requestFormatTransform
                    ? {
                        sourceFormat: requestFormatTransform.targetFormat,
                        targetFormat: clientRequestFormat as RelayConvertibleRequestFormat,
                      }
                    : undefined,
                  tokenNormalizerConfig,
                  tokenNormalizerRetried,
                  requestAgents,
                  responseAiEnabled: Boolean(
                    contentSafetyConfig.responseEnabled && contentSafetyConfig.responseAiEnabled,
                  ),
                  auditStats,
                }),
              );

              if (!streamResult.handled && hasNextChannel) {
                const isEmptyStreamFailure = streamResult.triggerError?.startsWith("upstream stream");
                if (isEmptyStreamFailure)
                  await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                    channel,
                    request: req,
                    statusCode: streamResult.statusCode,
                  });
                if (!isLastAttemptForThisChannel) {
                  // Threshold not yet exhausted — retry the same channel
                  lastError = new Error(streamResult.triggerError || `HTTP ${streamResult.statusCode || 502}`);
                  continue;
                }
                // Threshold exhausted — record failure and switch to next channel
                if (!isEmptyStreamFailure)
                  await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                    channel,
                    request: req,
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
                  failbackCooldownMinutes: stickyFailbackCooldownMinutes,
                  allowStickyFailover: attemptPlan.allowStickyFailover,
                });
                channelSwitched = true;
                break;
              }

              if (!streamResult.handled) {
                throw new Error(streamResult.triggerError || `HTTP ${streamResult.statusCode || 502}`);
              }

              if (streamResult.clientDisconnected)
                return { status: streamResult.statusCode || 200, headers: {}, data: {} };

              await this.recordChannelAttempt(relayToken.id, channel.id, streamResult.success, {
                channel,
                request: req,
                latencyMs: streamResult.timeToFirstByte,
                statusCode: streamResult.statusCode ?? (streamResult.success ? 200 : undefined),
              });

              return { status: streamResult.statusCode || 200, headers: {}, data: {} };
            }

            const startTime = Date.now();

            // 对图片请求使用流式响应，避免将大图片完整读入内存
            const isImageRequest = this.isImageRequest(req, requestFormat);
            if (isImageRequest && res) {
              upstreamRequestStarted = true;
              const imageResult = await this.relayChannelProbeLockService.withRead(channel.id, () =>
                this.forwardImageRequest({
                  relayToken,
                  req,
                  res,
                  upstreamUrl: fullUpstreamUrl,
                  headers,
                  selectedRateConfig: selectedRateConfig!,
                  selectedModelName,
                  selectedModelId,
                  globalMultiplier,
                  timeMultiplier,
                  contextLengthMultipliers: billingDisplayChannel.contextLengthMultipliers as unknown as
                    | ContextLengthMultiplierRule[]
                    | undefined,
                  convertedBody,
                  relayGlobalMultiplier,
                  channelMultiplier,
                  executionChannelId: channel.id,
                  displayChannelId: usageDisplayChannelId,
                  displayChannelName: usageDisplayChannelName,
                  channelId: channel.id,
                  monthlyPassCoverageAt,
                  timeoutMs: resourceGuard.nonStreamUpstreamTimeoutMs,
                  maxBodyBytes: resourceGuard.imageResponseBodyLimitMb * 1024 * 1024,
                  allowRetryBeforeResponse: hasNextChannel && failoverConfig.enabled,
                  retryStatusCodes: failoverConfig.retryStatusCodes,
                  inputTokensIncludeCacheRead: billingDisplayChannel.inputTokensIncludeCacheRead !== false,
                  originalRequestedModel: relayOriginalRequestedModel,
                  requestFormat,
                  requestAgents,
                }),
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
                  failbackCooldownMinutes: stickyFailbackCooldownMinutes,
                  allowStickyFailover: attemptPlan.allowStickyFailover,
                });
                channelSwitched = true;
                break;
              }

              await this.recordChannelAttempt(relayToken.id, channel.id, imageResult.success, {
                channel,
                request: req,
                latencyMs: imageResult.timeToFirstByte,
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
            let firstPayloadTime: number | null = null;
            const maxResponseBytes = resourceGuard.maxUpstreamResponseBodyMb * 1024 * 1024;
            const upstreamBody = this.buildForwardBodyBuffer(convertedBody);
            delete headers["content-length"];
            delete headers["Content-Length"];
            headers["Content-Length"] = upstreamBody.length;
            const response = await this.relayChannelProbeLockService.withRead(channel.id, () =>
              axios({
                method: req.method,
                url: fullUpstreamUrl,
                headers,
                data: upstreamBody,
                params: req.query,
                timeout: resourceGuard.nonStreamUpstreamTimeoutMs,
                maxBodyLength: maxBodyLimitBytes,
                maxContentLength: maxResponseBytes,
                responseType: "stream",
                validateStatus: () => true,
                proxy: false,
                httpAgent: requestAgents.httpAgent,
                httpsAgent: requestAgents.httpsAgent,
              }),
            );
            const streamedResponse = await this.readStreamBodyLimited(
              response.data as Readable,
              maxResponseBytes,
              () => {
                if (firstPayloadTime === null) firstPayloadTime = Date.now();
              },
            );
            if (streamedResponse.truncated)
              throw new PayloadTooLargeError(
                `Upstream response body exceeds ${resourceGuard.maxUpstreamResponseBodyMb}MB`,
              );
            response.data = this.parseBufferedUpstreamBody(streamedResponse.buffer, response.headers || {});
            if (typeof response.data === "string" || (response.data && typeof response.data === "object")) {
              const responseSafetyText =
                typeof response.data === "string" ? response.data : JSON.stringify(response.data);
              const responseSafety = await this.contentSafetyService.evaluate("response", responseSafetyText, {
                userId: relayToken.userId,
                tokenConfig: relayToken.contentSafetyConfig as any,
              });
              auditInputTokens += responseSafety.auditInputTokens;
              auditOutputTokens += responseSafety.auditOutputTokens;
              auditCost += responseSafety.auditCost;
              auditDurationMs += responseSafety.auditDurationMs;
              if (responseSafety.matched) {
                await this.contentSafetyService.recordIncident({
                  userId: relayToken.userId,
                  relayTokenId: relayToken.id,
                  requestId: this.getLogicalRequestId(req),
                  direction: "response",
                  evaluation: responseSafety,
                  model: selectedModelName,
                  channelId: channel.id,
                  statusCode: response.status,
                  request: req,
                });
                if (responseSafety.action === "unreachable") throw new ContentSafetyBlockedError();
                if (responseSafety.action === "blackhole") {
                  try {
                    response.data =
                      typeof response.data === "string" ? responseSafety.text : JSON.parse(responseSafety.text);
                  } catch {
                    throw new ContentSafetyBlockedError();
                  }
                }
              }
            }
            const firstByteTime = firstPayloadTime ?? Date.now();
            const isErrorResponse = response.status >= 400;

            if (isErrorResponse && requestFormat === "anthropic" && !tokenNormalizerRetried) {
              const rectified = rectifyAnthropicRequestForError(
                convertedBody,
                this.extractUpstreamErrorMessage(response.data, response.status),
                tokenNormalizerConfig,
              );
              if (rectified.changed) {
                tokenNormalizerRetried = true;
                tokenNormalizerBody = rectified.body;
                // Re-run the same channel request without consuming a failover attempt.
                channelAttempt -= 1;
                continue;
              }
            }

            if (
              isErrorResponse &&
              !tokenNormalizerRetried &&
              this.shouldRetryWithNextChannel(response.status, failoverConfig, hasNextChannel, response.data)
            ) {
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
                displayChannelId: usageDisplayChannelId,
                displayChannelName: usageDisplayChannelName,
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
                failbackCooldownMinutes: stickyFailbackCooldownMinutes,
                allowStickyFailover: attemptPlan.allowStickyFailover,
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
                displayChannelId: usageDisplayChannelId,
                displayChannelName: usageDisplayChannelName,
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
                data: requestFormatTransform
                  ? convertRelayError(buildNormalizedError(), clientRequestFormat as RelayConvertibleRequestFormat)
                  : buildNormalizedError(),
              };
            }

            const { requestTokens, responseTokens, totalTokens, cacheCreationTokens, cacheReadTokens } =
              this.calculateTokens(
                convertedBody,
                response.data,
                billingDisplayChannel.inputTokensIncludeCacheRead !== false,
              );

            // A 2xx response containing only usage/metadata (or tool-control frames) is not a
            // successful model response. Treat it as an upstream failure while the response is
            // still buffered so the next channel can be attempted transparently.
            const hasVisibleOutput = hasVisibleRelayResponseOutput(response.data, requestFormat);
            if (!hasVisibleOutput) {
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
                displayChannelId: usageDisplayChannelId,
                displayChannelName: usageDisplayChannelName,
                channelMultiplier,
                relayGlobalMultiplier,
                timeMultiplier,
                originalModel: relayOriginalRequestedModel,
              });
              if (hasNextChannel && failoverConfig.enabled) {
                if (!isLastAttemptForThisChannel) {
                  lastError = new Error("upstream response ended without visible output");
                  continue;
                }
                await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                  channel,
                  request: req,
                  statusCode: response.status,
                });
                this.appendAttemptIssue(
                  attemptIssues,
                  displayChannel,
                  attemptIndex + 1,
                  "upstream response ended without visible output",
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
                  triggerError: "upstream response ended without visible output",
                  attemptNumber: attemptIndex + 1,
                  requestPath: req.path,
                  method: req.method,
                  modelName: selectedModelName,
                  requestFormat,
                  requestedModel: normalizedRequestedModel,
                  failbackCooldownMinutes: stickyFailbackCooldownMinutes,
                  allowStickyFailover: attemptPlan.allowStickyFailover,
                });
                channelSwitched = true;
                break;
              }
              throw new Error("upstream response ended without visible output");
            }

            // Mark the attempt successful only after confirming that the upstream
            // response contains visible model content. A 2xx usage/metadata-only
            // response must remain eligible for channel failure accounting and
            // failover in the surrounding error handler.
            upstreamResponseSucceeded = true;

            logger.info("Cache metrics", {
              cacheCreationTokens,
              cacheReadTokens,
              cacheHit: cacheReadTokens > 0,
              cacheCreated: cacheCreationTokens > 0,
              requestTokens,
              responseTokens,
              rawUsage: response.data?.usage,
            });

            const contextMatch = this.resolveContextMultiplier(
              billingDisplayChannel.contextLengthMultipliers as unknown as ContextLengthMultiplierRule[] | undefined,
              requestTokens,
              cacheCreationTokens,
              cacheReadTokens,
            );

            const {
              cost: businessCost,
              inputRate,
              outputRate,
            } = this.calculateCost(
              requestTokens,
              responseTokens,
              totalTokens,
              rateConfig,
              globalMultiplier * contextMatch.multiplier,
              cacheCreationTokens,
              cacheReadTokens,
              cacheCreationMult,
              cacheReadMult,
            );
            const cost = businessCost + auditCost;

            const totalOutputTime = Math.max(0, Date.now() - startTime - auditDurationMs);
            const timeToFirstByte = Math.max(0, firstByteTime - startTime - auditDurationMs);

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
              displayChannelId: usageDisplayChannelId,
              displayChannelName: usageDisplayChannelName,
              monthlyPassCoverageAt,
              inputRate,
              outputRate,
              multiplier: modelMult,
              cacheCreationMultiplier: cacheCreationMult,
              cacheReadMultiplier: cacheReadMult,
              channelMultiplier,
              globalMultiplier: relayGlobalMultiplier,
              timeMultiplier,
              contextTokens: contextMatch.contextTokens,
              contextMultiplier: contextMatch.multiplier,
              contextRuleName: contextMatch.ruleName,
              balanceChargeMode: "allow-negative",
              pricingType: rateConfig?.pricingType as "token-based" | "per-request" | undefined,
              fixedPrice: rateConfig?.fixedPrice,
              originalModel: relayOriginalRequestedModel,
              auditInputTokens,
              auditOutputTokens,
              auditTotalTokens: auditInputTokens + auditOutputTokens,
              auditCost,
              auditDurationMs,
            });

            if (!finalizeResult.applied) throw new BadRequestError("Insufficient balance for this request");

            await this.recordChannelAttempt(relayToken.id, channel.id, true, {
              channel,
              request: req,
              latencyMs: firstPayloadTime === null ? undefined : firstPayloadTime - startTime,
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
              data: requestFormatTransform
                ? convertRelayResponse(
                    response.data,
                    requestFormat as RelayConvertibleRequestFormat,
                    clientRequestFormat as RelayConvertibleRequestFormat,
                  )
                : response.data,
            };
          } catch (error) {
            lastError = error;

            if (
              error instanceof ContentSafetyBlockedError &&
              auditCost > 0 &&
              selectedRateConfig &&
              selectedModelName
            ) {
              try {
                await this.usageChargeService.chargeUsage({
                  userId: relayToken.userId,
                  relayTokenId: relayToken.id,
                  requestId: this.getLogicalRequestId(req),
                  requestTokens: 0,
                  responseTokens: 0,
                  totalTokens: 0,
                  cacheCreationTokens: 0,
                  cacheReadTokens: 0,
                  path: path || req.path,
                  method: req.method,
                  statusCode: 403,
                  ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
                  totalOutputTime: Math.max(0, Date.now() - requestStartTime - auditDurationMs),
                  timeToFirstByte: Math.max(0, Date.now() - requestStartTime - auditDurationMs),
                  isStreaming: false,
                  cost: auditCost,
                  modelName: selectedModelName,
                  modelId: selectedModelId,
                  channelId: channel.id,
                  executionChannelId: channel.id,
                  displayChannelId: usageDisplayChannelId,
                  displayChannelName: usageDisplayChannelName,
                  monthlyPassCoverageAt: new Date(),
                  inputRate: Number(selectedRateConfig.input || 0),
                  outputRate: Number(selectedRateConfig.output || 0),
                  multiplier: Number(selectedRateConfig.multiplier || 1),
                  cacheCreationMultiplier: Number(
                    selectedRateConfig.cacheCreationMultiplier || DEFAULT_CACHE_CREATION_MULTIPLIER,
                  ),
                  cacheReadMultiplier: Number(selectedRateConfig.cacheReadMultiplier || DEFAULT_CACHE_READ_MULTIPLIER),
                  channelMultiplier,
                  globalMultiplier: relayGlobalMultiplier,
                  timeMultiplier,
                  balanceChargeMode: "allow-negative",
                  pricingType: selectedRateConfig.pricingType,
                  fixedPrice: selectedRateConfig.fixedPrice,
                  auditInputTokens,
                  auditOutputTokens,
                  auditTotalTokens: auditInputTokens + auditOutputTokens,
                  auditCost,
                  auditDurationMs,
                });
              } catch {
                /* billing failure does not disclose safety details */
              }
            }

            const canRetryCurrentAttempt =
              !isStreamRequested || !res || (!res.headersSent && !res.writableEnded && !res.finished);

            if (
              !tokenNormalizerRetried &&
              hasNextChannel &&
              canRetryCurrentAttempt &&
              this.isFallbackEligibleLocalError(error)
            ) {
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
                displayChannelId: usageDisplayChannelId,
                displayChannelName: usageDisplayChannelName,
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
                failbackCooldownMinutes: stickyFailbackCooldownMinutes,
                allowStickyFailover: attemptPlan.allowStickyFailover,
              });
              channelSwitched = true;
              break;
            }

            if (!tokenNormalizerRetried && canRetryCurrentAttempt && this.isFallbackEligibleLocalError(error)) {
              this.appendAttemptIssue(attemptIssues, displayChannel, attemptIndex + 1, error.message);
              throw this.buildAttemptExhaustedError(
                normalizedRequestedModel,
                failoverConfig.maxRetries,
                attemptIssues,
                error,
              );
            }

            if (
              !tokenNormalizerRetried &&
              hasNextChannel &&
              canRetryCurrentAttempt &&
              this.shouldFailoverOnError(error)
            ) {
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
                failbackCooldownMinutes: stickyFailbackCooldownMinutes,
                allowStickyFailover: attemptPlan.allowStickyFailover,
              });
              channelSwitched = true;
              break;
            }

            if (
              !tokenNormalizerRetried &&
              !isStreamRequested &&
              canRetryCurrentAttempt &&
              this.shouldFailoverOnError(error)
            ) {
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
                });
              throw this.buildAttemptExhaustedError(
                normalizedRequestedModel,
                failoverConfig.maxRetries,
                attemptIssues,
                error,
              );
            }

            if (!tokenNormalizerRetried && isStreamRequested && res && this.shouldFailoverOnError(error)) {
              if (!upstreamResponseSucceeded)
                await this.recordChannelAttempt(relayToken.id, channel.id, false, {
                  channel,
                  request: req,
                  attemptedUpstream: upstreamRequestStarted,
                });
              this.sendStreamTransportError(res, error);
              return {
                status:
                  error instanceof ContentSafetyBlockedError ? 403 : error instanceof GatewayTimeoutError ? 504 : 502,
                headers: {},
                data: {},
              };
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
    return this.relayUsageBillingService.calculateCost({
      requestTokens,
      responseTokens,
      totalTokens,
      rateConfig,
      globalMultiplier,
      cacheCreationTokens,
      cacheReadTokens,
      cacheCreationMultiplier,
      cacheReadMultiplier,
    });
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
        const processedInputTokens = resolveFreshInputTokens(
          usage.inputTokens,
          usage.cacheReadTokens,
          usage.cacheCreationTokens,
          inputTokensIncludeCacheRead,
        );

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

    // Gemini format: usageMetadata uses the same cache-inclusive input semantics.
    if (resBody?.usageMetadata && typeof resBody.usageMetadata === "object") {
      const usage = extractTokenUsageMetrics(resBody.usageMetadata);
      const hasUsageTokens = usage.totalTokens > 0 || usage.inputTokens > 0 || usage.outputTokens > 0;
      if (hasUsageTokens) {
        const hasExplicitInputTokens = hasTokenValue(resBody.usageMetadata.promptTokenCount);
        const processedInputTokens = resolveFreshInputTokens(
          usage.inputTokens,
          usage.cacheReadTokens,
          usage.cacheCreationTokens,
          inputTokensIncludeCacheRead,
        );
        const normalizedGeminiTokens = normalizeTokenBreakdown(
          processedInputTokens,
          usage.outputTokens,
          usage.totalTokens,
          hasExplicitInputTokens ? 0 : requestTokens,
        );

        return {
          requestTokens: normalizedGeminiTokens.requestTokens,
          responseTokens: normalizedGeminiTokens.responseTokens,
          totalTokens: normalizedGeminiTokens.totalTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          cacheReadTokens: usage.cacheReadTokens,
        };
      }
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
    paramsOrRelayToken: RelayStreamForwardParams | RelayToken,
    ...legacyArgs: any[]
  ): Promise<StreamForwardResult> {
    const params: RelayStreamForwardParams =
      "req" in (paramsOrRelayToken as object)
        ? (paramsOrRelayToken as RelayStreamForwardParams)
        : {
            relayToken: paramsOrRelayToken as RelayToken,
            req: legacyArgs[0],
            res: legacyArgs[1],
            upstreamUrl: legacyArgs[2],
            headers: legacyArgs[3],
            selectedRateConfig: legacyArgs[4],
            selectedModelName: legacyArgs[5],
            selectedModelId: legacyArgs[6],
            globalMultiplier: legacyArgs[7],
            timeMultiplier: legacyArgs[8],
            contextLengthMultipliers: legacyArgs[9],
            convertedBody: legacyArgs[10],
            requestFormat: legacyArgs[11],
            relayGlobalMultiplier: legacyArgs[12],
            channelMultiplier: legacyArgs[13],
            executionChannelId: legacyArgs[14],
            displayChannelId: legacyArgs[15],
            displayChannelName: legacyArgs[16],
            channelId: legacyArgs[17],
            monthlyPassCoverageAt: legacyArgs[18],
            upstreamStreamTimeout: legacyArgs[19],
            allowRetryBeforeResponse: legacyArgs[20] ?? false,
            retryStatusCodes: legacyArgs[21] ?? [],
            inputTokensIncludeCacheRead: legacyArgs[22] ?? true,
            originalRequestedModel: legacyArgs[23],
            autoInjectedStreamUsageOption: legacyArgs[24] ?? false,
            responseTransform: legacyArgs[25],
            tokenNormalizerConfig: legacyArgs[26] ?? normalizeRelayTokenNormalizerConfig(undefined),
            tokenNormalizerRetried: legacyArgs[27] ?? false,
            requestAgents: legacyArgs[28] || directUpstreamAgents,
            responseAiEnabled: legacyArgs[29] ?? false,
            auditStats: legacyArgs[30],
          };
    return this.relayChannelAttemptService.execute(
      {
        kind: "stream",
        stream: params,
      },
      { stream: this.createStreamForwarderHost(), image: this.createImageForwarderHost() },
    );
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
    const contextTokens = data.contextTokens;
    const contextMultiplier = data.contextMultiplier;
    const contextRuleName = data.contextRuleName;

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
      contextTokens,
      contextMultiplier,
      contextRuleName,
      balanceChargeMode: "allow-negative",
      pricingType: data.pricingType,
      fixedPrice: data.fixedPrice,
      originalModel: data.originalModel,
      auditInputTokens: data.auditInputTokens,
      auditOutputTokens: data.auditOutputTokens,
      auditTotalTokens: data.auditTotalTokens,
      auditCost: data.auditCost,
      auditDurationMs: data.auditDurationMs,
    });

    if (!finalizeResult.applied) throw new BadRequestError("Unable to finalize relay usage");
  }
}
