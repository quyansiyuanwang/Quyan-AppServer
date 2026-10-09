import { BoundedByteFrames } from "@/util/streaming/bounded-byte-frames";
import {
  consumeRelayStreamUsageValue,
  parseRelayStreamEvent,
  relayFrameNeedsUsage,
  relayDecodedFrames,
} from "@/util/relay/relay-stream-usage.util";
import { withContentSafetyAttempt } from "@/services/system/content-safety-attempt";
import { getAIHttpAgents } from "@/services/infrastructure/ai-http-agent-pool";
import { getAIResourceConfig } from "@/services/infrastructure/ai-resource-config.service";
import { aiResourceContext, aiAbortError } from "@/services/infrastructure/ai-resource.service";
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
import { RelayStreamUsageTracker } from "@/util/relay";
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
    const requestAgents = params.requestAgents || getAIHttpAgents();
    const wireBody = params.bodyBuffer;
    const forwardHost: RelayStreamForwarderHost = {
      ...host,
      forwardStreamRequest: (...args: any[]) =>
        withContentSafetyAttempt(() => this.forwardLegacy.apply(this, [...args, forwardHost, undefined, true] as any)),
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
      wireBody,
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
    requestAgents: RelayUpstreamAgents = getAIHttpAgents(),
    responseAiEnabled = false,
    auditStats?: { inputTokens: number; outputTokens: number; cost: number; durationMs: number },
    host: RelayStreamForwarderHost = undefined as unknown as RelayStreamForwarderHost,
    serializedBody?: Buffer,
    retryRequestSafety = false,
  ): Promise<StreamForwardResult> {
    if (typeof host.contentSafetyService.prepareAttempt === "function") {
      const policy = await host.contentSafetyService.prepareAttempt({
        userId: relayToken.userId,
        tokenConfig: relayToken.contentSafetyConfig as any,
      });
      responseAiEnabled = Boolean(policy.responseEnabled && policy.responseAiEnabled);
    }
    const url = new URL(upstreamUrl);
    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? https : http;

    // 序列化一次，复用同一个 Buffer（避免两次 JSON.stringify）
    let bodyData = serializedBody ?? buildRelayForwardBodyBuffer(convertedBody);
    const stats = auditStats || { inputTokens: 0, outputTokens: 0, cost: 0, durationMs: 0 };
    if (retryRequestSafety) {
      const safety = await host.contentSafetyService.evaluate("request", bodyData.toString("utf8"), {
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
          direction: "request",
          evaluation: safety,
          model: selectedModelName,
          channelId: executionChannelId,
          request: req,
        });
        if (safety.action === "unreachable") throw new ContentSafetyBlockedError();
        if (safety.action === "blackhole") {
          try {
            convertedBody = JSON.parse(safety.text);
            bodyData = Buffer.from(safety.text);
          } catch {
            throw new ContentSafetyBlockedError();
          }
        }
      }
    }

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
    let firstByteTime: number | null = null;

    let clientDisconnected = false; // 标记客户端是否已断开

    let cleanupListeners = () => {};
    return new Promise<StreamForwardResult>((resolve, reject) => {
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
          const frameDelimiter =
            requestFormat === "gemini" && !String(responseHeaders["content-type"] ?? "").includes("text/event-stream")
              ? ("line" as const)
              : ("sse" as const);

          // For error responses we buffer the whole body so we can build a
          // normalized error message; we do NOT pipe chunks straight through.
          if (isStreamErrorResponse) {
            const rawChunks: Buffer[] = [];
            const maxErrorBodyBytes = getAIResourceConfig().aiRequestLog.responseBodyBytes;
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
                const errorText = (
                  rawChunks.length === 1 ? rawChunks[0]! : Buffer.concat(rawChunks, totalSize)
                ).toString("utf8");
                rawChunks.length = 0;
                auditAttempt(false, streamStatusCode, errorText);

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
                  upstreamData = JSON.parse(errorText);
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
            let auditSettled = false;
            const maxAuditBytes = getAIResourceConfig().aiResources.streaming.outputLimitBytes;
            const safetyFrames = new BoundedByteFrames(
              host.streamFrameLimitBytes ?? getAIResourceConfig().aiResources.streaming.frameLimitBytes,
              frameDelimiter,
            );
            const observeUsage = (text: string) => {
              for (const frame of relayDecodedFrames(text, frameDelimiter)) {
                if (relayFrameNeedsUsage(frame))
                  consumeRelayStreamUsageValue(parseRelayStreamEvent(frame, requestFormat), requestFormat, streamUsage);
              }
            };
            const failAudit = (error: Error) => {
              if (auditSettled) return;
              auditSettled = true;
              rawChunks.length = 0;
              safetyFrames.clear();
              auditAttempt(false, streamStatusCode, error);
              recordAIRequestFailure(auditResponse, error);
              destroyRelayUpstreamResponse(proxyRes, error);
              if (!res.writableEnded) res.end();
              reject(error);
            };
            failActiveStream = failAudit;
            proxyRes.on("data", (chunk: Buffer) => {
              if (auditSettled) return;
              if (firstByteTime === null) firstByteTime = Date.now();
              rawSize += chunk.length;
              if (rawSize > maxAuditBytes) {
                failAudit(
                  new PayloadTooLargeError("Response exceeds content safety buffer limit", undefined, {
                    messageKey: "relay.streamBufferTooLarge",
                  }),
                );
                return;
              }
              rawChunks.push(chunk);
              try {
                // Validate frame capacity without decoding or parsing each network chunk.
                for (const frame of safetyFrames.feed(chunk)) {
                  void frame;
                }
              } catch (error) {
                failAudit(error instanceof Error ? error : new Error("Invalid upstream frame"));
              }
            });
            proxyRes.on("end", async () => {
              if (auditSettled) return;
              try {
                if (rawSize > maxAuditBytes) {
                  blockedBySafety = true;
                  throw new ContentSafetyBlockedError();
                }
                safetyFrames.clear();
                const rawBody = rawChunks.length === 1 ? rawChunks[0]! : Buffer.concat(rawChunks, rawSize);
                rawChunks.length = 0;
                const rawText = rawBody.toString("utf8");
                const safety = await host.contentSafetyService.evaluate("response", rawText, {
                  userId: relayToken.userId,
                  tokenConfig: relayToken.contentSafetyConfig as any,
                });
                if (auditSettled) return;
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
                    observeUsage(rawText);
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
                const replaced = safety.matched && safety.action === "blackhole";
                if (replaced) observeUsage(rawText);
                try {
                  if (sse) {
                    for (const frame of relayDecodedFrames(replaced ? safety.text : rawText, frameDelimiter)) {
                      const parsed = parseRelayStreamEvent(frame, requestFormat);
                      if (!replaced) consumeRelayStreamUsageValue(parsed, requestFormat, streamUsage);
                      const converted = sse.convertFrame(frame, parsed);
                      if (converted) await writeWithBackpressure(res, converted);
                    }
                  } else {
                    if (!replaced) observeUsage(rawText);
                    await writeWithBackpressure(res, output);
                  }
                } finally {
                  sse?.destroy();
                }
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
                auditSettled = true;
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
                if (auditSettled) return;
                auditAttempt(false, streamStatusCode, error);
                recordAIRequestFailure(auditResponse, error);
                if (!blockedBySafety) {
                  failAudit(error instanceof Error ? error : new Error("Upstream audit failed"));
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
                auditSettled = true;
                resolve({
                  handled: true,
                  success: false,
                  retryable: false,
                  statusCode: 403,
                  triggerError: "Content safety policy blocked response",
                });
              }
            });
            proxyRes.on("error", failAudit);
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
          const localSafetyRequired =
            typeof host.contentSafetyService.hasLocalResponseRules === "function"
              ? host.contentSafetyService.hasLocalResponseRules({
                  userId: relayToken.userId,
                  tokenConfig: relayToken.contentSafetyConfig as any,
                })
              : Promise.resolve(true);
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
            // convertFrame is used directly; report failure through the request promise.
            sseTransform?.destroy();
            frames.clear();
            pendingSafetyFrame = undefined;
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
          let pendingSafetyFrame: { raw: Buffer; text: string; parsed?: unknown } | undefined;
          const frames = new BoundedByteFrames(
            host.streamFrameLimitBytes ?? getAIResourceConfig().aiResources.streaming.frameLimitBytes,
            frameDelimiter,
          );
          let streamChunkPromise: Promise<void> = Promise.resolve();
          const writeFrame = async (raw: Buffer, text?: string, value?: unknown) => {
            if (settled || !raw.length) return;
            if (sseTransform) {
              const converted = sseTransform.convertFrame((text ?? raw.toString("utf8")).trimEnd(), value);
              if (converted) await queueOutput(Buffer.from(converted));
            } else await queueOutput(raw);
          };
          const evaluateFrames = async (text: string) => {
            const evaluation = await host.contentSafetyService.evaluateLocal("response", text, {
              userId: relayToken.userId,
              tokenConfig: relayToken.contentSafetyConfig as any,
            });
            if (evaluation.matched) {
              await host.contentSafetyService.recordIncident({
                userId: relayToken.userId,
                relayTokenId: relayToken.id,
                requestId: host.getLogicalRequestId(req),
                direction: "response",
                evaluation,
                model: selectedModelName,
                channelId: executionChannelId,
                statusCode: streamStatusCode,
                request: req,
              });
              if (evaluation.action === "unreachable") {
                recordAIRequestFailure(auditResponse, { name: "ContentSafetyBlockedError" }, "content-safety");
                throw new ContentSafetyBlockedError();
              }
            }
            return evaluation;
          };
          const writeReplacement = async (text: string) => {
            if (!sseTransform) {
              await queueOutput(Buffer.from(text));
              return;
            }
            const replacement = new BoundedByteFrames(getAIResourceConfig().aiResources.streaming.frameLimitBytes);
            for (const frame of replacement.feed(Buffer.from(text))) await writeFrame(frame);
            const tail = replacement.finish();
            if (tail) await writeFrame(tail);
          };
          const processFrame = async (raw: Buffer) => {
            const inspect = await localSafetyRequired;
            const needsUsage = relayFrameNeedsUsage(raw);
            const text = inspect || sseTransform || needsUsage ? raw.toString("utf8") : undefined;
            const parsed = needsUsage || sseTransform ? parseRelayStreamEvent(text!, requestFormat) : undefined;
            if (parsed) consumeRelayStreamUsageValue(parsed, requestFormat, streamUsage);
            if (!inspect) {
              await writeFrame(raw, text, parsed);
              return;
            }
            const previous = pendingSafetyFrame;
            if (previous) {
              const evaluation = await evaluateFrames(previous.text + text!);
              if (evaluation.matched && evaluation.action === "blackhole") {
                pendingSafetyFrame = undefined;
                await writeReplacement(evaluation.text);
                return;
              }
              await writeFrame(previous.raw, previous.text, previous.parsed);
            }
            // Own one pending frame so a small view cannot retain a whole network chunk.
            pendingSafetyFrame = { raw: Buffer.from(raw), text: text!, parsed };
          };
          proxyRes.on("data", (chunk: Buffer) => {
            if (firstByteTime === null) firstByteTime = Date.now();
            proxyRes.pause?.();
            streamChunkPromise = streamChunkPromise
              .then(async () => {
                try {
                  for (const frame of frames.feed(chunk)) {
                    if (settled) break;
                    await processFrame(frame);
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
              const finalFrame = frames.finish();
              if (finalFrame) await processFrame(finalFrame);
              if (pendingSafetyFrame && !res.writableEnded && !clientDisconnected) {
                const pending = pendingSafetyFrame;
                pendingSafetyFrame = undefined;
                const evaluation = await evaluateFrames(pending.text);
                if (evaluation.matched && evaluation.action === "blackhole") await writeReplacement(evaluation.text);
                else await writeFrame(pending.raw, pending.text, pending.parsed);
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
              sseTransform?.destroy();
              startResponse();

              // Only end response if client is still connected
              if (!res.writableEnded && !clientDisconnected) {
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
        res.off?.("finish", cleanup);
        proxyReq.off("error", cleanup);
      };
      cleanupListeners = cleanup;

      res.once?.("finish", cleanup);
      proxyReq.once("error", cleanup);
    }).finally(() => cleanupListeners());
  }
}
