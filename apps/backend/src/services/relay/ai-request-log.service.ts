import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { SENSITIVE_FIELDS } from "@/config/logging";
import { AI_REQUEST_LOG_LIMITS } from "@/constant/ai-request-log";
import { getLogger, LogCategory } from "@/util/logger";
import { extractClientIp } from "@/util/ip-extractor";
import { getAIRequestLogContext } from "@/util/ai-request-log-context";
import { AIRequestLogRepository } from "@/store/system/ai-request-log.repository";
import type { AIRequestLogDetailDto, AIRequestLogListItemDto } from "@/api/dto/relay/ai-request-log.dto";
import type { AIRequestLogListItem, AIRequestLogQuery, AIRequestLogStore } from "@/store/system/ai-request-log.store";

const logger = getLogger("AIRequestLogService", LogCategory.BUSINESS);
const MAX_SANITIZE_DEPTH = 12;
const IMAGE_LIKE_KEYS = new Set([
  "image",
  "imageurl",
  "image_url",
  "input_image",
  "inputimage",
  "inline_data",
  "inlinedata",
  "file_data",
  "filedata",
  "b64_json",
  "b64json",
  "base64",
  "image_base64",
  "imagebase64",
]);

type PreparedPayload = {
  value?: Prisma.InputJsonValue;
  byteSize: number | null;
  truncated: boolean;
};

function isImageLikeKey(key: string): boolean {
  return IMAGE_LIKE_KEYS.has(key) || IMAGE_LIKE_KEYS.has(key.toLowerCase());
}

function normalizeSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeSensitiveKey(key);
  return SENSITIVE_FIELDS.some((field) => normalized === normalizeSensitiveKey(field));
}

function binaryPlaceholder(size?: number, contentType?: string): Prisma.InputJsonObject {
  return {
    _binary: true,
    ...(size === undefined ? {} : { _size: size }),
    ...(contentType ? { _contentType: contentType } : {}),
  };
}

function stringByteSize(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString("utf8");
}

export class AIRequestLogService {
  private static instance: AIRequestLogService;

  public static getInstance(): AIRequestLogService {
    if (!this.instance) this.instance = new AIRequestLogService();
    return this.instance;
  }

  private constructor(private readonly repository: AIRequestLogStore = AIRequestLogRepository.getInstance()) {}

  public async logRequest(req: Request, res: Response, responseBody?: unknown, durationMs = 0): Promise<void> {
    const context = getAIRequestLogContext(res);
    if (!context) return;

    const requestId = context.requestId || String(req.headers["x-request-id"] || randomUUID());
    const requestPayload = this.preparePayload(this.unwrapRequestBody(req), AI_REQUEST_LOG_LIMITS.requestBodyBytes);
    const responsePayload = this.preparePayload(responseBody, AI_REQUEST_LOG_LIMITS.responseBodyBytes);
    const requestBody = requestPayload.value;
    const responseJsonBody = responsePayload.value;
    const requestPath = String(req.originalUrl || req.url || req.path || "").split("?")[0] || "";

    try {
      await this.repository.create({
        requestId,
        userId: context.userId || undefined,
        username: context.username || undefined,
        relayTokenId: context.relayTokenId || undefined,
        relayTokenName: context.relayTokenName || undefined,
        model: context.model || undefined,
        requestFormat: context.requestFormat || undefined,
        path: requestPath,
        method: req.method,
        statusCode: res.statusCode,
        ipAddress: extractClientIp(req),
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        durationMs: Math.max(0, Math.round(durationMs)),
        requestSizeBytes: requestPayload.byteSize ?? undefined,
        responseSizeBytes: responsePayload.byteSize ?? undefined,
        requestTruncated: requestPayload.truncated,
        responseTruncated: responsePayload.truncated || this.hasTruncationMarker(responseBody),
        ...(requestBody === undefined || requestBody === null ? {} : { requestBody }),
        ...(responseJsonBody === undefined || responseJsonBody === null ? {} : { responseBody: responseJsonBody }),
      });
    } catch (error) {
      logger.error("Failed to persist AI request audit log", {
        requestId,
        userId: context.userId || undefined,
        path: requestPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async query(query: AIRequestLogQuery): Promise<{ items: AIRequestLogListItemDto[]; total: number }> {
    const result = await this.repository.query(query);
    return { total: result.total, items: result.items.map((log) => this.toListItem(log)) };
  }

  public async findById(id: string): Promise<AIRequestLogDetailDto | null> {
    const log = await this.repository.findById(id);
    if (!log) return null;
    return { ...this.toListItem(log), requestBody: log.requestBody, responseBody: log.responseBody };
  }

  private toListItem(log: AIRequestLogListItem): AIRequestLogListItemDto {
    return {
      id: log.id,
      createTime: log.createTime,
      requestId: log.requestId,
      userId: log.userId,
      username: log.username,
      relayTokenId: log.relayTokenId,
      relayTokenName: log.relayTokenName,
      model: log.model,
      requestFormat: log.requestFormat,
      path: log.path,
      method: log.method,
      statusCode: log.statusCode,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      durationMs: log.durationMs,
      requestSizeBytes: log.requestSizeBytes,
      responseSizeBytes: log.responseSizeBytes,
      requestTruncated: log.requestTruncated,
      responseTruncated: log.responseTruncated,
    };
  }

  private unwrapRequestBody(req: Request): unknown {
    const body = req.body;
    if (!Buffer.isBuffer(body)) return body;
    const contentType = String(req.headers["content-type"] || "");
    if (/json/i.test(contentType))
      try {
        return JSON.parse(body.toString("utf8"));
      } catch {
        return body.toString("utf8");
      }
    return binaryPlaceholder(body.byteLength, contentType || undefined);
  }

  private preparePayload(value: unknown, maxBytes: number): PreparedPayload {
    const originalByteSize = this.estimatePayloadBytes(value);
    const sanitized = this.sanitizeValue(value, new WeakSet(), 0);
    let serialized: string;
    try {
      serialized = JSON.stringify(sanitized) ?? "null";
    } catch {
      const fallback = { _unserializable: true, _type: typeof sanitized };
      serialized = JSON.stringify(fallback);
      return { value: fallback, byteSize: stringByteSize(serialized), truncated: false };
    }

    const sanitizedByteSize = stringByteSize(serialized);
    const byteSize = originalByteSize ?? sanitizedByteSize;
    if (sanitizedByteSize <= maxBytes) return { value: sanitized as Prisma.InputJsonValue, byteSize, truncated: false };

    return {
      value: {
        _truncated: true,
        _originalSize: byteSize,
        _preview: truncateUtf8(serialized, Math.max(0, maxBytes - 256)),
      },
      byteSize,
      truncated: true,
    };
  }

  private sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return binaryPlaceholder(value.byteLength);
    if (value instanceof Uint8Array) return binaryPlaceholder(value.byteLength);
    if (typeof value === "string")
      return /^data:[^;\s]+;base64,/i.test(value)
        ? binaryPlaceholder(stringByteSize(value), value.slice(5, value.indexOf(";")))
        : value;
    if (typeof value !== "object") return value;
    if (depth >= MAX_SANITIZE_DEPTH) return { _depthLimitReached: true };
    if (seen.has(value)) return "[Circular Reference]";
    seen.add(value);

    if (Array.isArray(value)) return value.map((item) => this.sanitizeValue(item, seen, depth + 1));

    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) sanitized[key] = "***FILTERED***";
      else if (isImageLikeKey(key) || this.isBase64Payload(item)) sanitized[key] = this.describeImageLikeValue(item);
      else sanitized[key] = this.sanitizeValue(item, seen, depth + 1);
    }
    return sanitized;
  }

  private isBase64Payload(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const payload = value as { type?: unknown; data?: unknown };
    return payload.type === "base64" && typeof payload.data === "string";
  }

  private describeImageLikeValue(value: unknown): Prisma.InputJsonObject {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return binaryPlaceholder(value.byteLength);
    if (typeof value === "string") return binaryPlaceholder(stringByteSize(value), "image");
    try {
      return binaryPlaceholder(stringByteSize(JSON.stringify(value)), "image");
    } catch {
      return binaryPlaceholder(undefined, "image");
    }
  }

  private estimatePayloadBytes(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (Buffer.isBuffer(value)) return value.byteLength;
    if (value instanceof Uint8Array) return value.byteLength;
    if (typeof value === "string") return stringByteSize(value);
    if (typeof value === "object" && value !== null) {
      const metadataSize = (value as { _size?: unknown })._size;
      if (typeof metadataSize === "number" && Number.isFinite(metadataSize)) return metadataSize;
    }
    try {
      const serialized = JSON.stringify(value);
      return serialized === undefined ? null : stringByteSize(serialized);
    } catch {
      return null;
    }
  }

  private hasTruncationMarker(value: unknown): boolean {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as any)._truncated === true);
  }
}

export default AIRequestLogService.getInstance();
