import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import {
  AI_REQUEST_LOG_LIMITS,
  type AIRequestLogAuthState,
  type AIRequestLogOmissionReason,
  type AIRequestLogOutcome,
  type AIRequestLogStage,
} from "@/constant/ai-request-log";
import { getLogger, LogCategory } from "@/util/logger";
import { extractClientIp } from "@/util/ip-extractor";
import {
  ensureAIRequestLogId,
  getAIRequestLogContext,
  observeAIRequestLogContext,
  type AIRequestLogAuditContext,
} from "@/util/ai-request-log-context";
import { auditCursor, contentPage, readAuditCursor, searchContent } from "@/util/ai-request-log-content";
import { auditUtf8Slice, sanitizeAuditPayload } from "@/util/ai-request-log-payload";
import { AIRequestLogRepository } from "@/store/system/ai-request-log.repository";
import type {
  AIRequestLogAttemptDto,
  AIRequestLogAttemptsPageDto,
  AIRequestLogContentPageDto,
  AIRequestLogContentSide,
  AIRequestLogContentView,
  AIRequestLogDetailDto,
  AIRequestLogListItemDto,
  AIRequestLogMetadataDto,
  AIRequestLogSearchPageDto,
} from "@/api/dto/relay/ai-request-log.dto";
import type { AIRequestLogListItem, AIRequestLogQuery, AIRequestLogStore } from "@/store/system/ai-request-log.store";
import { NotFoundError } from "@/util/errors";

const logger = getLogger("AIRequestLogService", LogCategory.BUSINESS);
const writes = new WeakMap<Response, Promise<void>>();
function notFound(): never {
  throw new NotFoundError("AI request log not found", undefined, { messageKey: "relay.aiRequestLogNotFound" });
}
function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export class AIRequestLogService {
  private static instance: AIRequestLogService;
  public static getInstance(): AIRequestLogService {
    return (this.instance ??= new AIRequestLogService());
  }
  private constructor(private readonly repository: AIRequestLogStore = AIRequestLogRepository.getInstance()) {}
  public async logRequest(req: Request, res: Response, responseBody?: unknown, durationMs = 0): Promise<void> {
    const initialContext = getAIRequestLogContext(res);
    if (!initialContext) return;
    const currentContext = () => getAIRequestLogContext(res) ?? initialContext;
    const existing = writes.get(res);
    if (existing) return existing;
    const requestId = ensureAIRequestLogId(res);
    const path = String(req.originalUrl || req.url || req.path || "").split("?")[0] || "";
    const context = currentContext();
    let omission: AIRequestLogOmissionReason | null = context.bodyOmissionReason ?? null;
    let body: unknown;
    if (res.statusCode === 413) omission = "request-too-large";
    else if (!omission && !context.userId) omission = "unknown-identity";
    if (!omission) {
      if (Buffer.isBuffer(req.body)) {
        if (/json/i.test(String(req.headers["content-type"] || ""))) {
          try {
            body = JSON.parse(req.body.toString("utf8"));
          } catch {
            omission = "invalid-body";
          }
        } else body = { _binary: true, _size: req.body.byteLength, _contentType: req.headers["content-type"] ?? null };
      } else body = req.body;
    }
    const requestPayload = this.preparePayload(
      omission ? undefined : body,
      AI_REQUEST_LOG_LIMITS.requestBodyBytes,
      Buffer.isBuffer(req.body) ? req.body.byteLength : undefined,
    );
    const responsePayload = this.preparePayload(
      omission ? undefined : responseBody,
      AI_REQUEST_LOG_LIMITS.responseBodyBytes,
      res.locals.responseCaptureState?.totalBytes,
    );
    const headerSize = Number(req.headers["content-length"]);
    const requestSize =
      requestPayload.byteSize ??
      (Number.isSafeInteger(headerSize) && headerSize >= 0 ? Math.min(headerSize, 2147483647) : null);
    const closedEarly = res.locals.responseClosedEarly === true;
    const diagnostics = () => this.diagnostics(currentContext(), res.statusCode, closedEarly);
    const safeFailure = () => logger.error("Failed to persist AI request audit log", { requestId, path });
    // Serialize creation and late updates. A context patch can arrive while the first insert is still pending;
    // defer that patch until the row exists so identity/failure updates cannot race ahead of the insert.
    let queue = Promise.resolve();
    let created = false;
    let updatePending = false;
    observeAIRequestLogContext(res, () => {
      if (!created) {
        updatePending = true;
        return;
      }
      queue = queue
        .then(async () => {
          await this.repository.updateByRequestId(requestId, diagnostics());
        })
        .catch(safeFailure);
      writes.set(res, queue);
    });
    queue = queue
      .then(async () => {
        await this.repository.create({
          requestId,
          userId: context.userId ?? undefined,
          username: context.username?.slice(0, 191),
          relayTokenId: context.relayTokenId ?? undefined,
          relayTokenName: context.relayTokenName?.slice(0, 100),
          model: context.model?.slice(0, 160),
          requestFormat: context.requestFormat?.slice(0, 40),
          path: path.slice(0, 1024),
          method: req.method,
          statusCode: res.statusCode,
          ipAddress: extractClientIp(req),
          userAgent:
            typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 2048) : undefined,
          durationMs: Math.max(0, Math.round(durationMs)),
          requestSizeBytes: requestSize,
          responseSizeBytes: responsePayload.byteSize,
          requestTruncated: requestPayload.truncated,
          responseTruncated: responsePayload.truncated || this.hasTruncationMarker(responseBody),
          bodyOmissionReason: omission,
          isStreaming:
            context.isStreaming ??
            (body && typeof body === "object" ? (body as { stream?: unknown }).stream === true : undefined),
          ...diagnostics(),
          ...(requestPayload.value === undefined ? {} : { requestBody: requestPayload.value }),
          ...(responsePayload.value === undefined ? {} : { responseBody: responsePayload.value }),
        });
        created = true;
        if (updatePending) {
          updatePending = false;
          await this.repository.updateByRequestId(requestId, diagnostics());
        }
      })
      .catch(safeFailure);
    writes.set(res, queue);
    await queue;
  }
  private diagnostics(
    context: AIRequestLogAuditContext,
    statusCode: number,
    closedEarly: boolean,
  ): Pick<
    Prisma.AIRequestLogUncheckedCreateInput,
    | "authenticationState"
    | "outcome"
    | "failureStage"
    | "errorCode"
    | "errorSummary"
    | "attempts"
    | "attemptsTruncated"
    | "userId"
    | "username"
    | "relayTokenId"
    | "relayTokenName"
    | "model"
    | "requestFormat"
    | "isStreaming"
  > {
    const outcome =
      context.outcome === "failed" || context.outcome === "interrupted"
        ? context.outcome
        : closedEarly
          ? "interrupted"
          : context.executionPending
            ? "pending"
            : statusCode >= 400
              ? "failed"
              : "success";
    return {
      userId: context.userId ?? undefined,
      username: context.username?.slice(0, 191),
      relayTokenId: context.relayTokenId ?? undefined,
      relayTokenName: context.relayTokenName?.slice(0, 100),
      model: context.model?.slice(0, 160),
      requestFormat: context.requestFormat?.slice(0, 40),
      isStreaming: context.isStreaming,
      authenticationState: context.authenticationState ?? (context.userId ? "authenticated" : "unknown"),
      outcome,
      failureStage:
        outcome === "success"
          ? null
          : (context.failureStage ?? (closedEarly ? "client" : context.userId ? "upstream" : "authentication")),
      errorCode:
        context.errorCode ?? (closedEarly ? "client_disconnected" : statusCode >= 400 ? "http_" + statusCode : null),
      errorSummary:
        context.errorSummary ??
        (closedEarly ? "Client connection closed before completion" : statusCode >= 400 ? "Request failed" : null),
      attempts: context.attempts ? jsonInput(context.attempts) : undefined,
      attemptsTruncated: context.attemptsTruncated ?? false,
    };
  }
  public async query(query: AIRequestLogQuery): Promise<{ items: AIRequestLogListItemDto[]; total: number }> {
    const result = await this.repository.query(query);
    return { total: result.total, items: result.items.map((log) => this.toListItem(log)) };
  }
  public async findById(id: string): Promise<AIRequestLogDetailDto | null> {
    const log = await this.repository.findById(id);
    return log ? { ...this.toListItem(log), requestBody: log.requestBody, responseBody: log.responseBody } : null;
  }
  public async metadata(id: string): Promise<AIRequestLogMetadataDto> {
    const log = await this.repository.findMetadata(id);
    if (!log) return notFound();
    return {
      ...this.toListItem(log),
      availableSides: [
        ...(log.hasRequestBody ? ["request" as const] : []),
        ...(log.hasResponseBody ? ["response" as const] : []),
      ],
    };
  }
  public async content(
    id: string,
    side: AIRequestLogContentSide,
    view: AIRequestLogContentView,
    options: { cursor?: string; locator?: string; pageSize?: number; offset?: number },
  ): Promise<AIRequestLogContentPageDto> {
    const log = await this.repository.findPayload(id, side);
    if (!log) return notFound();
    return contentPage({
      id,
      side,
      view,
      value: sanitizeAuditPayload(side === "request" ? log.requestBody : log.responseBody),
      ...options,
      truncated: side === "request" ? log.requestTruncated : log.responseTruncated,
      omissionReason: log.bodyOmissionReason as AIRequestLogOmissionReason | null,
    });
  }
  public async search(
    id: string,
    scope: AIRequestLogContentSide | "attempts",
    keyword: string,
    options: { cursor?: string; pageSize?: number },
  ): Promise<AIRequestLogSearchPageDto> {
    if (scope === "attempts") {
      const log = await this.repository.findAttempts(id);
      if (!log) return notFound();
      return searchContent({
        id,
        side: scope,
        keyword,
        value: log.attempts,
        ...options,
        truncated: Boolean(log.attemptsTruncated),
        omissionReason: null,
      });
    }
    const log = await this.repository.findPayload(id, scope);
    if (!log) return notFound();
    return searchContent({
      id,
      side: scope,
      keyword,
      value: sanitizeAuditPayload(scope === "request" ? log.requestBody : log.responseBody),
      ...options,
      truncated: scope === "request" ? log.requestTruncated : log.responseTruncated,
      omissionReason: log.bodyOmissionReason as AIRequestLogOmissionReason | null,
    });
  }
  public async attempts(
    id: string,
    options: { cursor?: string; pageSize?: number },
  ): Promise<AIRequestLogAttemptsPageDto> {
    const log = await this.repository.findAttempts(id);
    if (!log) return notFound();
    const rows = Array.isArray(log.attempts) ? (log.attempts as unknown as AIRequestLogAttemptDto[]) : [];
    const scope = id + ":attempts";
    const cursor = readAuditCursor(options.cursor, scope);
    const items = rows.slice(cursor.index, cursor.index + (options.pageSize ?? AI_REQUEST_LOG_LIMITS.contentPageItems));
    const nextCursor =
      cursor.index + items.length < rows.length ? auditCursor(cursor.index + items.length, scope) : null;
    return {
      items,
      nextCursor,
      hasMore: Boolean(nextCursor),
      total: rows.length,
      truncated: Boolean(log.attemptsTruncated),
    };
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
      requestTruncated: Boolean(log.requestTruncated),
      responseTruncated: Boolean(log.responseTruncated),
      isStreaming: log.isStreaming == null ? null : Boolean(log.isStreaming),
      authenticationState: log.authenticationState as AIRequestLogAuthState | null,
      outcome: log.outcome as AIRequestLogOutcome | null,
      failureStage: log.failureStage as AIRequestLogStage | null,
      errorCode: log.errorCode,
      errorSummary: log.errorSummary,
      bodyOmissionReason: log.bodyOmissionReason as AIRequestLogOmissionReason | null,
      attemptsTruncated: log.attemptsTruncated == null ? null : Boolean(log.attemptsTruncated),
    };
  }
  private hasTruncationMarker(value: unknown): boolean {
    return Boolean(value && typeof value === "object" && (value as { _truncated?: unknown })._truncated);
  }
  private preparePayload(
    value: unknown,
    maxBytes: number,
    measuredBytes?: number,
  ): { value?: Prisma.InputJsonValue; byteSize: number | null; truncated: boolean } {
    if (value === undefined || value === null) return { byteSize: null, truncated: false };
    let originalSize: number;
    try {
      originalSize =
        measuredBytes ??
        (Buffer.isBuffer(value)
          ? value.byteLength
          : Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value)));
      originalSize = Math.min(2147483647, Math.max(0, Math.round(originalSize)));
    } catch {
      originalSize = 0;
    }
    const safe = sanitizeAuditPayload(value);
    const serialized = JSON.stringify(safe) ?? "null";
    if (Buffer.byteLength(serialized) <= maxBytes)
      return { value: jsonInput(safe), byteSize: originalSize, truncated: this.hasTruncationMarker(value) };
    return {
      value: {
        _truncated: true,
        _originalSize: originalSize,
        _preview: auditUtf8Slice(serialized, 0, Math.max(0, maxBytes - 256)).text,
      },
      byteSize: originalSize,
      truncated: true,
    };
  }
}
export default AIRequestLogService.getInstance();
