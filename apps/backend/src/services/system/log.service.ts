import { Request, Response } from "express";
import { APILogRepository, CreateAPILogParams } from "@/store/system/apilog";
import type { APILogStore } from "@/store/system/apilog.store";
import { getLogger, LogCategory } from "@/util/logger";
import {
  SENSITIVE_FIELDS,
  EXCLUDE_RESPONSE_PATHS,
  INTERNAL_LOG_METADATA_KEY,
  ALWAYS_SKIP_LOGGING_PATHS,
  SKIP_LOGGING_PATHS,
  SKIP_LOGGING_STATUS_CODES,
  MAX_RESPONSE_SIZE,
  MAX_REQUEST_PARAMS_SIZE,
  MAX_DEPTH,
} from "@/config/logging";

const logger = getLogger("LogService", LogCategory.BUSINESS);

/** 写缓冲：积攒日志条目，定期批量写入，减少 DB IO */
const FLUSH_INTERVAL_MS = 2000; // 每 2 秒刷一次
const FLUSH_MAX_BATCH = 100; // 单次最多写入条数
const BUFFER_HARD_CAP = 500; // 缓冲区硬上限：超过时丢弃最旧的条目，防止内存无限增长

export interface LogServiceOptions {
  autoStartTimer?: boolean;
  registerShutdownHandlers?: boolean;
  flushIntervalMs?: number;
  flushMaxBatch?: number;
  bufferHardCap?: number;
}

/**
 * 日志服务类
 * 负责处理 API 请求日志的异步记录（写缓冲 + 批量插入，减少磁盘 IO）
 */
export class LogService {
  private readonly apiLogRepo: APILogStore;
  private readonly flushIntervalMs: number;
  private readonly flushMaxBatch: number;
  private readonly bufferHardCap: number;
  private readonly shouldRegisterShutdownHandlers: boolean;

  /** 实例级写缓冲，避免多个 LogService 之间互相污染 */
  private buffer: CreateAPILogParams[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushPromise: Promise<void> | null = null;
  private shutdownRegistered = false;

  private readonly handleSigterm = this.createFlushAndExitHandler("SIGTERM");
  private readonly handleSigint = this.createFlushAndExitHandler("SIGINT");
  private readonly handleBeforeExit = async () => {
    await this.flushUntilIdle();
  };

  constructor(apiLogRepo: APILogStore = APILogRepository.getInstance(), options: LogServiceOptions = {}) {
    this.apiLogRepo = apiLogRepo;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.flushMaxBatch = options.flushMaxBatch ?? FLUSH_MAX_BATCH;
    this.bufferHardCap = options.bufferHardCap ?? BUFFER_HARD_CAP;
    this.shouldRegisterShutdownHandlers = options.registerShutdownHandlers ?? true;

    if (options.autoStartTimer ?? true) this.start();
  }

  public start(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.flushNow().catch(() => {});
    }, this.flushIntervalMs);

    // 允许进程在无请求时自然退出
    this.flushTimer.unref?.();

    if (this.shouldRegisterShutdownHandlers) this.registerShutdownHandlers();
  }

  public stop(): void {
    if (!this.flushTimer) return;

    clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  public async flushNow(): Promise<void> {
    if (this.flushPromise) {
      await this.flushPromise;
      if (this.buffer.length > 0) await this.flushNow();
      return;
    }

    if (this.buffer.length === 0) return;

    const currentFlush = this.flushBufferedBatches();
    this.flushPromise = currentFlush;
    try {
      await currentFlush;
    } finally {
      if (this.flushPromise === currentFlush) this.flushPromise = null;
    }

    if (this.buffer.length > 0) await this.flushNow();
  }

  public async dispose(options: { flush?: boolean } = {}): Promise<void> {
    this.stop();
    this.unregisterShutdownHandlers();

    if (options.flush !== false) await this.flushUntilIdle();
  }

  /** 注册进程信号处理，确保退出前把缓冲中的日志全部写入 DB */
  private registerShutdownHandlers(): void {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;

    process.once("SIGTERM", this.handleSigterm);
    process.once("SIGINT", this.handleSigint);
    // beforeExit 在 event loop 空时触发（非 process.exit() 调用）
    process.once("beforeExit", this.handleBeforeExit);
  }

  private unregisterShutdownHandlers(): void {
    if (!this.shutdownRegistered) return;

    process.removeListener("SIGTERM", this.handleSigterm);
    process.removeListener("SIGINT", this.handleSigint);
    process.removeListener("beforeExit", this.handleBeforeExit);
    this.shutdownRegistered = false;
  }

  private createFlushAndExitHandler(signal: string) {
    return async () => {
      logger.info(`[LogService] Received ${signal}, flushing log buffer...`);
      await this.flushUntilIdle();
      process.exit(0);
    };
  }

  private async flushUntilIdle(): Promise<void> {
    while (this.flushPromise || this.buffer.length > 0) await this.flushNow().catch(() => {});
  }

  /** 把缓冲中的日志批量写入 DB */
  private async flushBufferedBatches(): Promise<void> {
    while (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, this.flushMaxBatch);

      try {
        if (batch.length === 1)
          // 只有 1 条时走 create，保留 P2002 去重重试逻辑
          await this.apiLogRepo.create(batch[0]);
        else
          // 多条时用 createMany + skipDuplicates，一次 IO 替代 N 次
          await this.apiLogRepo.createMany(batch);
      } catch (error) {
        logger.error("Failed to flush API log batch", { error, count: batch.length });
      }
    }
  }

  private filterSensitiveData(data: any, isTopLevel: boolean = true): any {
    if (!data || typeof data !== "object") return data;

    if (Buffer.isBuffer(data)) return { _buffer: true, _size: data.length };

    if (Array.isArray(data)) return data.map((item) => this.filterSensitiveData(item, false));

    const filtered: any = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      if (SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()))) filtered[key] = "***FILTERED***";
      else if (!isTopLevel && key === "response" && typeof value === "object")
        filtered[key] = {
          _simplified: true,
          _note: "Response content simplified to prevent nesting",
        };
      else if (typeof value === "object" && value !== null) filtered[key] = this.filterSensitiveData(value, false);
      else filtered[key] = value;
    }
    return filtered;
  }

  private getClientIP(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : forwarded[0];

    return req.ip || req.socket.remoteAddress || "unknown";
  }

  private getUserID(req: Request): string | undefined {
    return (req as any).user?.userId;
  }

  private limitDepth(obj: any, maxDepth: number = 3, currentDepth: number = 0): any {
    if (currentDepth >= maxDepth)
      return typeof obj === "object" && obj !== null
        ? { _depthLimitReached: true, _type: Array.isArray(obj) ? "array" : "object" }
        : obj;

    if (!obj || typeof obj !== "object") return obj;

    if (Array.isArray(obj)) return obj.map((item) => this.limitDepth(item, maxDepth, currentDepth + 1));

    const limited: any = {};
    for (const [key, value] of Object.entries(obj)) limited[key] = this.limitDepth(value, maxDepth, currentDepth + 1);

    return limited;
  }

  private truncateRequestParams(params: any, maxSize: number): any {
    if (!params) return params;

    if (Buffer.isBuffer(params)) return { _buffer: true, _size: params.length };

    const paramsStr = JSON.stringify(params);
    if (paramsStr.length <= maxSize) return params;

    return {
      _truncated: true,
      _originalSize: paramsStr.length,
      _summary: `Request params truncated (${paramsStr.length} chars, max ${maxSize})`,
      _preview: paramsStr.substring(0, maxSize),
    };
  }

  private parseContentLengthHeader(value: unknown): number | null {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const parsed =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? Number.parseInt(rawValue, 10)
          : Number.NaN;

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  private estimatePayloadSizeBytes(payload: any): number | null {
    if (payload === null || payload === undefined) return null;
    if (Buffer.isBuffer(payload)) return payload.length;
    if (payload instanceof Uint8Array) return payload.byteLength;
    if (typeof payload === "string") return Buffer.byteLength(payload);

    try {
      return Buffer.byteLength(JSON.stringify(payload));
    } catch {
      return null;
    }
  }

  private getResponseSizeBytes(res: Response, responseBody?: any): number | null {
    const headerSize = this.parseContentLengthHeader(res.getHeader?.("content-length"));
    if (headerSize !== null) return headerSize;

    return this.estimatePayloadSizeBytes(responseBody);
  }

  private normalizeHeaderValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map((item) => this.normalizeHeaderValue(item));
    if (Buffer.isBuffer(value)) return value.toString("utf8");
    if (value instanceof Date) return value.toISOString();

    return String(value);
  }

  private captureResponseHeaders(res: Response): Record<string, unknown> {
    const cachedHeaders = res.getHeaders?.() || {};
    const writeHeadHeaders =
      res.locals?.responseHeadersSnapshot && typeof res.locals.responseHeadersSnapshot === "object"
        ? (res.locals.responseHeadersSnapshot as Record<string, unknown>)
        : {};
    const headers = {
      ...cachedHeaders,
      ...writeHeadHeaders,
    };
    const normalized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      normalized[key] = this.normalizeHeaderValue(value);
    }

    return normalized;
  }

  private attachInternalLogMetadata(headers: any, metadata: Record<string, unknown>): any {
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) return headers;

    return {
      ...headers,
      [INTERNAL_LOG_METADATA_KEY]: metadata,
    };
  }

  private matchesConfiguredPath(requestPathname: string, configuredPath: string): boolean {
    return requestPathname === configuredPath || requestPathname.startsWith(`${configuredPath}/`);
  }

  private matchesAnyConfiguredPath(requestPathname: string, configuredPaths: readonly string[]): boolean {
    return configuredPaths.some((configuredPath) => this.matchesConfiguredPath(requestPathname, configuredPath));
  }

  /**
   * 记录 API 请求日志（写入缓冲，由定时器批量刷入 DB）
   */
  public async logRequest(req: Request, res: Response, responseBody?: any): Promise<void> {
    try {
      let requestID = req.headers["x-request-id"] as string;
      if (!requestID) requestID = `generated-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const requestPath = req.originalUrl || req.url;
      const requestPathname = requestPath.split("?")[0] || requestPath;

      const shouldAlwaysSkipPath = this.matchesAnyConfiguredPath(requestPathname, ALWAYS_SKIP_LOGGING_PATHS);
      if (shouldAlwaysSkipPath) return;

      // 对高频路径区分处理：成功响应跳过记录（减少 IO），错误响应仍然记录（保留可观测性）
      const isHighFreqPath = this.matchesAnyConfiguredPath(requestPathname, SKIP_LOGGING_PATHS);
      if (isHighFreqPath && res.statusCode < 400) return;

      // 跳过配置的状态码（如 401 token 过期）
      if (SKIP_LOGGING_STATUS_CODES.includes(res.statusCode)) return;

      const shouldExcludeResponse = this.matchesAnyConfiguredPath(requestPathname, EXCLUDE_RESPONSE_PATHS);
      const responseSizeBytes = this.getResponseSizeBytes(res, responseBody);
      const responseContentType = res.getHeader?.("content-type");
      const filteredResponseHeaders = this.filterSensitiveData(this.captureResponseHeaders(res));

      let filteredResponse: any = {
        _notCaptured: true,
        _responseSizeBytes: responseSizeBytes,
        _contentType: Array.isArray(responseContentType)
          ? (responseContentType[0] ?? null)
          : (responseContentType ?? null),
        _statusCode: res.statusCode,
      };

      if (!shouldExcludeResponse && responseBody !== undefined) {
        let parsedResponse = responseBody;
        if (responseBody === null)
          parsedResponse = {
            _literal: null,
          };
        else if (typeof responseBody === "string")
          try {
            parsedResponse = JSON.parse(responseBody);
          } catch {
            parsedResponse = responseBody;
          }

        filteredResponse = this.filterSensitiveData(parsedResponse);
        filteredResponse = this.limitDepth(filteredResponse, MAX_DEPTH);

        if (filteredResponse) {
          const responseStr = JSON.stringify(filteredResponse);
          if (responseStr.length > MAX_RESPONSE_SIZE)
            filteredResponse = {
              _truncated: true,
              _originalSize: responseStr.length,
              _summary: `Response truncated (${responseStr.length} chars)`,
              code: filteredResponse?.code,
              message: filteredResponse?.message,
            };
        }
      } else if (shouldExcludeResponse)
        filteredResponse = {
          _excluded: true,
          _reason: "Response body excluded to prevent recursive logging",
        };

      const filteredRequestHeaders = this.attachInternalLogMetadata(this.filterSensitiveData(req.headers), {
        responseSizeBytes,
      });

      const logParams: CreateAPILogParams = {
        requestID,
        userID: this.getUserID(req),
        path: requestPathname,
        method: req.method,
        queryParams:
          Object.keys(req.query || {}).length > 0
            ? this.truncateRequestParams(this.filterSensitiveData(req.query), MAX_REQUEST_PARAMS_SIZE)
            : null,
        bodyParams:
          Object.keys(req.body || {}).length > 0
            ? this.truncateRequestParams(this.filterSensitiveData(req.body), MAX_REQUEST_PARAMS_SIZE)
            : null,
        requestHeaders: filteredRequestHeaders,
        ipAddress: this.getClientIP(req),
        response: filteredResponse,
        responseHeaders: filteredResponseHeaders,
        statusCode: res.statusCode,
      };

      // 只写入缓冲，刷入完全由定时器驱动，避免与定时器 flush 产生竞态条件
      // 硬上限保护：缓冲区满时丢弃最旧条目，防止内存无限增长
      if (this.buffer.length >= this.bufferHardCap) {
        this.buffer.shift();
        logger.warn("API log buffer full, oldest entry dropped", { bufferSize: this.bufferHardCap });
      }
      this.buffer.push(logParams);
    } catch (error) {
      logger.error("Error in logRequest", { error });
    }
  }
}
