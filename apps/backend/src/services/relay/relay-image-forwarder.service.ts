import axios from "axios";
import http from "http";
import https from "https";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import type { RelayToken } from "@prisma/client";
import type { RelayProxyStore } from "@/store/relay/relay-proxy.store";
import { trackErrorForIp } from "@/middleware/error-tracker";
import { PayloadTooLargeError } from "@/util/errors";
import { shouldRetryRelayUpstreamFailure } from "@/util/relay";
import type {
  ImageForwardResult,
  RelayImageForwardParams,
  RelayImageUsageParams,
  RelayRequestLike,
  RelayUpstreamAgents,
  SelectedRateConfig,
} from "./types/relay-proxy.types";
import type { ContextLengthMultiplierRule } from "./context-length-multiplier.service";

type UpstreamAgents = RelayUpstreamAgents;
const directUpstreamAgents: UpstreamAgents = {
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
};
import { DEFAULT_CACHE_CREATION_MULTIPLIER, DEFAULT_CACHE_READ_MULTIPLIER } from "@/constant/pricing";

export interface RelayImageForwarderHost {
  buildForwardBodyBuffer: (body: unknown) => Buffer;
  chargeForwardedImageUsage: (params: RelayImageUsageParams) => Promise<void>;
  extractUpstreamErrorMessage: (body: unknown, statusCode?: number) => string;
  getLogicalRequestId: (req: RelayRequestLike) => string;
  isPerRequestPricingConfig: (rateConfig: any) => boolean;
  parseBufferedUpstreamBody: (body: Buffer, headers: Record<string, unknown>) => unknown;
  readStreamBodyLimited: (
    stream: unknown,
    maxBytes: number,
    onFirstChunk?: () => void,
  ) => Promise<{ buffer: Buffer; truncated: boolean; bytesRead: number }>;
  relayProxyRepository: RelayProxyStore;
  sanitizeResponseHeaders: (
    headers: Record<string, unknown>,
    options?: { keepContentLength?: boolean },
  ) => Record<string, unknown>;
  withRequestIdHeader: (req: RelayRequestLike, headers: Record<string, unknown>) => Record<string, unknown>;
}

export class RelayImageForwarderService {
  async forward(params: RelayImageForwardParams, host: RelayImageForwarderHost): Promise<ImageForwardResult> {
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
      params.relayGlobalMultiplier,
      params.channelMultiplier,
      params.executionChannelId,
      params.displayChannelId,
      params.displayChannelName,
      params.channelId,
      params.monthlyPassCoverageAt,
      params.timeoutMs,
      params.maxBodyBytes,
      params.allowRetryBeforeResponse,
      params.retryStatusCodes,
      params.inputTokensIncludeCacheRead,
      params.originalRequestedModel,
      params.requestAgents || directUpstreamAgents,
      host,
    );
  }

  private async forwardLegacy(
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
    contextLengthMultipliers: ContextLengthMultiplierRule[] | undefined,
    convertedBody: any,
    relayGlobalMultiplier: number,
    channelMultiplier: number,
    executionChannelId: string,
    displayChannelId: string | null,
    displayChannelName: string | null,
    channelId: string,
    monthlyPassCoverageAt: Date,
    timeoutMs: number,
    maxBodyBytes: number,
    allowRetryBeforeResponse: boolean,
    retryStatusCodes: string[],
    inputTokensIncludeCacheRead: boolean,
    originalRequestedModel: string | undefined,
    requestAgents: UpstreamAgents,
    host: RelayImageForwarderHost,
  ): Promise<ImageForwardResult> {
    const bodyData = host.buildForwardBodyBuffer(convertedBody);
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
      proxy: false,
      httpAgent: requestAgents.httpAgent,
      httpsAgent: requestAgents.httpsAgent,
    });

    const statusCode = response.status || 200;
    const upstreamHeaders = response.headers || {};
    const isErrorResponse = statusCode >= 400;
    const responseStream = response.data as Readable;

    if (isErrorResponse) {
      const { buffer, truncated } = await host.readStreamBodyLimited(responseStream, 100 * 1024, () => {
        if (firstByteTime === null) firstByteTime = Date.now();
      });
      const upstreamData = host.parseBufferedUpstreamBody(buffer, upstreamHeaders);
      const upstreamMessage = host.extractUpstreamErrorMessage(upstreamData, statusCode);

      try {
        await trackErrorForIp(req, statusCode);
      } catch {
        // tracking failure must not block the response
      }

      if (allowRetryBeforeResponse && shouldRetryRelayUpstreamFailure(statusCode, upstreamData, retryStatusCodes))
        return {
          handled: false,
          success: false,
          retryable: true,
          statusCode,
          triggerError: truncated ? `${upstreamMessage} (error body truncated)` : upstreamMessage,
        };

      const isPerRequestPricing = host.isPerRequestPricingConfig(selectedRateConfig);
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
        statusCode,
        ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
        totalOutputTime: Date.now() - startTime,
        timeToFirstByte: firstByteTime === null ? null : firstByteTime - startTime,
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
        headers: host.withRequestIdHeader(req, upstreamHeaders),
        data,
        timeToFirstByte: firstByteTime === null ? undefined : firstByteTime - startTime,
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
    res.writeHead(statusCode, host.withRequestIdHeader(req, host.sanitizeResponseHeaders(upstreamHeaders)));

    try {
      await pipeline(responseStream, byteCounter, res);
    } finally {
      req.off("close", clientCloseHandler);
    }

    if (!clientDisconnected)
      await host.chargeForwardedImageUsage({
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
        contextLengthMultipliers,
        timeMultiplier,
        originalModel: originalRequestedModel,
      });

    return {
      handled: true,
      success: true,
      retryable: false,
      statusCode,
      headers: {},
      data: {},
      timeToFirstByte: firstByteTime === null ? undefined : firstByteTime - startTime,
    };
  }
}
