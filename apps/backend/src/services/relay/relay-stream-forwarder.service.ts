import { StringDecoder } from "node:string_decoder";
import { env } from "@/config/env";
import { aiResourceContext, aiAbortError } from "@/services/infrastructure/ai-resource.service";
import { BoundedTextLines } from "@/util/streaming/bounded-text";
import { writeWithBackpressure } from "@/util/streaming/backpressure";
import { consumeCompositeAttempt, getCompositeContext } from "./relay-composite-executor.service";
import { beginAIRequestAttempt, recordAIRequestAttempt, recordAIRequestFailure } from "@/util/ai-request-log-context";
import http from "http";
import https from "https";
import type { RelayToken } from "@prisma/client";
import type { RelayProxyStore } from "@/store/relay/relay-proxy.store";
import { trackErrorForIp } from "@/middleware/error-tracker";
import { BadRequestError, ContentSafetyBlockedError, GatewayTimeoutError, PayloadTooLargeError } from "@/util/errors";
import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER } from "@/constant/pricing";
import { consumeRelayStreamUsageLine, RelayStreamUsageTracker } from "@/util/relay";
import { convertRelayError, RelaySseFormatTransform } from "./relay-request-format-transform.service";
import { shouldRetryRelayUpstreamFailure } from "@/util/relay";
import {
  normalizeRelayTokenNormalizerConfig,
  rectifyAnthropicRequestForError,
  type RelayTokenNormalizerConfig,
} from "@/util/anthropic-token-normalizer.util";
import type { ContextLengthMultiplierRule, ContextLengthMultiplierMatch } from "./context-length-multiplier.service";
import type { RelayConvertibleRequestFormat } from "@quyan/shared";
import type {
  RelayRequestLike,
  RelayResponseLike,
  RelayStreamForwardParams,
  StreamForwardResult,
  RelayUpstreamAgents,
} from "./types/relay-proxy.types";
import type { RelayRequestFormat } from "@/util/relay";
import logger from "@/util/logger";

export interface RelayStreamForwarderHost {
  contentSafetyService: any;
  relayProxyRepository: RelayProxyStore;
  systemPreflightBufferLimitBytes?: number;
  streamFrameLimitBytes?: number;
  finalizeStreamUsage: (relayToken: any, data: any) => Promise<void>;
  calculateCost: (...args: any[]) => any;
  resolveContextMultiplier: (
    rules: ContextLengthMultiplierRule[] | undefined,
    requestTokens: number,
    cacheCreationTokens: number,
    cacheReadTokens: number,
  ) => ContextLengthMultiplierMatch;
  getLogicalRequestId: (req: RelayRequestLike) => string;
  isPerRequestPricingConfig: (rateConfig: any) => boolean;
  removeAutoInjectedOpenAIStreamUsageOption: (body: any) => any;
  sendStreamTransportError: (res: RelayResponseLike, error: unknown) => void;
  shouldFailoverOnError: (error: unknown) => boolean;
  withRequestIdHeader: (req: RelayRequestLike, headers: Record<string, unknown>) => Record<string, unknown>;
  forwardStreamRequest?: (...args: any[]) => Promise<StreamForwardResult>;
}

const directUpstreamAgents: RelayUpstreamAgents = {
  httpAgent: new http.Agent({ keepAlive: true, ...env.aiResources.http, timeout: 60000, scheduling: "lifo" }),
  httpsAgent: new https.Agent({
    keepAlive: true,
    ...env.aiResources.http,
    timeout: 60000,
    scheduling: "lifo",
  }),
};

const buildRelayForwardBodyBuffer = (body: unknown): Buffer =>
  Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body ?? {}));

const destroyRelayUpstreamResponse = (response: any, error?: Error): void => {
  if (typeof response?.destroy === "function") response.destroy(error);
  else if (typeof response?.resume === "function") response.resume();
};

export class RelayStreamForwarderService {
  async forward(
    params: RelayStreamForwardParams,
    host: Omit<RelayStreamForwarderHost, "forwardStreamRequest">,
  ): Promise<StreamForwardResult> {
    const requestAgents = params.requestAgents || directUpstreamAgents;
    const forwardHost: RelayStreamForwarderHost = {
      ...host,
      forwardStreamRequest: (...args: any[]) => this.forwardLegacy.apply(this, [...args, forwardHost] as any),
    };
    return this.forwardLegacy(
      params.relayToken,
      params.req,
      params.res,
      params.upstreamUrl,
      params.headers,
      params.selectedRateConfig,
      params.selectedModelName,
      params.selectedModelId,
      params.globalMultiplier,
      params.timeMultiplier,
      params.contextLengthMultipliers,
      params.convertedBody,
      params.requestFormat,
      params.relayGlobalMultiplier,
      params.channelMultiplier,
      params.executionChannelId,
      params.displayChannelId,
      params.displayChannelName,
      params.channelId,
      params.monthlyPassCoverageAt,
      params.upstreamStreamTimeout,
      params.allowRetryBeforeResponse ?? false,
      params.retryStatusCodes ?? [],
      params.inputTokensIncludeCacheRead ?? true,
      params.originalRequestedModel,
      params.autoInjectedStreamUsageOption ?? false,
      params.responseTransform,
      params.tokenNormalizerConfig as RelayTokenNormalizerConfig | undefined,
      params.tokenNormalizerRetried ?? false,
      requestAgents,
      params.responseAiEnabled ?? false,
      params.auditStats,
      forwardHost,
    );
  }

  private async forwardLegacy(
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
    contextLengthMultipliers: ContextLengthMultiplierRule[] | undefined,
    convertedBody: any,
    requestFormat: RelayRequestFormat,
    relayGlobalMultiplier: number = globalMultiplier,
    channelMultiplier: number = 1,
    executionChannelId: string,
    displayChannelId: string | null,
    displayChannelName: string | null,
    channelId: string,
    monthlyPassCoverageAt: Date,
    upstreamStreamTimeout: number,
    allowRetryBeforeResponse: boolean = false,
    retryStatusCodes: string[] = [],
    inputTokensIncludeCacheRead: boolean = true,
    originalRequestedModel?: string,
    autoInjectedStreamUsageOption: boolean = false,
    responseTransform?: { sourceFormat: RelayConvertibleRequestFormat; targetFormat: RelayConvertibleRequestFormat },
    tokenNormalizerConfig: RelayTokenNormalizerConfig = normalizeRelayTokenNormalizerConfig(undefined),
    tokenNormalizerRetried = false,
    requestAgents: RelayUpstreamAgents = directUpstreamAgents,
    responseAiEnabled = false,
    auditStats?: { inputTokens: number; outputTokens: number; cost: number; durationMs: number },
    host: RelayStreamForwarderHost = undefined as unknown as RelayStreamForwarderHost,
  ): Promise<StreamForwardResult> {
    const url = new URL(upstreamUrl);
    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? https : http;

    // 序列化一次，复用同一个 Buffer（避免两次 JSON.stringify）
    const bodyData = buildRelayForwardBodyBuffer(convertedBody);

    const streamUsage = new RelayStreamUsageTracker(Math.ceil(bodyData.length / 4), inputTokensIncludeCacheRead);

    const cleanHeaders = { ...headers };
    delete cleanHeaders["host"];
    delete cleanHeaders["content-length"];
    delete cleanHeaders["connection"];
    delete cleanHeaders["transfer-encoding"];
    cleanHeaders["Content-Length"] = bodyData.length;

    const startTime = Date.now();
    const auditResponse = req.res ?? (res as Parameters<typeof beginAIRequestAttempt>[0]);
    beginAIRequestAttempt(auditResponse);
    let auditRecorded = false;
    const auditAttempt = (success: boolean, statusCode?: number, error?: unknown) => {
      if (auditRecorded) return;
      auditRecorded = true;
      recordAIRequestAttempt(auditResponse, { success, statusCode, durationMs: Date.now() - startTime, error });
    };
    const stats = auditStats || { inputTokens: 0, outputTokens: 0, cost: 0, durationMs: 0 };
    let firstByteTime: number | null = null;

    let clientDisconnected = false; // 标记客户端是否已断开

    return new Promise((resolve, reject) => {
      let timedOut = false;
      let proxyReq: http.ClientRequest;
      let failActiveStream: ((error: Error) => void) | undefined;

      consumeCompositeAttempt(req);
      proxyReq = httpModule.request(
        {
          signal: getCompositeContext(req)?.signal ?? aiResourceContext.getStore()?.signal,
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: req.method,
          headers: cleanHeaders,
          timeout: upstreamStreamTimeout,
          agent: isHttps ? requestAgents.httpsAgent : requestAgents.httpAgent,
        },
        (proxyRes) => {
          if (getCompositeContext(req)) getCompositeContext(req)!.lastUpstreamStatus = proxyRes.statusCode;
          const streamStatusCode = proxyRes.statusCode || 200;
          const isStreamErrorResponse = streamStatusCode >= 400;

          const responseHeaders = { ...proxyRes.headers };
          delete responseHeaders["content-length"];
          delete responseHeaders["transfer-encoding"];

          // For error responses we buffer the whole body so we can build a
          // normalized error message; we do NOT pipe chunks straight through.
          if (isStreamErrorResponse) {
            const rawChunks: Buffer[] = [];
            const maxErrorBodyBytes = env.aiRequestLog.responseBodyBytes;
            let totalSize = 0;

            proxyRes.on("data", (chunk: Buffer) => {
              if (firstByteTime === null) firstByteTime = Date.now();

              // Prevent unbounded memory growth from large error responses
              if (totalSize + chunk.length > maxErrorBodyBytes) {
                rawChunks.length = 0;
                destroyRelayUpstreamResponse(
                  proxyRes,
                  new PayloadTooLargeError("Upstream error body exceeds resource budget", undefined, {
                    messageKey: "relayProxy.aiContentTooLarge",
                  }),
                );
                return;
              }

              rawChunks.push(chunk);
              totalSize += chunk.length;
            });

            proxyRes.on("end", async () => {
              try {
                auditAttempt(false, streamStatusCode, Buffer.concat(rawChunks).toString("utf8"));

                if (autoInjectedStreamUsageOption && !res.headersSent && [400, 422].includes(streamStatusCode)) {
                  const retryBody = host.removeAutoInjectedOpenAIStreamUsageOption(convertedBody);
                  resolve(
                    await host.forwardStreamRequest!(
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
                      contextLengthMultipliers,
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
                      responseTransform,
                      tokenNormalizerConfig,
                      tokenNormalizerRetried,
                      requestAgents,
                      responseAiEnabled,
                      stats,
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

                auditAttempt(false, streamStatusCode, upstreamData ?? "Upstream request failed");
                const upstreamMessage =
                  upstreamData?.error?.message ||
                  upstreamData?.message ||
                  (typeof upstreamData === "string" ? upstreamData : null) ||
                  null;

                if (!res.headersSent && !tokenNormalizerRetried && requestFormat === "anthropic") {
                  const rectified = rectifyAnthropicRequestForError(
                    convertedBody,
                    upstreamMessage || upstreamData,
                    tokenNormalizerConfig,
                  );
                  if (rectified.changed) {
                    resolve(
                      await host.forwardStreamRequest!(
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
                        contextLengthMultipliers,
                        rectified.body,
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
                        responseTransform,
                        tokenNormalizerConfig,
                        true,
                        requestAgents,
                        responseAiEnabled,
                        stats,
                      ),
                    );
                    return;
                  }
                }

                if (
                  !tokenNormalizerRetried &&
                  allowRetryBeforeResponse &&
                  shouldRetryRelayUpstreamFailure(streamStatusCode, upstreamData, retryStatusCodes)
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

                const normalizedBody = JSON.stringify(
                  responseTransform
                    ? convertRelayError(normalizedError, responseTransform.targetFormat)
                    : normalizedError,
                );
                res.writeHead(
                  streamStatusCode,
                  host.withRequestIdHeader(req, {
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
                  pricingType: host.isPerRequestPricingConfig(rateConfig) ? "per-request" : "token-based",
                  statusCode: streamStatusCode,
                });

                await host.relayProxyRepository.recordUsageWithZeroChargeTransaction({
                  userId: relayToken.userId,
                  relayTokenId: relayToken.id,
                  compositionTokenIds: getCompositeContext(relayToken)?.path.map((token) => token.id),
                  requestId: host.getLogicalRequestId(req),
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
                  inputRate: host.isPerRequestPricingConfig(rateConfig) ? 0 : Number(rateConfig?.input || 0),
                  outputRate: host.isPerRequestPricingConfig(rateConfig) ? 0 : Number(rateConfig?.output || 0),
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
              } catch (error) {
                reject(error);
              } finally {
                rawChunks.length = 0;
              }
            });

            proxyRes.on("error", (err) => {
              rawChunks.length = 0;
              auditAttempt(false, streamStatusCode, err);
              if (allowRetryBeforeResponse && !res.headersSent && host.shouldFailoverOnError(err)) {
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

          // With response AI audit enabled, buffer the complete textual stream before
          // sending headers or body. This prevents unaudited content from escaping.
          if (responseAiEnabled) {
            const rawChunks: Buffer[] = [];
            let rawSize = 0;
            let blockedBySafety = false;
            const maxAuditBytes = env.aiResources.streaming.outputLimitBytes;
            const safetyUsageParser = new BoundedTextLines(
              host.streamFrameLimitBytes ?? env.aiResources.streaming.frameLimitBytes,
            );
            proxyRes.on("data", (chunk: Buffer) => {
              if (firstByteTime === null) firstByteTime = Date.now();
              rawSize += chunk.length;
              if (rawSize > maxAuditBytes) {
                rawChunks.length = 0;
                destroyRelayUpstreamResponse(
                  proxyRes,
                  new PayloadTooLargeError("Response exceeds content safety buffer limit", undefined, {
                    messageKey: "relay.streamBufferTooLarge",
                  }),
                );
                return;
              }
              rawChunks.push(chunk);
              try {
                for (const line of safetyUsageParser.feed(chunk))
                  consumeRelayStreamUsageLine(line, requestFormat, streamUsage);
              } catch (error) {
                rawChunks.length = 0;
                destroyRelayUpstreamResponse(proxyRes, error as Error);
              }
            });
            proxyRes.on("end", async () => {
              try {
                if (rawSize > maxAuditBytes) {
                  blockedBySafety = true;
                  throw new ContentSafetyBlockedError();
                }
                for (const line of safetyUsageParser.finish())
                  consumeRelayStreamUsageLine(line, requestFormat, streamUsage);
                const rawBody = Buffer.concat(rawChunks, rawSize);
                rawChunks.length = 0;
                const safety = await host.contentSafetyService.evaluate("response", rawBody.toString("utf8"), {
                  userId: relayToken.userId,
                  tokenConfig: relayToken.contentSafetyConfig as any,
                });
                stats.inputTokens += safety.auditInputTokens;
                stats.outputTokens += safety.auditOutputTokens;
                stats.cost += safety.auditCost;
                stats.durationMs += safety.auditDurationMs;
                if (safety.matched) {
                  await host.contentSafetyService.recordIncident({
                    userId: relayToken.userId,
                    relayTokenId: relayToken.id,
                    requestId: host.getLogicalRequestId(req),
                    direction: "response",
                    evaluation: safety,
                    model: selectedModelName,
                    channelId: executionChannelId,
                    statusCode: streamStatusCode,
                    request: req,
                  });
                  if (safety.action === "unreachable") {
                    recordAIRequestFailure(auditResponse, { name: "ContentSafetyBlockedError" }, "content-safety");
                    blockedBySafety = true;
                    throw new ContentSafetyBlockedError();
                  }
                }
                const output =
                  safety.matched && safety.action === "blackhole" ? Buffer.from(safety.text, "utf8") : rawBody;
                const outputHeaders = host.withRequestIdHeader(req, responseHeaders);
                res.writeHead(streamStatusCode, outputHeaders);
                const sse = responseTransform
                  ? new RelaySseFormatTransform(responseTransform.sourceFormat, responseTransform.targetFormat)
                  : null;
                if (sse) {
                  sse.end(output);
                  for await (const data of sse) await writeWithBackpressure(res, data);
                } else await writeWithBackpressure(res, output);
                if (!res.writableEnded) res.end();
                rawChunks.length = 0;
                const normalized = streamUsage.normalized();
                const rateConfig = selectedModelRate;
                if (!rateConfig)
                  throw new BadRequestError(
                    `Model '${selectedModelName}' not found in pricing configuration`,
                    undefined,
                    {
                      messageKey: "relay.modelNotInPricingConfig",
                    },
                  );
                const modelMult = rateConfig.multiplier != null ? Number(rateConfig.multiplier) : 1;
                const cacheCreationMult =
                  rateConfig.cacheCreationMultiplier != null
                    ? Number(rateConfig.cacheCreationMultiplier)
                    : DEFAULT_CACHE_CREATION_MULTIPLIER;
                const cacheReadMult =
                  rateConfig.cacheReadMultiplier != null
                    ? Number(rateConfig.cacheReadMultiplier)
                    : DEFAULT_CACHE_READ_MULTIPLIER;
                const contextMatch = host.resolveContextMultiplier(
                  contextLengthMultipliers,
                  normalized.requestTokens,
                  streamUsage.cacheCreationTokens,
                  streamUsage.cacheReadTokens,
                );
                const costResult = host.calculateCost(
                  normalized.requestTokens,
                  normalized.responseTokens,
                  normalized.totalTokens,
                  rateConfig,
                  globalMultiplier * contextMatch.multiplier,
                  streamUsage.cacheCreationTokens,
                  streamUsage.cacheReadTokens,
                  cacheCreationMult,
                  cacheReadMult,
                );
                await host.finalizeStreamUsage(relayToken, {
                  requestId: host.getLogicalRequestId(req),
                  requestTokens: normalized.requestTokens,
                  responseTokens: normalized.responseTokens,
                  totalTokens: normalized.totalTokens,
                  cacheCreationTokens: streamUsage.cacheCreationTokens,
                  cacheReadTokens: streamUsage.cacheReadTokens,
                  cost: costResult.cost + stats.cost,
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
                  contextTokens: contextMatch.contextTokens,
                  contextMultiplier: contextMatch.multiplier,
                  contextRuleName: contextMatch.ruleName,
                  monthlyPassCoverageAt,
                  path: req.path.replace(/^\/relay\/proxy/, ""),
                  method: req.method,
                  statusCode: streamStatusCode,
                  ipAddress: req.ip || "unknown",
                  modelName: selectedModelName,
                  modelId: selectedModelId,
                  totalOutputTime: Math.max(0, Date.now() - startTime - stats.durationMs),
                  timeToFirstByte:
                    firstByteTime === null ? null : Math.max(0, firstByteTime - startTime - stats.durationMs),
                  pricingType: rateConfig.pricingType,
                  fixedPrice: rateConfig.fixedPrice,
                  originalModel: originalRequestedModel,
                  auditInputTokens: stats.inputTokens,
                  auditOutputTokens: stats.outputTokens,
                  auditTotalTokens: stats.inputTokens + stats.outputTokens,
                  auditCost: stats.cost,
                  auditDurationMs: stats.durationMs,
                });
                auditAttempt(true, streamStatusCode);
                resolve({
                  handled: true,
                  success: true,
                  retryable: false,
                  statusCode: streamStatusCode,
                  timeToFirstByte:
                    firstByteTime === null ? undefined : Math.max(0, firstByteTime - startTime - stats.durationMs),
                });
              } catch (error) {
                auditAttempt(false, streamStatusCode, error);
                recordAIRequestFailure(auditResponse, error);
                if (!blockedBySafety) {
                  reject(error);
                  return;
                }
                if (stats.cost > 0 && selectedModelRate) {
                  try {
                    const failedTokens = streamUsage.normalized();
                    const failedRate = selectedModelRate;
                    const failedModelMult = failedRate.multiplier != null ? Number(failedRate.multiplier) : 1;
                    await host.finalizeStreamUsage(relayToken, {
                      requestId: host.getLogicalRequestId(req),
                      requestTokens: failedTokens.requestTokens,
                      responseTokens: failedTokens.responseTokens,
                      totalTokens: failedTokens.totalTokens,
                      cacheCreationTokens: streamUsage.cacheCreationTokens,
                      cacheReadTokens: streamUsage.cacheReadTokens,
                      cost: stats.cost,
                      inputRate: Number(failedRate.input || 0),
                      outputRate: Number(failedRate.output || 0),
                      multiplier: failedModelMult,
                      cacheCreationMult: failedRate.cacheCreationMultiplier ?? DEFAULT_CACHE_CREATION_MULTIPLIER,
                      cacheReadMult: failedRate.cacheReadMultiplier ?? DEFAULT_CACHE_READ_MULTIPLIER,
                      executionChannelId,
                      displayChannelId,
                      displayChannelName,
                      channelId,
                      channelMultiplier,
                      relayGlobalMultiplier,
                      monthlyPassCoverageAt,
                      path: req.path.replace(/^\/relay\/proxy/, ""),
                      method: req.method,
                      statusCode: 403,
                      ipAddress: req.ip || "unknown",
                      modelName: selectedModelName,
                      modelId: selectedModelId,
                      totalOutputTime: Math.max(0, Date.now() - startTime - stats.durationMs),
                      timeToFirstByte:
                        firstByteTime === null ? null : Math.max(0, firstByteTime - startTime - stats.durationMs),
                      pricingType: failedRate.pricingType,
                      fixedPrice: failedRate.fixedPrice,
                      originalModel: originalRequestedModel,
                      auditInputTokens: stats.inputTokens,
                      auditOutputTokens: stats.outputTokens,
                      auditTotalTokens: stats.inputTokens + stats.outputTokens,
                      auditCost: stats.cost,
                      auditDurationMs: stats.durationMs,
                    });
                  } catch {
                    /* safety blocking must remain deterministic even if billing is unavailable */
                  }
                }
                if (!res.headersSent && !res.writableEnded) {
                  res.writeHead(403, { "content-type": "application/json" });
                  res.end(
                    JSON.stringify({
                      error: { message: "Request blocked by content safety policy", type: "content_safety_blocked" },
                    }),
                  );
                }
                resolve({
                  handled: true,
                  success: false,
                  retryable: false,
                  statusCode: 403,
                  triggerError: "Content safety policy blocked response",
                });
              }
            });
            proxyRes.on("error", (error) => {
              if (!res.writableEnded) res.end();
              reject(error);
            });
            return;
          }

          // ── Success path (2xx/3xx): pipe chunks directly to the client ──
          // Output-shape detection is intentionally not part of stream lifecycle.
          // A healthy upstream response must be forwarded even when its first frames
          // contain metadata/tool control data or cannot be parsed locally.
          let responseStarted = false;
          let settled = false;
          const startResponse = () => {
            if (responseStarted || res.headersSent) return;
            responseStarted = true;
            res.writeHead(streamStatusCode, host.withRequestIdHeader(req, responseHeaders));
          };
          const sseTransform = responseTransform
            ? new RelaySseFormatTransform(responseTransform.sourceFormat, responseTransform.targetFormat)
            : null;
          const queueOutput = async (data: Buffer) => {
            if (!data.length || settled) return;
            startResponse();
            await writeWithBackpressure(res, data);
          };
          let settlement: Promise<void> | undefined;
          const settleUsage = (settlementStatus: number): Promise<void> => {
            return (settlement ??= (async () => {
              const normalizedStreamTokens = streamUsage.normalized();

              const modelName = selectedModelName;
              const rateConfig = selectedModelRate;
              if (!rateConfig)
                throw new BadRequestError(`Model '${modelName}' not found in pricing configuration`, undefined, {
                  messageKey: "relay.modelNotInPricingConfig",
                });

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

              const contextMatch = host.resolveContextMultiplier(
                contextLengthMultipliers,
                normalizedStreamTokens.requestTokens,
                streamUsage.cacheCreationTokens,
                streamUsage.cacheReadTokens,
              );

              const costResult = host.calculateCost(
                normalizedStreamTokens.requestTokens,
                normalizedStreamTokens.responseTokens,
                normalizedStreamTokens.totalTokens,
                rateConfig,
                globalMultiplier * contextMatch.multiplier,
                streamUsage.cacheCreationTokens,
                streamUsage.cacheReadTokens,
                cacheCreationMult,
                cacheReadMult,
              );

              const totalOutputTime = Math.max(0, Date.now() - startTime - stats.durationMs);
              const timeToFirstByte =
                firstByteTime === null ? null : Math.max(0, firstByteTime - startTime - stats.durationMs);

              try {
                await host.finalizeStreamUsage(relayToken, {
                  requestId: host.getLogicalRequestId(req),
                  requestTokens: normalizedStreamTokens.requestTokens,
                  responseTokens: normalizedStreamTokens.responseTokens,
                  totalTokens: normalizedStreamTokens.totalTokens,
                  cacheCreationTokens: streamUsage.cacheCreationTokens,
                  cacheReadTokens: streamUsage.cacheReadTokens,
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
                  contextTokens: contextMatch.contextTokens,
                  contextMultiplier: contextMatch.multiplier,
                  contextRuleName: contextMatch.ruleName,
                  monthlyPassCoverageAt,
                  path: req.path.replace(/^\/relay\/proxy/, ""),
                  method: req.method,
                  statusCode: settlementStatus,
                  ipAddress: req.ip || "unknown",
                  modelName,
                  modelId: selectedModelId,
                  totalOutputTime,
                  timeToFirstByte,
                  pricingType: rateConfig?.pricingType as "token-based" | "per-request" | undefined,
                  fixedPrice: rateConfig?.fixedPrice,
                  originalModel: originalRequestedModel,
                  auditInputTokens: stats.inputTokens,
                  auditOutputTokens: stats.outputTokens,
                  auditTotalTokens: stats.inputTokens + stats.outputTokens,
                  auditCost: stats.cost,
                  auditDurationMs: stats.durationMs,
                });
              } catch (error) {
                logger.error("Failed to finalize relay stream usage", {
                  relayTokenId: relayToken.id,
                  userId: relayToken.userId,
                  modelName,
                  error: error instanceof Error ? error.message : String(error),
                });
                throw error;
              }
            })());
          };
          const failStream = (error: unknown) => {
            if (settled) return;
            settled = true;
            const failure = error instanceof Error ? error : new Error("Stream failed");
            auditAttempt(false, streamStatusCode, failure);
            recordAIRequestFailure(auditResponse, failure);
            destroyRelayUpstreamResponse(proxyRes, failure);
            sseTransform?.destroy(failure);
            if (!res.writableEnded) res.end();
            const status = clientDisconnected
              ? 499
              : failure instanceof GatewayTimeoutError
                ? 504
                : failure instanceof PayloadTooLargeError
                  ? 413
                  : 502;
            // Do not bill blocked/unaudited content. Partial output settles before releasing the root.
            const finish = () => {
              if (clientDisconnected)
                resolve({
                  handled: true,
                  success: false,
                  retryable: false,
                  statusCode: streamStatusCode,
                  clientDisconnected: true,
                });
              else reject(failure);
            };
            if (firstByteTime !== null && selectedModelRate && !(failure instanceof ContentSafetyBlockedError))
              void streamChunkPromise
                .then(() => settleUsage(status))
                .then(finish, (billingError) => {
                  if (clientDisconnected) finish();
                  else reject(billingError);
                });
            else finish();
          };
          failActiveStream = failStream;
          const outputPump = sseTransform
            ? (async () => {
                for await (const data of sseTransform) await queueOutput(Buffer.from(data));
              })().catch(failStream)
            : Promise.resolve();
          let safetyCarry = "";
          const safetyDecoder = new StringDecoder("utf8");
          const usageParser = new BoundedTextLines(
            host.streamFrameLimitBytes ?? env.aiResources.streaming.frameLimitBytes,
          );
          let streamChunkPromise: Promise<void> = Promise.resolve();

          const applyUsageLine = (line: string) => {
            consumeRelayStreamUsageLine(line, requestFormat, streamUsage, () => {});
          };

          proxyRes.on("data", (chunk) => {
            if (firstByteTime === null) firstByteTime = Date.now();
            proxyRes.pause?.();
            streamChunkPromise = streamChunkPromise
              .then(async () => {
                let outputChunk = chunk as Buffer;
                try {
                  usageParser.feed(outputChunk).forEach(applyUsageLine);
                  if (settled) return;
                  const combinedSafetyText = safetyCarry + safetyDecoder.write(outputChunk);
                  const inspectText =
                    combinedSafetyText.length > 256 ? combinedSafetyText.slice(0, -256) : combinedSafetyText;
                  safetyCarry = combinedSafetyText.length > 256 ? combinedSafetyText.slice(-256) : combinedSafetyText;
                  const safety = await host.contentSafetyService.evaluateLocal("response", inspectText, {
                    userId: relayToken.userId,
                    tokenConfig: relayToken.contentSafetyConfig as any,
                  });
                  if (safety.matched) {
                    await host.contentSafetyService.recordIncident({
                      userId: relayToken.userId,
                      relayTokenId: relayToken.id,
                      requestId: host.getLogicalRequestId(req),
                      direction: "response",
                      evaluation: safety,
                      model: selectedModelName,
                      channelId: executionChannelId,
                      statusCode: streamStatusCode,
                      request: req,
                    });
                    if (safety.action === "unreachable") {
                      recordAIRequestFailure(auditResponse, { name: "ContentSafetyBlockedError" }, "content-safety");
                      failStream(new ContentSafetyBlockedError());
                      return;
                    }
                    if (safety.action === "blackhole") outputChunk = Buffer.from(safety.text + safetyCarry, "utf8");
                    else outputChunk = Buffer.from(safety.text, "utf8");
                    safetyCarry = "";
                  } else {
                    outputChunk = combinedSafetyText.length > 256 ? Buffer.from(inspectText, "utf8") : Buffer.alloc(0);
                  }
                  if (firstByteTime === null) firstByteTime = Date.now();
                  if (outputChunk.length) {
                    if (sseTransform) await writeWithBackpressure(sseTransform, outputChunk);
                    else await queueOutput(outputChunk);
                  }
                } catch (error) {
                  failStream(error);
                } finally {
                  if (!settled && !proxyRes.destroyed) proxyRes.resume?.();
                }
              })
              .catch(failStream);
          });

          proxyRes.on("end", async () => {
            try {
              try {
                await streamChunkPromise;
              } catch (error) {
                destroyRelayUpstreamResponse(proxyRes, error instanceof Error ? error : undefined);
                if (!res.writableEnded) res.end();
                reject(error);
                return;
              }
              if (settled) return;
              usageParser.finish().forEach(applyUsageLine);
              safetyCarry += safetyDecoder.end();

              if (safetyCarry && !res.writableEnded && !clientDisconnected) {
                try {
                  const tailSafety = await host.contentSafetyService.evaluateLocal("response", safetyCarry, {
                    userId: relayToken.userId,
                    tokenConfig: relayToken.contentSafetyConfig as any,
                  });
                  if (tailSafety.matched) {
                    await host.contentSafetyService.recordIncident({
                      userId: relayToken.userId,
                      relayTokenId: relayToken.id,
                      requestId: host.getLogicalRequestId(req),
                      direction: "response",
                      evaluation: tailSafety,
                      model: selectedModelName,
                      channelId: executionChannelId,
                      statusCode: streamStatusCode,
                      request: req,
                    });
                    if (tailSafety.action === "unreachable") {
                      recordAIRequestFailure(auditResponse, { name: "ContentSafetyBlockedError" }, "content-safety");
                      failStream(new ContentSafetyBlockedError());
                      return;
                    }
                    safetyCarry = tailSafety.action === "blackhole" ? tailSafety.text : safetyCarry;
                  }
                  if (sseTransform) await writeWithBackpressure(sseTransform, Buffer.from(safetyCarry, "utf8"));
                  else await queueOutput(Buffer.from(safetyCarry, "utf8"));
                } catch (error) {
                  failStream(error);
                  return;
                }
              }

              if (clientDisconnected) {
                settled = true;
                resolve({
                  handled: true,
                  success: true,
                  retryable: false,
                  statusCode: streamStatusCode,
                  clientDisconnected: true,
                });
                return;
              }
              startResponse();

              // Only end response if client is still connected
              if (!res.writableEnded && !clientDisconnected) {
                sseTransform?.end();
                await outputPump;
                if (settled) return;
                res.end();
              }

              await settleUsage(streamStatusCode);
              auditAttempt(true, streamStatusCode);
              settled = true;
              resolve({
                handled: true,
                success: true,
                retryable: false,
                statusCode: proxyRes.statusCode || 200,
                timeToFirstByte:
                  firstByteTime === null ? undefined : Math.max(0, firstByteTime - startTime - stats.durationMs),
              });
            } catch (error) {
              failStream(error);
            }
          });

          proxyRes.on("error", (err) => {
            auditAttempt(false, streamStatusCode, err);

            if (settled) return;
            failStream(err);
          });
        },
      );

      proxyReq.on("timeout", () => {
        auditAttempt(false, 504, "Upstream request timed out");
        if (clientDisconnected) {
          resolve({ handled: true, success: true, retryable: false, clientDisconnected: true });
          return;
        }
        timedOut = true;
        const timeoutError = new GatewayTimeoutError("Upstream request timeout", undefined, {
          messageKey: "relay.upstreamRequestTimeout",
        });
        if (failActiveStream) {
          failActiveStream(timeoutError);
          proxyReq.destroy(timeoutError);
          return;
        }
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
        auditAttempt(false, undefined, err);
        if (timedOut) return;

        if (failActiveStream) {
          failActiveStream(err);
          return;
        }
        // If client already disconnected, don't send error response
        if (clientDisconnected) {
          logger.debug("[Relay] Upstream error after client disconnect, ignoring", { error: err.message });
          resolve({ handled: true, success: true, retryable: false, clientDisconnected: true });
          return;
        }

        if (allowRetryBeforeResponse && !res.headersSent && host.shouldFailoverOnError(err)) {
          resolve({
            handled: false,
            success: false,
            retryable: true,
            triggerError: err instanceof Error ? err.message : "Upstream request failed",
          });
          return;
        }

        if (!res.headersSent) host.sendStreamTransportError(res, err);

        reject(err);
      });

      proxyReq.write(bodyData);
      proxyReq.end();

      // Monitor client disconnect and abort upstream request
      const clientCloseHandler = () => {
        if (!res.writableEnded && !timedOut) {
          clientDisconnected = true;
          auditAttempt(false, undefined, "Client disconnected");
          recordAIRequestFailure(auditResponse, { name: "AbortError" }, "client");
          logger.warn("[Relay] Client disconnected, aborting upstream request");
          failActiveStream?.(aiAbortError());
          proxyReq.destroy();
        }
      };

      req.once("aborted", clientCloseHandler);
      res.once?.("close", clientCloseHandler);

      // Clean up listener when stream completes
      const cleanup = () => {
        req.off("aborted", clientCloseHandler);
        res.off?.("close", clientCloseHandler);
      };

      res.once?.("finish", cleanup);
      proxyReq.once("error", cleanup);
    });
  }
}
