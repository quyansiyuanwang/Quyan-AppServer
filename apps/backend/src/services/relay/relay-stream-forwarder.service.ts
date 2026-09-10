import http from "http";
import https from "https";
import type { RelayToken } from "@prisma/client";
import type { RelayProxyStore } from "@/store/relay/relay-proxy.store";
import { trackErrorForIp } from "@/middleware/error-tracker";
import { BadRequestError, ContentSafetyBlockedError, GatewayTimeoutError, PayloadTooLargeError } from "@/util/errors";
import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER } from "@/constant/pricing";
import { consumeRelayStreamUsageLine, RelayStreamUsageTracker } from "@/util/relay";
import { hasVisibleStreamOutput, RelayStreamPreflightBuffer, STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES } from "@/util/relay";
import { convertRelayError, RelaySseFormatTransform } from "./relay-request-format-transform.service";
import { shouldRetryRelayUpstreamFailure } from "@/util/relay";
import {
  normalizeRelayTokenNormalizerConfig,
  rectifyAnthropicRequestForError,
  type RelayTokenNormalizerConfig,
} from "@/util/anthropic-token-normalizer.util";
import type { ContextLengthMultiplierRule, ContextLengthMultiplierMatch } from "./context-length-multiplier.service";
import type { RelayConvertibleRequestFormat, RelayTokenStreamConfig } from "@quyan/shared";
import {
  DEFAULT_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES,
  MIN_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES,
  MAX_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES,
} from "@quyan/shared";
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
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 10, maxFreeSockets: 2, timeout: 60000, scheduling: "lifo" }),
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: 10,
    maxFreeSockets: 2,
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
    const stats = auditStats || { inputTokens: 0, outputTokens: 0, cost: 0, durationMs: 0 };
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
          agent: isHttps ? requestAgents.httpsAgent : requestAgents.httpAgent,
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

              const upstreamMessage =
                upstreamData?.error?.message ||
                upstreamData?.message ||
                (typeof upstreamData === "string" ? upstreamData : null) ||
                (truncated ? `HTTP ${streamStatusCode} (error body truncated)` : null);

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
            });

            proxyRes.on("error", (err) => {
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
            const maxAuditBytes = 512 * 1024;
            proxyRes.on("data", (chunk: Buffer) => {
              if (firstByteTime === null) firstByteTime = Date.now();
              rawSize += chunk.length;
              if (rawSize <= maxAuditBytes) rawChunks.push(chunk);
              else
                destroyRelayUpstreamResponse(
                  proxyRes,
                  new PayloadTooLargeError("Response exceeds content safety buffer limit"),
                );
              const text = chunk.toString("utf8");
              for (const line of text.split(/\r?\n/)) consumeRelayStreamUsageLine(line, requestFormat, streamUsage);
            });
            proxyRes.on("end", async () => {
              streamCompleted = true;
              try {
                if (rawSize > maxAuditBytes) {
                  blockedBySafety = true;
                  throw new ContentSafetyBlockedError();
                }
                const safety = await host.contentSafetyService.evaluate(
                  "response",
                  Buffer.concat(rawChunks).toString("utf8"),
                  { userId: relayToken.userId, tokenConfig: relayToken.contentSafetyConfig as any },
                );
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
                    blockedBySafety = true;
                    throw new ContentSafetyBlockedError();
                  }
                }
                if (!hasVisibleStreamOutput(Buffer.concat(rawChunks), requestFormat)) {
                  resolve({
                    handled: false,
                    success: false,
                    retryable: true,
                    statusCode: streamStatusCode,
                    triggerError: "upstream stream ended without output",
                  });
                  return;
                }
                const output =
                  safety.matched && safety.action === "blackhole"
                    ? Buffer.from(safety.text, "utf8")
                    : Buffer.concat(rawChunks);
                const outputHeaders = host.withRequestIdHeader(req, responseHeaders);
                res.writeHead(streamStatusCode, outputHeaders);
                const sse = responseTransform
                  ? new RelaySseFormatTransform(responseTransform.sourceFormat, responseTransform.targetFormat)
                  : null;
                sse?.on("data", (data) => res.write(data));
                sse?.on("error", () => {
                  if (!res.writableEnded) res.end();
                });
                if (sse) {
                  sse.once("end", () => {
                    if (!res.writableEnded) res.end();
                  });
                  sse.end(output);
                } else {
                  res.end(output);
                }
                const normalized = streamUsage.normalized();
                const rateConfig = selectedModelRate;
                if (!rateConfig)
                  throw new BadRequestError(`Model '${selectedModelName}' not found in pricing configuration`);
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
                resolve({
                  handled: true,
                  success: true,
                  retryable: false,
                  statusCode: streamStatusCode,
                  timeToFirstByte:
                    firstByteTime === null ? undefined : Math.max(0, firstByteTime - startTime - stats.durationMs),
                });
              } catch (error) {
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
          // Read preflight buffer limit from token config, with validation
          const streamConfig = relayToken.streamConfig as RelayTokenStreamConfig | null | undefined;
          const configuredLimit = streamConfig?.preflightBufferLimitBytes;
          const preflightBufferLimit =
            configuredLimit != null
              ? Math.max(
                  MIN_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES,
                  Math.min(MAX_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES, configuredLimit),
                )
              : DEFAULT_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES;

          const preflight = new RelayStreamPreflightBuffer(preflightBufferLimit);
          let preflightRawBytes = 0;
          let settled = false;
          const sseTransform = responseTransform
            ? new RelaySseFormatTransform(responseTransform.sourceFormat, responseTransform.targetFormat)
            : null;
          const flushPreflight = () => {
            if (settled) return;
            preflight.start(
              () => res.writeHead(streamStatusCode, host.withRequestIdHeader(req, responseHeaders)),
              (pending) => res.write(pending),
            );
          };
          const queueOutput = (data: Buffer) => {
            if (!data.length || settled) return;
            if (!preflight.write(data, (chunk) => res.write(chunk))) {
              settled = true;
              destroyRelayUpstreamResponse(proxyRes);
              resolve({
                handled: false,
                success: false,
                retryable: true,
                statusCode: streamStatusCode,
                triggerError: "upstream stream exceeded preflight buffer without output",
              });
            }
          };
          sseTransform?.on("data", (data) => queueOutput(Buffer.from(data)));
          sseTransform?.on("error", (error) => destroyRelayUpstreamResponse(proxyRes, error));

          let buffer = "";
          let safetyCarry = "";
          let usageCarry = "";
          const MAX_BUFFER_SIZE = 256 * 1024; // Reduced to 256KB to prevent memory issues on low-memory servers
          let streamChunkPromise: Promise<void> = Promise.resolve();

          const applyUsageLine = (line: string) => {
            consumeRelayStreamUsageLine(line, requestFormat, streamUsage, () => {
              preflight.markVisible();
              flushPreflight();
            });
          };

          proxyRes.on("data", (chunk) => {
            streamChunkPromise = streamChunkPromise.then(async () => {
              if (typeof proxyRes.pause === "function") proxyRes.pause();
              preflightRawBytes += chunk.length;
              let outputChunk = chunk as Buffer;
              try {
                const combinedSafetyText = safetyCarry + outputChunk.toString("utf8");
                const combinedUsageText = usageCarry + outputChunk.toString("utf8");
                const usageLines = combinedUsageText.split("\n");
                usageCarry = usageLines.pop() || "";
                usageLines.forEach(applyUsageLine);
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
                    destroyRelayUpstreamResponse(proxyRes);
                    if (!res.writableEnded) res.end();
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
                  if (sseTransform) sseTransform.write(outputChunk);
                  else queueOutput(outputChunk);
                }
                if (!preflight.hasVisibleOutput && preflightRawBytes > preflightBufferLimit && !settled) {
                  settled = true;
                  destroyRelayUpstreamResponse(proxyRes);
                  resolve({
                    handled: false,
                    success: false,
                    retryable: true,
                    statusCode: streamStatusCode,
                    triggerError: "upstream stream exceeded preflight buffer without output",
                  });
                  return;
                }
              } catch {
                destroyRelayUpstreamResponse(proxyRes);
                if (!res.writableEnded) res.end();
                return;
              } finally {
                if (!proxyRes.destroyed && typeof proxyRes.resume === "function") proxyRes.resume();
              }

              // Log first chunk for debugging Gemini responses
              if (requestFormat === "gemini" && !buffer)
                logger.debug("Gemini first chunk", {
                  chunk: outputChunk.toString().substring(0, 500),
                  statusCode: proxyRes.statusCode,
                  headers: proxyRes.headers,
                });

              buffer += outputChunk.toString();

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

              lines.forEach(applyUsageLine);
            });
          });

          proxyRes.on("end", async () => {
            streamCompleted = true;

            try {
              await streamChunkPromise;
            } catch (error) {
              destroyRelayUpstreamResponse(proxyRes, error instanceof Error ? error : undefined);
              if (!res.writableEnded) res.end();
              reject(error);
              return;
            }
            if (settled) return;
            if (usageCarry) applyUsageLine(usageCarry);
            if (buffer) {
              const trailingLines = buffer.split("\n");
              trailingLines.forEach(applyUsageLine);
              buffer = "";
            }

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
                    destroyRelayUpstreamResponse(proxyRes);
                    res.end();
                    return;
                  }
                  safetyCarry = tailSafety.action === "blackhole" ? tailSafety.text : safetyCarry;
                }
                if (sseTransform) sseTransform.write(Buffer.from(safetyCarry, "utf8"));
                else queueOutput(Buffer.from(safetyCarry, "utf8"));
              } catch {
                destroyRelayUpstreamResponse(proxyRes);
                if (!res.writableEnded) res.end();
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
            if (!preflight.hasVisibleOutput && !settled) {
              settled = true;
              resolve({
                handled: false,
                success: false,
                retryable: true,
                statusCode: streamStatusCode,
                triggerError: "upstream stream ended without output",
              });
              return;
            }

            if (!preflight.isStarted && preflight.hasVisibleOutput) flushPreflight();

            // Only end response if client is still connected
            if (!res.writableEnded && !clientDisconnected) {
              sseTransform?.end();
              res.end();
            }

            const normalizedStreamTokens = streamUsage.normalized();

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
                statusCode: proxyRes.statusCode || 200,
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
              reject(error);
              return;
            }

            settled = true;
            resolve({
              handled: true,
              success: true,
              retryable: false,
              statusCode: proxyRes.statusCode || 200,
              timeToFirstByte:
                firstByteTime === null ? undefined : Math.max(0, firstByteTime - startTime - stats.durationMs),
            });
          });

          proxyRes.on("error", (err) => {
            streamCompleted = true;
            if (settled) return;
            if (clientDisconnected) {
              settled = true;
              resolve({ handled: true, success: true, retryable: false, clientDisconnected: true });
              return;
            }
            if (!res.writableEnded && !clientDisconnected) res.end();

            reject(err);
          });
        },
      );

      proxyReq.on("timeout", () => {
        if (clientDisconnected) {
          resolve({ handled: true, success: true, retryable: false, clientDisconnected: true });
          return;
        }
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
}
