import type { Request, Response, NextFunction } from "express";
import { EnvSpace } from "../config/env";
import chalk from "chalk";
import { getLogger, LogCategory } from "@/util/logger";
import { LogService } from "@/services/system/log.service";

type ResponseChunkEncoding =
  | "ascii"
  | "utf8"
  | "utf-8"
  | "utf16le"
  | "utf-16le"
  | "ucs2"
  | "ucs-2"
  | "base64"
  | "base64url"
  | "latin1"
  | "binary"
  | "hex";

const isDev = EnvSpace.isDevelopment;
const logger = getLogger("LoggingMiddleware", LogCategory.MIDDLEWARE);
const logService = new LogService();

export function disposeRequestLogService(): Promise<void> {
  return logService.dispose();
}

// Maximum response body size to capture (1MB)
const MAX_RESPONSE_BODY_SIZE = 1024 * 1024;
const TEXT_RESPONSE_CONTENT_TYPE_KEYWORDS = [
  "application/json",
  "application/problem+json",
  "application/vnd.api+json",
  "application/x-ndjson",
  "application/xml",
  "application/javascript",
  "text/",
  "text/event-stream",
];

const utf8TextDecoder = new TextDecoder("utf-8", { fatal: true });

function getHeaderByteSize(value: string | string[] | undefined): number | null {
  if (!value) return null;

  const rawValue = Array.isArray(value) ? value[0] : value;
  const byteSize = Number.parseInt(rawValue, 10);
  return Number.isFinite(byteSize) && byteSize >= 0 ? byteSize : null;
}

function getBodyByteSize(body: any): number | null {
  if (body === undefined || body === null) return null;
  if (Buffer.isBuffer(body)) return body.length;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof Uint8Array) return body.byteLength;

  return null;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function getRequestSize(req: Request, res: Response) {
  const bodyBytes = getBodyByteSize(req.body);
  const contentLengthBytes =
    typeof res.locals.requestSize?.contentLengthBytes === "number"
      ? res.locals.requestSize.contentLengthBytes
      : getHeaderByteSize(req.headers["content-length"]);

  return {
    bodyBytes,
    contentLengthBytes,
    displayBytes: bodyBytes ?? contentLengthBytes,
    contentType: req.headers["content-type"],
    transferEncoding: req.headers["transfer-encoding"],
  };
}

function summarizeBodyForDevLog(body: any): any {
  if (Buffer.isBuffer(body)) return { _buffer: true, _size: body.length };
  return body;
}

function getResponseContentType(res: Response): string {
  const contentType = res.getHeader("content-type");
  return String(Array.isArray(contentType) ? contentType[0] || "" : contentType || "").toLowerCase();
}

function isProbablyUtf8TextBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  if (buffer.includes(0)) return false;

  let decoded = "";
  try {
    decoded = utf8TextDecoder.decode(buffer);
  } catch {
    return false;
  }

  let suspiciousControlChars = 0;
  for (const char of decoded) {
    const code = char.charCodeAt(0);
    const isAllowedWhitespace = code === 9 || code === 10 || code === 13;
    if (code < 32 && !isAllowedWhitespace) suspiciousControlChars += 1;
  }

  return suspiciousControlChars === 0;
}

function looksLikeJsonText(rawText: string): boolean {
  const trimmed = rawText.trim();
  if (!trimmed) return false;

  return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function isTextLikeResponse(res: Response, chunk: unknown): boolean {
  if (typeof chunk === "string") return true;

  const contentType = getResponseContentType(res);
  const hasTextLikeContentType = TEXT_RESPONSE_CONTENT_TYPE_KEYWORDS.some((keyword) => contentType.includes(keyword));
  if (hasTextLikeContentType) return true;
  if (contentType) return false;

  return Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
    ? isProbablyUtf8TextBuffer(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    : false;
}

function getRequestPath(req: Request): string {
  return (req.originalUrl || req.url || req.path || "").split("?")[0] || "";
}

function resolveWriteHeadHeadersArg(args: any[]): unknown {
  if (args.length === 0) return undefined;

  const [firstArg, secondArg] = args;

  if (Array.isArray(firstArg) || (firstArg && typeof firstArg === "object")) return firstArg;
  if (typeof firstArg === "string" && (Array.isArray(secondArg) || (secondArg && typeof secondArg === "object")))
    return secondArg;

  return undefined;
}

function captureWriteHeadHeaders(res: Response, headersArg: unknown): void {
  if (!headersArg) return;

  const snapshot: Record<string, unknown> =
    res.locals.responseHeadersSnapshot && typeof res.locals.responseHeadersSnapshot === "object"
      ? { ...(res.locals.responseHeadersSnapshot as Record<string, unknown>) }
      : {};

  if (Array.isArray(headersArg))
    for (let index = 0; index < headersArg.length - 1; index += 2) {
      const key = headersArg[index];
      const value = headersArg[index + 1];
      if (typeof key !== "string" || value === undefined) continue;
      snapshot[key.toLowerCase()] = value;
    }
  else
    for (const [key, value] of Object.entries(headersArg as Record<string, unknown>)) {
      if (value === undefined) continue;
      snapshot[key.toLowerCase()] = value;
    }

  if (Object.keys(snapshot).length > 0) res.locals.responseHeadersSnapshot = snapshot;
}

function shouldSkipResponseBodyCapture(req: Request): boolean {
  const requestPath = getRequestPath(req);
  return requestPath.startsWith("/relay/proxy");
}

function toBuffer(chunk: any, encoding?: ResponseChunkEncoding): Buffer | null {
  if (chunk === undefined || chunk === null) return null;
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === "string") return Buffer.from(chunk, encoding);

  return Buffer.from(String(chunk));
}

function appendResponseChunk(res: Response, chunk: any, encoding?: ResponseChunkEncoding): void {
  if (res.locals.skipResponseBodyCapture) return;
  if (res.locals.responseBodyCaptured) return;

  const buffer = toBuffer(chunk, encoding);
  if (!buffer) return;

  if (!res.locals.responseCaptureState)
    res.locals.responseCaptureState = {
      chunks: [] as Buffer[],
      totalBytes: 0,
      truncated: false,
      isBinary: false,
      hasBody: false,
    };

  const state = res.locals.responseCaptureState;
  state.hasBody = true;
  state.totalBytes += buffer.length;

  if (!isTextLikeResponse(res, chunk)) {
    state.isBinary = true;
    if (state.totalBytes > MAX_RESPONSE_BODY_SIZE) state.truncated = true;
    return;
  }

  const capturedBytes = state.chunks.reduce((sum: number, item: Buffer) => sum + item.length, 0);
  const remaining = MAX_RESPONSE_BODY_SIZE - capturedBytes;
  if (remaining <= 0) {
    state.truncated = true;
    return;
  }

  if (buffer.length > remaining) {
    state.chunks.push(buffer.subarray(0, remaining));
    state.truncated = true;
    return;
  }

  state.chunks.push(buffer);
}

function finalizeCapturedResponse(res: Response): void {
  if (res.locals.responseBodyCaptured) return;

  const contentType = getResponseContentType(res);
  if (res.locals.skipResponseBodyCapture) {
    res.locals.responseBody = {
      _notCaptured: true,
      _reason: "Response body capture skipped for high-frequency relay proxy path",
      _contentType: contentType || null,
      _statusCode: res.statusCode,
      _closedEarly: res.locals.responseClosedEarly === true,
    };
    res.locals.responseBodyCaptured = true;
    return;
  }

  const state = res.locals.responseCaptureState;

  if (!state?.hasBody) {
    res.locals.responseBody = {
      _empty: true,
      _contentType: contentType || null,
      _statusCode: res.statusCode,
      _closedEarly: res.locals.responseClosedEarly === true,
    };
    res.locals.responseBodyCaptured = true;
    return;
  }

  if (state.isBinary) {
    res.locals.responseBody = {
      _binary: true,
      _size: state.totalBytes,
      _truncated: state.truncated,
      _contentType: contentType || null,
      _statusCode: res.statusCode,
      _closedEarly: res.locals.responseClosedEarly === true,
    };
    res.locals.responseBodyCaptured = true;
    return;
  }

  const rawText = Buffer.concat(state.chunks).toString("utf8");
  if (state.truncated) {
    res.locals.responseBody = {
      _truncated: true,
      _size: state.totalBytes,
      _preview: rawText,
      _contentType: contentType || null,
      _statusCode: res.statusCode,
      _closedEarly: res.locals.responseClosedEarly === true,
    };
    res.locals.responseBodyCaptured = true;
    return;
  }

  if (!rawText) {
    res.locals.responseBody = {
      _empty: true,
      _contentType: contentType || null,
      _statusCode: res.statusCode,
      _closedEarly: res.locals.responseClosedEarly === true,
    };
    res.locals.responseBodyCaptured = true;
    return;
  }

  if (contentType.includes("application/json") || contentType.includes("+json") || looksLikeJsonText(rawText))
    try {
      res.locals.responseBody = JSON.parse(rawText);
      res.locals.responseBodyCaptured = true;
      return;
    } catch {
      // fall through to raw text storage
    }

  res.locals.responseBody = rawText;
  res.locals.responseBodyCaptured = true;
}

export function loggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const originalWriteHead = res.writeHead.bind(res);
  res.locals.skipResponseBodyCapture = shouldSkipResponseBodyCapture(req);

  res.write = function (chunk: any, ...args: any[]) {
    const encoding = typeof args[0] === "string" ? (args[0] as ResponseChunkEncoding) : undefined;
    appendResponseChunk(res, chunk, encoding);
    return originalWrite(chunk, ...args);
  } as typeof res.write;

  res.end = function (chunk?: any, ...args: any[]) {
    const encoding = typeof args[0] === "string" ? (args[0] as ResponseChunkEncoding) : undefined;
    appendResponseChunk(res, chunk, encoding);
    return originalEnd(chunk, ...args);
  } as typeof res.end;

  res.writeHead = function (statusCode: number, ...args: any[]) {
    captureWriteHeadHeaders(res, resolveWriteHeadHeadersArg(args));
    return originalWriteHead(statusCode, ...args);
  } as typeof res.writeHead;

  // 在开发模式下记录详细的请求信息
  if (isDev) {
    const maskedHeaders = { ...req.headers };
    if (maskedHeaders["x-api-key"]) maskedHeaders["x-api-key"] = "***FILTERED***";
    if (maskedHeaders["authorization"]) maskedHeaders["authorization"] = "***FILTERED***";
    const requestSize = getRequestSize(req, res);
    logger.debug(chalk.gray(`Headers: ${JSON.stringify(maskedHeaders)}`));
    logger.debug(chalk.gray(`RequestSize: ${JSON.stringify(requestSize)}`));
    logger.debug(chalk.gray(`Query: ${JSON.stringify(req.query)}`));
    logger.debug(chalk.gray(`Params: ${JSON.stringify(req.params)}`));
    logger.debug(chalk.gray(`Body: ${JSON.stringify(summarizeBodyForDevLog(req.body))}`));
  }

  // Use once() instead of on() to automatically remove listener after first fire
  let requestLogged = false;

  const cleanup = () => {
    delete res.locals.responseBody;
    delete res.locals.responseBodyCaptured;
    delete res.locals.responseCaptureState;
    delete res.locals.responseClosedEarly;
    delete res.locals.responseHeadersSnapshot;
    delete res.locals.skipResponseBodyCapture;
    delete res.locals.requestSize;
  };

  const persistLog = () => {
    if (requestLogged) return;
    requestLogged = true;

    finalizeCapturedResponse(res);

    logService.logRequest(req, res, res.locals.responseBody).catch((error) => {
      logger.error("Failed to log request to database", { error });
    });
  };

  const finishHandler = () => {
    const duration = Date.now() - start;
    const requestSize = getRequestSize(req, res);

    // 控制台日志（带颜色）
    let statusColor = chalk.green;
    if (res.statusCode >= 400 && res.statusCode < 500) statusColor = chalk.yellow;
    else if (res.statusCode >= 500) statusColor = chalk.red;

    const logMessage = `[${req.method}] ${req.originalUrl} - ${res.statusCode} (${duration}ms, req=${formatBytes(requestSize.displayBytes)})`;
    logger.http(statusColor(logMessage), requestSize);

    persistLog();
    cleanup();
  };

  res.once("finish", finishHandler);

  // Also handle case where connection closes before finish
  res.once("close", () => {
    if (!requestLogged) {
      res.locals.responseClosedEarly = true;
      persistLog();
    }
    cleanup();
  });

  next();
}
